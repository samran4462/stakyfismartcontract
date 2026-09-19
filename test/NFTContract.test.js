import { expect } from "chai";
import hre from "hardhat";
import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";

describe("NFTContract", function () {
  let nft;
  let admin, minter, pauser, user1, user2;

  beforeEach(async function () {
    [admin, minter, pauser, user1, user2] = await hre.ethers.getSigners();

    const NFT = await hre.ethers.getContractFactory("NFTContract");
    nft = await NFT.deploy("https://api.example.com/metadata/{id}.json");
    await nft.waitForDeployment();

    // Setup roles
    const MINTER_ROLE = await nft.MINTER_ROLE();
    const PAUSER_ROLE = await nft.PAUSER_ROLE();

    await nft.grantRole(MINTER_ROLE, minter.address);
    await nft.grantRole(PAUSER_ROLE, pauser.address);
  });

  describe("Configuration and Tiers", function () {
    it("Should configure tiers correctly", async function () {
      await expect(nft.configureTier(1, "Common", 1000))
        .to.emit(nft, "TierConfigured")
        .withArgs(1, "Common", 1000);

      expect(await nft.tokenTiers(1)).to.equal("Common");
      expect(await nft.tokenMaxSupply(1)).to.equal(1000);
    });

    it("Should revert if non-admin tries to configure tiers", async function () {
      await expect(
        nft.connect(user1).configureTier(1, "Common", 1000)
      ).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Minting", function () {
    beforeEach(async function () {
      await nft.configureTier(1, "Common", 100);
      await nft.configureTier(2, "Rare", 50);
    });

    it("Should mint successfully if called by minter", async function () {
      await nft.connect(minter).mint(user1.address, 1, 10, "0x");
      expect(await nft.balanceOf(user1.address, 1)).to.equal(10);
      expect(await nft["totalSupply(uint256)"](1)).to.equal(10);
    });

    it("Should revert if non-minter tries to mint", async function () {
      await expect(
        nft.connect(user1).mint(user1.address, 1, 10, "0x")
      ).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });

    it("Should revert if minting exceeds max supply", async function () {
      await nft.connect(minter).mint(user1.address, 1, 100, "0x");
      await expect(
        nft.connect(minter).mint(user2.address, 1, 1, "0x")
      ).to.be.revertedWith("Max supply exceeded");
    });
  });

  describe("Batch Minting", function () {
    beforeEach(async function () {
      await nft.configureTier(1, "Common", 100);
      await nft.configureTier(2, "Rare", 50);
    });

    it("Should batch mint successfully", async function () {
      await nft.connect(minter).mintBatch(user1.address, [1, 2], [10, 5], "0x");
      expect(await nft.balanceOf(user1.address, 1)).to.equal(10);
      expect(await nft.balanceOf(user1.address, 2)).to.equal(5);
    });

    it("Should revert batch mint if exceeding supply", async function () {
      await expect(
        nft.connect(minter).mintBatch(user1.address, [1, 2], [10, 51], "0x")
      ).to.be.revertedWith("Max supply exceeded");
    });
  });

  describe("Transfers and Approval", function () {
    beforeEach(async function () {
      await nft.connect(minter).mint(user1.address, 1, 10, "0x");
    });

    it("Should transfer tokens between accounts", async function () {
      await nft.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 4, "0x");
      expect(await nft.balanceOf(user1.address, 1)).to.equal(6);
      expect(await nft.balanceOf(user2.address, 1)).to.equal(4);
    });

    it("Should approve operator and allow transfer", async function () {
      await nft.connect(user1).setApprovalForAll(admin.address, true);
      expect(await nft.isApprovedForAll(user1.address, admin.address)).to.be.true;

      await nft.connect(admin).safeTransferFrom(user1.address, user2.address, 1, 5, "0x");
      expect(await nft.balanceOf(user2.address, 1)).to.equal(5);
    });
  });

  describe("Pause and Unpause", function () {
    beforeEach(async function () {
      await nft.connect(minter).mint(user1.address, 1, 10, "0x");
    });

    it("Should allow pauser to pause and unpause", async function () {
      await nft.connect(pauser).pause();
      expect(await nft.paused()).to.be.true;

      await nft.connect(pauser).unpause();
      expect(await nft.paused()).to.be.false;
    });

    it("Should block transfers when paused", async function () {
      await nft.connect(pauser).pause();

      await expect(
        nft.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 2, "0x")
      ).to.be.revertedWithCustomError(nft, "EnforcedPause");
    });

    it("Should revert if non-pauser tries to pause", async function () {
      await expect(
        nft.connect(user1).pause()
      ).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });
  });
});
