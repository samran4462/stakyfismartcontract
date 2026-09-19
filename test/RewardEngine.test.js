import { expect } from "chai";
import hre from "hardhat";
import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("NFTStaking (Phase 5 - Reward Engine)", function () {
  let nft, token, staking;
  let admin, paramManager, rewardManager, user1, user2;
  const DAY_IN_SECONDS = 86400;

  beforeEach(async function () {
    [admin, paramManager, rewardManager, user1, user2] = await hre.ethers.getSigners();

    const NFT = await hre.ethers.getContractFactory("NFTContract");
    nft = await NFT.deploy("https://api.example.com/{id}.json");
    await nft.waitForDeployment();

    const Token = await hre.ethers.getContractFactory("RewardToken");
    token = await Token.deploy("Staking Reward", "STAKY", hre.ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const Staking = await hre.ethers.getContractFactory("NFTStaking");
    staking = await Staking.deploy(await nft.getAddress(), await token.getAddress());
    await staking.waitForDeployment();

    // Roles
    await staking.grantRole(await staking.PARAMETER_MANAGER_ROLE(), paramManager.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), rewardManager.address);

    await nft.configureTier(1, "Common", 1000);
    await nft.mint(user1.address, 1, 10, "0x");
    await nft.mint(user2.address, 1, 10, "0x");
    await nft.connect(user1).setApprovalForAll(await staking.getAddress(), true);
    await nft.connect(user2).setApprovalForAll(await staking.getAddress(), true);

    // Setup base reward rate (1 token per second per NFT)
    await setRewardRateHelper(staking, rewardManager, 1, hre.ethers.parseEther("1"));
  });

  describe("Loyalty Multipliers (Time Boundaries)", function () {
    beforeEach(async function () {
      // 30 days = 1.5x, 60 days = 2.0x
      await addLoyaltyTierHelper(staking, paramManager, 30 * DAY_IN_SECONDS, 15000);
      await addLoyaltyTierHelper(staking, paramManager, 60 * DAY_IN_SECONDS, 20000);
    });

    it("Should apply 1.0x multiplier before 30 days (e.g. Day 29)", async function () {
      await staking.connect(user1).stake(1, 1); // Stake 1 NFT

      // Advance 29 days
      await time.increase(29 * DAY_IN_SECONDS);
      
      const pending = await staking.pendingRewards(1);
      // Base: 29 days * 86400 * 1 ether = 2,505,600 ether
      const expectedBase = hre.ethers.parseEther((29 * DAY_IN_SECONDS).toString());
      
      expect(pending).to.equal(expectedBase); // 1.0x multiplier
    });

    it("Should apply 1.5x multiplier precisely at or after 30 days", async function () {
      await staking.connect(user1).stake(1, 1); 

      // Advance exactly 30 days
      await time.increase(30 * DAY_IN_SECONDS);
      
      const pending = await staking.pendingRewards(1);
      const expectedBase = hre.ethers.parseEther((30 * DAY_IN_SECONDS).toString());
      const expectedMultiplied = expectedBase * 15000n / 10000n;
      
      expect(pending).to.equal(expectedMultiplied); 
    });

    it("Should reject multipliers above 2.0x cap", async function () {
      await expect(
        addLoyaltyTierHelper(staking, paramManager, 90 * DAY_IN_SECONDS, 20001)
      ).to.be.revertedWith("Multiplier exceeds max");
    });
  });

  describe("Rate Checkpoint System", function () {
    it("Should not retroactively alter accrued rewards on rate change", async function () {
      await staking.connect(user1).stake(1, 1); 

      // Earn at 1 ether/sec for 10 days
      await time.increase(10 * DAY_IN_SECONDS);
      
      const pendingBeforeChange = await staking.pendingRewards(1);
      const expected1 = hre.ethers.parseEther((10 * DAY_IN_SECONDS).toString());
      expect(pendingBeforeChange).to.equal(expected1);

      // Change rate to 2 ether/sec
      await setRewardRateHelper(staking, rewardManager, 1, hre.ethers.parseEther("2"));
      
      // Advance 5 days at 2 ether/sec
      await time.increase(5 * DAY_IN_SECONDS);
      
      const pendingAfterChange = await staking.pendingRewards(1);
      
      // Expected logic: 
      // Before setRewardRateHelper (which includes 24h timelock): 10 days at 1x rate
      // The propose tx takes 1 sec.
      // The 24h delay takes 86400 sec.
      // The execute tx takes 1 sec.
      // ALL of this time (10 days + 1 sec + 86400 sec + 1 sec) was at the OLD rate!
      // After execute, rate becomes 2x. We then wait 5 days.
      
      const expectedOld = hre.ethers.parseEther(((10 * DAY_IN_SECONDS) + 86402).toString());
      const expectedNew = hre.ethers.parseEther((5 * DAY_IN_SECONDS * 2).toString());
      const expectedTotal = expectedOld + expectedNew;

      expect(pendingAfterChange).to.equal(expectedTotal);
    });

    it("Should handle multiple users staking at different rates seamlessly", async function () {
      await staking.connect(user1).stake(1, 1);
      const u1StakeTx = await hre.ethers.provider.getBlock("latest");

      await time.increase(10 * DAY_IN_SECONDS);

      await staking.connect(user2).stake(1, 1);
      const u2StakeTx = await hre.ethers.provider.getBlock("latest");

      await setRewardRateHelper(staking, rewardManager, 1, hre.ethers.parseEther("5"));
      const rateChangeTx = await hre.ethers.provider.getBlock("latest");

      await time.increase(2 * DAY_IN_SECONDS);
      const finalBlock = await hre.ethers.provider.getBlock("latest");

      const p1 = await staking.pendingRewards(1); // User1
      const p2 = await staking.pendingRewards(2); // User2
      
      const oldRate = hre.ethers.parseEther("1");
      const newRate = hre.ethers.parseEther("5");

      const u1OldTime = BigInt(rateChangeTx.timestamp - u1StakeTx.timestamp);
      const u1NewTime = BigInt(finalBlock.timestamp - rateChangeTx.timestamp);
      const expectedU1Total = (u1OldTime * oldRate) + (u1NewTime * newRate);

      const u2OldTime = BigInt(rateChangeTx.timestamp - u2StakeTx.timestamp);
      const u2NewTime = BigInt(finalBlock.timestamp - rateChangeTx.timestamp);
      const expectedU2Total = (u2OldTime * oldRate) + (u2NewTime * newRate);
      
      expect(p1).to.equal(expectedU1Total);
      expect(p2).to.equal(expectedU2Total);
    });
  });
});
