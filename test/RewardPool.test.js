import { expect } from "chai";
import hre from "hardhat";
import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("NFTStaking (Phase 9 - Reward Pool Tracking)", function () {
  let nft, token, staking;
  let admin, paramManager, treasury, funder, user1;
  const DAY_IN_SECONDS = 86400;

  beforeEach(async function () {
    [admin, paramManager, treasury, funder, user1] = await hre.ethers.getSigners();

    const NFT = await hre.ethers.getContractFactory("NFTContract");
    nft = await NFT.deploy("https://api.example.com/{id}.json");
    await nft.waitForDeployment();

    const Token = await hre.ethers.getContractFactory("RewardToken");
    token = await Token.deploy("Staking Reward", "STAKY", hre.ethers.parseEther("20000000"));
    await token.waitForDeployment();

    const Staking = await hre.ethers.getContractFactory("NFTStaking");
    staking = await Staking.deploy(await nft.getAddress(), await token.getAddress());
    await staking.waitForDeployment();

    await staking.grantRole(await staking.PARAMETER_MANAGER_ROLE(), paramManager.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), admin.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), funder.address);
    await staking.setTreasury(treasury.address);

    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, admin.address);
    await token.mint(funder.address, hre.ethers.parseEther("5000000"));

    await nft.configureTier(1, "Common", 1000);
    await nft.mint(user1.address, 1, 10, "0x");
    await nft.connect(user1).setApprovalForAll(await staking.getAddress(), true);

    await setRewardRateHelper(staking, admin, 1, hre.ethers.parseEther("1"));
  });

  describe("Funding and Balances", function () {
    it("Should track totalFunded and emit event when funding reward pool", async function () {
      const fundAmount = hre.ethers.parseEther("1000");
      await token.connect(funder).approve(await staking.getAddress(), fundAmount);

      const tx = await staking.connect(funder).fundRewardPool(fundAmount);
      
      await expect(tx).to.emit(staking, "RewardPoolFunded").withArgs(funder.address, fundAmount);
      
      expect(await staking.totalFunded()).to.equal(fundAmount);
      expect(await staking.availableBalance()).to.equal(fundAmount);
      expect(await staking.totalDistributed()).to.equal(0);
      expect(await staking.totalClaimed()).to.equal(0);
    });

    it("Should revert if available balance is insufficient during claim", async function () {
      // Don't fund the pool.
      await staking.connect(user1).stake(1, 1);
      await time.increase(DAY_IN_SECONDS);

      expect(await staking.availableBalance()).to.equal(0);

      await expect(
        staking.connect(user1).claimRewards(1)
      ).to.be.revertedWithCustomError(staking, "InsufficientRewardPool");

      // Verify state was not mutated (totalDistributed and totalClaimed should remain 0)
      expect(await staking.totalDistributed()).to.equal(0);
      expect(await staking.totalClaimed()).to.equal(0);
    });
  });

  describe("Metrics Tracking (Distributed vs Claimed)", function () {
    beforeEach(async function () {
      const fundAmount = hre.ethers.parseEther("1000000");
      await token.connect(funder).approve(await staking.getAddress(), fundAmount);
      await staking.connect(funder).fundRewardPool(fundAmount);
    });

    it("Should track exact claimed and distributed amounts without penalties", async function () {
      await staking.connect(user1).stake(1, 1);
      const stakeTx = await hre.ethers.provider.getBlock("latest");

      await time.increase(100);

      await staking.connect(user1).claimRewards(1);
      const claimTx = await hre.ethers.provider.getBlock("latest");
      
      const duration = BigInt(claimTx.timestamp - stakeTx.timestamp);
      const expectedReward = duration * hre.ethers.parseEther("1");

      // Since there is no penalty configured, userReward == rewardToClaim
      expect(await staking.totalDistributed()).to.equal(expectedReward);
      expect(await staking.totalClaimed()).to.equal(expectedReward);
      
      const availableBalance = await staking.availableBalance();
      const totalFunded = await staking.totalFunded();
      expect(availableBalance).to.equal(totalFunded - expectedReward);
    });

    it("Should track totalDistributed (including penalties) vs totalClaimed (user share only)", async function () {
      // Set penalty to 20%
      await setUnstakingPenaltyHelper(staking, paramManager, 30 * DAY_IN_SECONDS, 2000, 5000, 5000);

      await staking.connect(user1).stake(1, 1);
      const stakeTx = await hre.ethers.provider.getBlock("latest");

      await time.increase(100);

      // Unstake early triggers the 20% penalty
      await staking.connect(user1).unstake(1);
      const claimTx = await hre.ethers.provider.getBlock("latest");
      
      const duration = BigInt(claimTx.timestamp - stakeTx.timestamp);
      const expectedTotalReward = duration * hre.ethers.parseEther("1");
      
      const penaltyAmount = (expectedTotalReward * 2000n) / 10000n;
      const expectedUserReward = expectedTotalReward - penaltyAmount;

      // totalDistributed should be the ENTIRE reward generated (expectedTotalReward)
      expect(await staking.totalDistributed()).to.equal(expectedTotalReward);
      
      // totalClaimed should be ONLY the user's net received share
      expect(await staking.totalClaimed()).to.equal(expectedUserReward);
    });
  });
});
