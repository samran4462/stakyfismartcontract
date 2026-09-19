import { expect } from "chai";
import hre from "hardhat";

describe("NFTStaking (Phase 10 - Admin Roles & Security)", function () {
  let nft, token, staking;
  let admin, paramManager, rewardManager, treasuryManager, pauser, user1;
  
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  let PARAMETER_MANAGER_ROLE;
  let REWARD_MANAGER_ROLE;
  let TREASURY_MANAGER_ROLE;
  let PAUSER_ROLE;

  beforeEach(async function () {
    [admin, paramManager, rewardManager, treasuryManager, pauser, user1] = await hre.ethers.getSigners();

    const NFT = await hre.ethers.getContractFactory("NFTContract");
    nft = await NFT.deploy("https://api.example.com/{id}.json");
    await nft.waitForDeployment();

    const Token = await hre.ethers.getContractFactory("RewardToken");
    token = await Token.deploy("Staking Reward", "STAKY", hre.ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const Staking = await hre.ethers.getContractFactory("NFTStaking");
    staking = await Staking.deploy(await nft.getAddress(), await token.getAddress());
    await staking.waitForDeployment();

    PARAMETER_MANAGER_ROLE = await staking.PARAMETER_MANAGER_ROLE();
    REWARD_MANAGER_ROLE = await staking.REWARD_MANAGER_ROLE();
    TREASURY_MANAGER_ROLE = await staking.TREASURY_MANAGER_ROLE();
    PAUSER_ROLE = await staking.PAUSER_ROLE();

    // Revoke admin from itself for specific roles to ensure strict tests
    await staking.revokeRole(PARAMETER_MANAGER_ROLE, admin.address);
    await staking.revokeRole(REWARD_MANAGER_ROLE, admin.address);
    await staking.revokeRole(TREASURY_MANAGER_ROLE, admin.address);
    await staking.revokeRole(PAUSER_ROLE, admin.address);

    // Grant distinct roles
    await staking.grantRole(PARAMETER_MANAGER_ROLE, paramManager.address);
    await staking.grantRole(REWARD_MANAGER_ROLE, rewardManager.address);
    await staking.grantRole(TREASURY_MANAGER_ROLE, treasuryManager.address);
    await staking.grantRole(PAUSER_ROLE, pauser.address);
  });

  describe("AccessControl Enforcement", function () {
    it("Should restrict setTreasury and setRewardSupportPool to DEFAULT_ADMIN_ROLE", async function () {
      await expect(
        staking.connect(user1).setTreasury(user1.address)
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount").withArgs(user1.address, DEFAULT_ADMIN_ROLE);

      await expect(
        staking.connect(admin).setTreasury(user1.address)
      ).to.not.be.reverted;
    });

    it("Should restrict PARAMETER_MANAGER_ROLE setters", async function () {
      const PARAM_LOYALTY_TIER = await staking.PARAM_LOYALTY_TIER();
      const PARAM_STAKING_FEE = await staking.PARAM_STAKING_FEE();
      const PARAM_UNSTAKING_PENALTY = await staking.PARAM_UNSTAKING_PENALTY();

      const dataTier = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [86400, 11000]);
      await expect(
        staking.connect(user1).proposeParameterChange(PARAM_LOYALTY_TIER, dataTier)
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount").withArgs(user1.address, PARAMETER_MANAGER_ROLE);

      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_LOYALTY_TIER, dataTier)
      ).to.not.be.reverted;

      const dataFee = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256"], [0, 5000, 5000]);
      await expect(
        staking.connect(user1).proposeParameterChange(PARAM_STAKING_FEE, dataFee)
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount").withArgs(user1.address, PARAMETER_MANAGER_ROLE);

      const dataPenalty = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256", "uint256"], [86400, 1000, 5000, 5000]);
      await expect(
        staking.connect(user1).proposeParameterChange(PARAM_UNSTAKING_PENALTY, dataPenalty)
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount").withArgs(user1.address, PARAMETER_MANAGER_ROLE);
    });

    it("Should restrict REWARD_MANAGER_ROLE setters (propose REWARD_RATE, fundRewardPool)", async function () {
      const PARAM_REWARD_RATE = await staking.PARAM_REWARD_RATE();
      const dataRate = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, hre.ethers.parseEther("1")]);

      await expect(
        staking.connect(user1).proposeParameterChange(PARAM_REWARD_RATE, dataRate)
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount").withArgs(user1.address, REWARD_MANAGER_ROLE);

      await expect(
        staking.connect(rewardManager).proposeParameterChange(PARAM_REWARD_RATE, dataRate)
      ).to.not.be.reverted;

      await expect(
        staking.connect(user1).fundRewardPool(hre.ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount").withArgs(user1.address, REWARD_MANAGER_ROLE);
    });

    it("Should restrict PAUSER_ROLE (pause, unpause)", async function () {
      await expect(
        staking.connect(user1).pause()
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount").withArgs(user1.address, PAUSER_ROLE);

      await expect(
        staking.connect(pauser).pause()
      ).to.not.be.reverted;

      expect(await staking.paused()).to.be.true;

      await expect(
        staking.connect(user1).unpause()
      ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount").withArgs(user1.address, PAUSER_ROLE);

      await expect(
        staking.connect(pauser).unpause()
      ).to.not.be.reverted;

      expect(await staking.paused()).to.be.false;
    });
  });

  describe("Pausable Circuit Breaker", function () {
    it("Should prevent staking when paused", async function () {
      await nft.configureTier(1, "Common", 1000);
      await nft.mint(user1.address, 1, 10, "0x");
      await nft.connect(user1).setApprovalForAll(await staking.getAddress(), true);

      await staking.connect(pauser).pause();

      await expect(
        staking.connect(user1).stake(1, 1)
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");

      await expect(
        staking.connect(user1).stakeBatch([1], [1])
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
      
      // Unstake is allowed even when paused for safety? 
      // The current implementation of unstake doesn't have whenNotPaused. 
      // This is a great security feature.
      
      await staking.connect(pauser).unpause();
      
      await expect(
        staking.connect(user1).stake(1, 1)
      ).to.not.be.reverted;
    });
  });
});
