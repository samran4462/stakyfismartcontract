import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("NFTStaking (Phase 12 - Timelock Governance)", function () {
  let nft, token, staking;
  let admin, paramManager, rewardManager, user1;
  const DAY_IN_SECONDS = 86400;

  let PARAM_REWARD_RATE;
  let PARAM_LOYALTY_TIER;

  beforeEach(async function () {
    [admin, paramManager, rewardManager, user1] = await hre.ethers.getSigners();

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
    
    PARAM_REWARD_RATE = await staking.PARAM_REWARD_RATE();
    PARAM_LOYALTY_TIER = await staking.PARAM_LOYALTY_TIER();
  });

  describe("Proposal Validation & Timelock Flow", function () {
    it("Should successfully propose, wait 24h, and execute", async function () {
      const data = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, hre.ethers.parseEther("1")]);
      
      const tx = await staking.connect(rewardManager).proposeParameterChange(PARAM_REWARD_RATE, data);
      
      const receipt = await tx.wait();
      const block = await hre.ethers.provider.getBlock(receipt.blockNumber);
      
      await expect(tx).to.emit(staking, "ParameterChangeProposed").withArgs(PARAM_REWARD_RATE, data, block.timestamp + 86400, rewardManager.address);

      // Try early execution
      await expect(
        staking.connect(rewardManager).executeParameterChange(PARAM_REWARD_RATE)
      ).to.be.revertedWith("Timelock active");

      // Fast forward 24 hours
      await time.increase(DAY_IN_SECONDS);

      await expect(
        staking.connect(rewardManager).executeParameterChange(PARAM_REWARD_RATE)
      ).to.emit(staking, "ParameterChangeExecuted").withArgs(PARAM_REWARD_RATE, data);

      const rewardData = await staking.rewardData(1);
      expect(rewardData.rewardRate).to.equal(hre.ethers.parseEther("1"));
    });

    it("Should reject proposal exceeding MAX_CAPS immediately", async function () {
      const MAX_REWARD_RATE = await staking.MAX_REWARD_RATE();
      const data = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, MAX_REWARD_RATE + 1n]);
      
      await expect(
        staking.connect(rewardManager).proposeParameterChange(PARAM_REWARD_RATE, data)
      ).to.be.revertedWith("Rate exceeds max");
    });

    it("Should allow proposer to cancel before execution", async function () {
      const data = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, hre.ethers.parseEther("1")]);
      
      await staking.connect(rewardManager).proposeParameterChange(PARAM_REWARD_RATE, data);
      
      await expect(
        staking.connect(rewardManager).cancelParameterChange(PARAM_REWARD_RATE)
      ).to.emit(staking, "ParameterChangeCancelled").withArgs(PARAM_REWARD_RATE);

      const proposal = await staking.parameterProposals(PARAM_REWARD_RATE);
      expect(proposal.canceled).to.be.true;

      await time.increase(DAY_IN_SECONDS);

      await expect(
        staking.connect(rewardManager).executeParameterChange(PARAM_REWARD_RATE)
      ).to.be.revertedWith("Canceled");
    });
  });
});
