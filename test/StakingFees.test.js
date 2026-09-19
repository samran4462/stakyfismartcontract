import { expect } from "chai";
import hre from "hardhat";
import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";

describe("NFTStaking (Phase 7 - Staking Fees)", function () {
  let nft, token, staking;
  let admin, paramManager, treasury, rewardSupportPool, user1;
  const MAX_STAKING_FEE = hre.ethers.parseEther("0.01");

  beforeEach(async function () {
    [admin, paramManager, treasury, rewardSupportPool, user1] = await hre.ethers.getSigners();

    const NFT = await hre.ethers.getContractFactory("NFTContract");
    nft = await NFT.deploy("https://api.example.com/{id}.json");
    await nft.waitForDeployment();

    const Token = await hre.ethers.getContractFactory("RewardToken");
    token = await Token.deploy("Staking Reward", "STAKY", hre.ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const Staking = await hre.ethers.getContractFactory("NFTStaking");
    staking = await Staking.deploy(await nft.getAddress(), await token.getAddress());
    await staking.waitForDeployment();

    // Roles and setups
    await staking.grantRole(await staking.PARAMETER_MANAGER_ROLE(), paramManager.address);
    
    await staking.setTreasury(treasury.address);
    await staking.setRewardSupportPool(rewardSupportPool.address);

    await nft.configureTier(1, "Common", 1000);
    await nft.mint(user1.address, 1, 10, "0x");
    await nft.connect(user1).setApprovalForAll(await staking.getAddress(), true);
  });

  describe("Fee Configuration", function () {
    it("Should configure standard fee correctly (7000 BPS Treasury, 3000 BPS Pool)", async function () {
      const fee = hre.ethers.parseEther("0.001");
      await expect(setStakingFeeHelper(staking, paramManager, fee, 7000, 3000))
        .to.not.be.reverted;
        
      expect(await staking.stakingFee()).to.equal(fee);
      expect(await staking.feeTreasuryShareBps()).to.equal(7000);
      expect(await staking.feeRewardPoolShareBps()).to.equal(3000);
    });

    it("Should revert if BPS does not equal 10000", async function () {
      const fee = hre.ethers.parseEther("0.001");
      await expect(
        setStakingFeeHelper(staking, paramManager, fee, 7000, 4000)
      ).to.be.revertedWith("BPS must equal 10000");
    });

    it("Should revert if fee exceeds MAX_STAKING_FEE", async function () {
      const hugeFee = hre.ethers.parseEther("0.02"); // > 0.01
      await expect(
        setStakingFeeHelper(staking, paramManager, hugeFee, 7000, 3000)
      ).to.be.revertedWith("Fee exceeds max limit");
    });
  });

  describe("Fee Collection & Distribution", function () {
    let fee;

    beforeEach(async function () {
      fee = hre.ethers.parseEther("0.001");
      await setStakingFeeHelper(staking, paramManager, fee, 7000, 3000);
    });

    it("Should reject staking if incorrect fee is supplied", async function () {
      await expect(
        staking.connect(user1).stake(1, 1, { value: hre.ethers.parseEther("0.0005") })
      ).to.be.revertedWith("Incorrect staking fee");

      await expect(
        staking.connect(user1).stake(1, 1, { value: hre.ethers.parseEther("0.002") })
      ).to.be.revertedWith("Incorrect staking fee");
    });

    it("Should distribute exact fee to treasury and reward support pool upon staking", async function () {
      const treasuryBalanceBefore = await hre.ethers.provider.getBalance(treasury.address);
      const poolBalanceBefore = await hre.ethers.provider.getBalance(rewardSupportPool.address);

      const tx = await staking.connect(user1).stake(1, 1, { value: fee });

      const expectedTreasuryShare = (fee * 7000n) / 10000n;
      const expectedPoolShare = fee - expectedTreasuryShare;

      // Event checking
      await expect(tx).to.emit(staking, "StakingFeeCollected").withArgs(user1.address, fee, expectedTreasuryShare, expectedPoolShare);

      // Balance checking
      const treasuryBalanceAfter = await hre.ethers.provider.getBalance(treasury.address);
      const poolBalanceAfter = await hre.ethers.provider.getBalance(rewardSupportPool.address);

      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedTreasuryShare);
      expect(poolBalanceAfter - poolBalanceBefore).to.equal(expectedPoolShare);
    });

    it("Should distribute expected aggregate fee for stakeBatch", async function () {
      const treasuryBalanceBefore = await hre.ethers.provider.getBalance(treasury.address);
      const poolBalanceBefore = await hre.ethers.provider.getBalance(rewardSupportPool.address);

      // Staking 3 different tokens (using [1,1,1] just to simulate length of 3 token array)
      const tokenIds = [1, 1, 1];
      const amounts = [1, 2, 3];
      const expectedTotalFee = fee * 3n;

      const tx = await staking.connect(user1).stakeBatch(tokenIds, amounts, { value: expectedTotalFee });

      const expectedTreasuryShare = (expectedTotalFee * 7000n) / 10000n;
      const expectedPoolShare = expectedTotalFee - expectedTreasuryShare;

      await expect(tx).to.emit(staking, "StakingFeeCollected").withArgs(user1.address, expectedTotalFee, expectedTreasuryShare, expectedPoolShare);

      const treasuryBalanceAfter = await hre.ethers.provider.getBalance(treasury.address);
      const poolBalanceAfter = await hre.ethers.provider.getBalance(rewardSupportPool.address);

      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedTreasuryShare);
      expect(poolBalanceAfter - poolBalanceBefore).to.equal(expectedPoolShare);
    });
  });
});
