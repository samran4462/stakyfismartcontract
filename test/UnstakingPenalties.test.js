import { expect } from "chai";
import hre from "hardhat";
import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("NFTStaking (Phase 8 - Unstaking Penalties)", function () {
  let nft, token, staking;
  let admin, paramManager, treasury, user1;
  const DAY_IN_SECONDS = 86400;

  beforeEach(async function () {
    [admin, paramManager, treasury, user1] = await hre.ethers.getSigners();

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
    
    await staking.setTreasury(treasury.address);
    
    // Give tokens to staking contract to act as reward pool
    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, admin.address);
    await token.mint(await staking.getAddress(), hre.ethers.parseEther("10000000"));

    await nft.configureTier(1, "Common", 1000);
    await nft.mint(user1.address, 1, 10, "0x");
    await nft.connect(user1).setApprovalForAll(await staking.getAddress(), true);

    await setRewardRateHelper(staking, admin, 1, hre.ethers.parseEther("1"));
  });

  describe("Configuration & Constraints", function () {
    it("Should configure unstaking penalty correctly", async function () {
      // 30 days lock, 20% penalty (2000 bps), 50% treasury (5000 bps), 50% reward pool (5000 bps)
      await expect(
        setUnstakingPenaltyHelper(staking, paramManager, 30 * DAY_IN_SECONDS, 2000, 5000, 5000)
      ).to.not.be.reverted;
    });

    it("Should revert if penalty exceeds max limit (30%)", async function () {
      await expect(
        setUnstakingPenaltyHelper(staking, paramManager, 30 * DAY_IN_SECONDS, 3001, 5000, 5000)
      ).to.be.revertedWith("Penalty exceeds max");
    });
  });

  describe("Penalty Deduction & NFT Safety", function () {
    beforeEach(async function () {
      await setUnstakingPenaltyHelper(staking, paramManager, 30 * DAY_IN_SECONDS, 2000, 5000, 5000);
    });

    it("Should apply 20% penalty on rewards before 30 days (Day 29) and return NFT safely", async function () {
      await staking.connect(user1).stake(1, 1);
      const stakeTx = await hre.ethers.provider.getBlock("latest");

      // Advance 29 days
      await time.increase(29 * DAY_IN_SECONDS);
      
      const balanceBefore = await token.balanceOf(user1.address);
      const treasuryBefore = await token.balanceOf(treasury.address);
      const nftBalanceBefore = await nft.balanceOf(user1.address, 1);

      await staking.connect(user1).unstake(1);
      const unstakeTx = await hre.ethers.provider.getBlock("latest");
      
      const duration = BigInt(unstakeTx.timestamp - stakeTx.timestamp);
      expect(duration).to.be.lt(30n * 86400n); // Verify it's under 30 days
      
      // Expected rewards = duration * 1 ether/sec
      const totalReward = duration * hre.ethers.parseEther("1");
      const penalty = (totalReward * 2000n) / 10000n;
      const expectedUserReward = totalReward - penalty;
      const expectedTreasuryShare = (penalty * 5000n) / 10000n;

      const balanceAfter = await token.balanceOf(user1.address);
      const treasuryAfter = await token.balanceOf(treasury.address);
      const nftBalanceAfter = await nft.balanceOf(user1.address, 1);

      // User gets remaining reward
      expect(balanceAfter - balanceBefore).to.equal(expectedUserReward);
      // Treasury gets penalty split
      expect(treasuryAfter - treasuryBefore).to.equal(expectedTreasuryShare);
      // NFT returned safely
      expect(nftBalanceAfter - nftBalanceBefore).to.equal(1); 
    });

    it("Should apply 0% penalty exactly at or after 30 days and return NFT safely", async function () {
      await staking.connect(user1).stake(1, 1);
      const stakeTx = await hre.ethers.provider.getBlock("latest");

      // Advance 30 days
      await time.increase(30 * DAY_IN_SECONDS);
      
      const balanceBefore = await token.balanceOf(user1.address);
      const treasuryBefore = await token.balanceOf(treasury.address);
      const nftBalanceBefore = await nft.balanceOf(user1.address, 1);

      await staking.connect(user1).unstake(1);
      const unstakeTx = await hre.ethers.provider.getBlock("latest");
      
      const duration = BigInt(unstakeTx.timestamp - stakeTx.timestamp);
      expect(duration).to.be.gte(30n * 86400n); // Verify it's at least 30 days
      
      const totalReward = duration * hre.ethers.parseEther("1");

      const balanceAfter = await token.balanceOf(user1.address);
      const treasuryAfter = await token.balanceOf(treasury.address);
      const nftBalanceAfter = await nft.balanceOf(user1.address, 1);

      // User gets FULL reward
      expect(balanceAfter - balanceBefore).to.equal(totalReward);
      // Treasury gets 0
      expect(treasuryAfter - treasuryBefore).to.equal(0);
      // NFT returned safely
      expect(nftBalanceAfter - nftBalanceBefore).to.equal(1);
    });

    it("Should apply penalty if user manually claims before 30 days", async function () {
      await staking.connect(user1).stake(1, 1);
      const stakeTx = await hre.ethers.provider.getBlock("latest");

      await time.increase(15 * DAY_IN_SECONDS);

      const tx = await staking.connect(user1).claimRewards(1);
      const claimTx = await hre.ethers.provider.getBlock("latest");
      
      const duration = BigInt(claimTx.timestamp - stakeTx.timestamp);
      const totalReward = duration * hre.ethers.parseEther("1");
      const penalty = (totalReward * 2000n) / 10000n;
      const treasuryShare = (penalty * 5000n) / 10000n;
      const poolShare = penalty - treasuryShare;

      await expect(tx).to.emit(staking, "PenaltyCollected").withArgs(user1.address, penalty, treasuryShare, poolShare);
    });
  });
});
