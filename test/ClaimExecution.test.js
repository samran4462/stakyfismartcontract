import { expect } from "chai";
import hre from "hardhat";
import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("NFTStaking (Phase 6 - Claim Execution)", function () {
  let nft, token, staking;
  let admin, rewardManager, user1, user2, poolFunder;
  const DAY_IN_SECONDS = 86400;

  beforeEach(async function () {
    [admin, rewardManager, user1, user2, poolFunder] = await hre.ethers.getSigners();

    const NFT = await hre.ethers.getContractFactory("NFTContract");
    nft = await NFT.deploy("https://api.example.com/{id}.json");
    await nft.waitForDeployment();

    const Token = await hre.ethers.getContractFactory("RewardToken");
    token = await Token.deploy("Staking Reward", "STAKY", hre.ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const Staking = await hre.ethers.getContractFactory("NFTStaking");
    staking = await Staking.deploy(await nft.getAddress(), await token.getAddress());
    await staking.waitForDeployment();

    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), rewardManager.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), poolFunder.address);

    // Give tokens to poolFunder and approve staking contract
    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, admin.address);
    await token.mint(poolFunder.address, hre.ethers.parseEther("500000"));
    await token.connect(poolFunder).approve(await staking.getAddress(), hre.ethers.parseEther("500000"));

    await nft.configureTier(1, "Common", 1000);
    await nft.mint(user1.address, 1, 10, "0x");
    await nft.connect(user1).setApprovalForAll(await staking.getAddress(), true);

    await setRewardRateHelper(staking, rewardManager, 1, hre.ethers.parseEther("1"));
  });

  describe("Insufficient Reward Pool Validation", function () {
    it("Should revert with InsufficientRewardPool if contract has no liquidity", async function () {
      await staking.connect(user1).stake(1, 1);
      
      await time.increase(DAY_IN_SECONDS);

      // Contract has 0 tokens, user has pending rewards
      const pending = await staking.pendingRewards(1);
      expect(pending).to.be.gt(0);

      await expect(
        staking.connect(user1).claimRewards(1)
      ).to.be.revertedWithCustomError(staking, "InsufficientRewardPool");
    });
  });

  describe("Claiming Logic", function () {
    beforeEach(async function () {
      // Fund the pool so claims can pass
      await staking.connect(poolFunder).fundRewardPool(hre.ethers.parseEther("100000"));
    });

    it("Should allow user to claim rewards and update state", async function () {
      await staking.connect(user1).stake(1, 1);
      await time.increase(DAY_IN_SECONDS);

      const pendingBefore = await staking.pendingRewards(1);
      expect(pendingBefore).to.be.gt(0);

      const tx = await staking.connect(user1).claimRewards(1);
      
      // Since a block mined, actual claimed amount might be exactly pendingBefore + 1 sec
      // Let's just check the event
      await expect(tx).to.emit(staking, "RewardClaimed").withArgs(user1.address, pendingBefore + hre.ethers.parseEther("1"));

      // State check
      const pos = await staking.positions(1);
      expect(pos.accumulatedReward).to.equal(0);
      expect(pos.rewardRateSnapshot).to.be.gt(0);
      
      const pendingAfter = await staking.pendingRewards(1);
      expect(pendingAfter).to.equal(0); // Right after claim, pending is 0
    });

    it("Should allow claiming all rewards for multiple positions", async function () {
      await staking.connect(user1).stakeBatch([1, 1], [1, 2]); // Stake two positions
      const stakeTx = await hre.ethers.provider.getBlock("latest");

      await time.increase(100);
      const claimTxBlock = await hre.ethers.provider.getBlock("latest");
      // Actually claimAllRewards will mine a new block, so the elapsed time is (claimTxBlock.timestamp - stakeTx.timestamp + 1)
      
      const balanceBefore = await token.balanceOf(user1.address);
      await staking.connect(user1).claimAllRewards();
      const claimTx = await hre.ethers.provider.getBlock("latest");
      
      const balanceAfter = await token.balanceOf(user1.address);

      const elapsedTime = BigInt(claimTx.timestamp - stakeTx.timestamp);
      // amount 1 + amount 2 = 3. Rate is 1 ether/sec.
      const expectedReward = elapsedTime * 3n * hre.ethers.parseEther("1");

      expect(balanceAfter - balanceBefore).to.equal(expectedReward); 
      
      expect(await staking.pendingRewards(1)).to.equal(0);
      expect(await staking.pendingRewards(2)).to.equal(0);
    });

    it("Should revert claimAllRewards if there are no rewards to claim", async function () {
      // User staked but immediately claims -> 0 time elapsed
      await staking.connect(user1).stake(1, 1);
      // We must avoid mining an extra block to have 0 time delta, but Hardhat mines. 
      // If we claim on the exact same block (via multicall), it would be 0.
      // Or we can just let an unstaked user try to claim.
      await expect(
        staking.connect(user2).claimAllRewards()
      ).to.be.revertedWith("No rewards to claim");
    });
  });
});
