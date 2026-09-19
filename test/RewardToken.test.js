import { expect } from "chai";
import hre from "hardhat";
import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";

describe("RewardToken", function () {
  let token;
  let admin, minter, user1, user2, rewardPool;
  const MAX_SUPPLY = hre.ethers.parseEther("1000000"); // 1 Million tokens

  beforeEach(async function () {
    [admin, minter, user1, user2, rewardPool] = await hre.ethers.getSigners();

    const Token = await hre.ethers.getContractFactory("RewardToken");
    token = await Token.deploy("Staking Reward", "STAKY", MAX_SUPPLY);
    await token.waitForDeployment();

    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.grantRole(MINTER_ROLE, minter.address);
  });

  describe("Deployment and Configuration", function () {
    it("Should set the correct name, symbol, and cap", async function () {
      expect(await token.name()).to.equal("Staking Reward");
      expect(await token.symbol()).to.equal("STAKY");
      expect(await token.cap()).to.equal(MAX_SUPPLY);
    });
  });

  describe("Minting and Access Control", function () {
    it("Should allow minter to mint tokens (fund reward pool)", async function () {
      const fundAmount = hre.ethers.parseEther("100000");
      await token.connect(minter).mint(rewardPool.address, fundAmount);
      
      expect(await token.balanceOf(rewardPool.address)).to.equal(fundAmount);
      expect(await token.totalSupply()).to.equal(fundAmount);
    });

    it("Should revert if non-minter tries to mint", async function () {
      const fundAmount = hre.ethers.parseEther("100000");
      await expect(
        token.connect(user1).mint(rewardPool.address, fundAmount)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("Should revert if minting exceeds max supply cap", async function () {
      const fundAmount = hre.ethers.parseEther("1000000");
      await token.connect(minter).mint(rewardPool.address, fundAmount);
      
      // Try minting 1 more wei
      await expect(
        token.connect(minter).mint(rewardPool.address, 1)
      ).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
    });
  });

  describe("Transfers and Approvals", function () {
    beforeEach(async function () {
      const fundAmount = hre.ethers.parseEther("1000");
      await token.connect(minter).mint(user1.address, fundAmount);
    });

    it("Should transfer tokens between accounts", async function () {
      const transferAmount = hre.ethers.parseEther("100");
      await token.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(hre.ethers.parseEther("900"));
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it("Should allow approved operator to transfer tokens", async function () {
      const transferAmount = hre.ethers.parseEther("150");
      await token.connect(user1).approve(admin.address, transferAmount);
      
      expect(await token.allowance(user1.address, admin.address)).to.equal(transferAmount);

      await token.connect(admin).transferFrom(user1.address, user2.address, transferAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(hre.ethers.parseEther("850"));
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it("Should revert transfer if sender has insufficient balance", async function () {
      const transferAmount = hre.ethers.parseEther("2000");
      await expect(
        token.connect(user1).transfer(user2.address, transferAmount)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });
});
