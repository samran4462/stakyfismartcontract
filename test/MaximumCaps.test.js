import { expect } from "chai";
import hre from "hardhat";

describe("NFTStaking (Phase 11 - Maximum Caps)", function () {
  let nft, token, staking;
  let admin, paramManager, rewardManager;
  
  const MAX_PENALTY = 3000;
  const MAX_MULTIPLIER = 20000;
  const MAX_STAKING_FEE = hre.ethers.parseEther("0.01");
  const MAX_REWARD_RATE = hre.ethers.parseEther("1000");
  const MAX_LOCK_DURATION = 365 * 86400;

  beforeEach(async function () {
    [admin, paramManager, rewardManager] = await hre.ethers.getSigners();

    const NFT = await hre.ethers.getContractFactory("NFTContract");
    nft = await NFT.deploy("https://api.example.com/{id}.json");
    await nft.waitForDeployment();

    const Token = await hre.ethers.getContractFactory("RewardToken");
    token = await Token.deploy("Staking Reward", "STAKY", hre.ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const Staking = await hre.ethers.getContractFactory("NFTStaking");
    staking = await Staking.deploy(await nft.getAddress(), await token.getAddress());
    await staking.waitForDeployment();

    await staking.grantRole(await staking.PARAMETER_MANAGER_ROLE(), paramManager.address);
    await staking.grantRole(await staking.REWARD_MANAGER_ROLE(), rewardManager.address);
    
    await nft.configureTier(1, "Common", 1000);
  });

  describe("Rejection of Out-of-Bounds Values", function () {
    
    it("Should reject reward rate exceeding MAX_REWARD_RATE", async function () {
      const PARAM_REWARD_RATE = await staking.PARAM_REWARD_RATE();
      const dataBad = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, MAX_REWARD_RATE + 1n]);
      await expect(
        staking.connect(rewardManager).proposeParameterChange(PARAM_REWARD_RATE, dataBad)
      ).to.be.revertedWith("Rate exceeds max");

      const dataGood = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, MAX_REWARD_RATE]);
      await expect(
        staking.connect(rewardManager).proposeParameterChange(PARAM_REWARD_RATE, dataGood)
      ).to.not.be.reverted;
    });

    it("Should reject lock duration exceeding MAX_LOCK_DURATION", async function () {
      const PARAM_UNSTAKING_PENALTY = await staking.PARAM_UNSTAKING_PENALTY();
      const dataBad = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256", "uint256"], [MAX_LOCK_DURATION + 1, 1000, 5000, 5000]);
      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_UNSTAKING_PENALTY, dataBad)
      ).to.be.revertedWith("Lock duration exceeds max");

      const dataGood = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256", "uint256"], [MAX_LOCK_DURATION, 1000, 5000, 5000]);
      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_UNSTAKING_PENALTY, dataGood)
      ).to.not.be.reverted;
    });

    it("Should reject penalty exceeding MAX_PENALTY", async function () {
      const PARAM_UNSTAKING_PENALTY = await staking.PARAM_UNSTAKING_PENALTY();
      const dataBad = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256", "uint256"], [86400, MAX_PENALTY + 1, 5000, 5000]);
      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_UNSTAKING_PENALTY, dataBad)
      ).to.be.revertedWith("Penalty exceeds max");

      const dataGood = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256", "uint256"], [86400, MAX_PENALTY, 5000, 5000]);
      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_UNSTAKING_PENALTY, dataGood)
      ).to.not.be.reverted;
    });

    it("Should reject multiplier exceeding MAX_MULTIPLIER", async function () {
      const PARAM_LOYALTY_TIER = await staking.PARAM_LOYALTY_TIER();
      const dataBad = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [86400, MAX_MULTIPLIER + 1]);
      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_LOYALTY_TIER, dataBad)
      ).to.be.revertedWith("Multiplier exceeds max");

      const dataGood = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [86400, MAX_MULTIPLIER]);
      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_LOYALTY_TIER, dataGood)
      ).to.not.be.reverted;
    });

    it("Should reject staking fee exceeding MAX_STAKING_FEE", async function () {
      const PARAM_STAKING_FEE = await staking.PARAM_STAKING_FEE();
      const dataBad = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256"], [MAX_STAKING_FEE + 1n, 5000, 5000]);
      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_STAKING_FEE, dataBad)
      ).to.be.revertedWith("Fee exceeds max limit");

      const dataGood = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256"], [MAX_STAKING_FEE, 5000, 5000]);
      await expect(
        staking.connect(paramManager).proposeParameterChange(PARAM_STAKING_FEE, dataGood)
      ).to.not.be.reverted;
    });
  });
});
