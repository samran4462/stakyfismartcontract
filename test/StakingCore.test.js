import { expect } from "chai";
import hre from "hardhat";
import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";

describe("NFTStaking (Phase 4 - Core)", function () {
  let nft, token, staking;
  let admin, user1, user2;

  beforeEach(async function () {
    [admin, user1, user2] = await hre.ethers.getSigners();

    // Deploy NFT
    const NFT = await hre.ethers.getContractFactory("NFTContract");
    nft = await NFT.deploy("https://api.example.com/{id}.json");
    await nft.waitForDeployment();

    // Deploy Token
    const Token = await hre.ethers.getContractFactory("RewardToken");
    token = await Token.deploy("Staking Reward", "STAKY", hre.ethers.parseEther("1000000"));
    await token.waitForDeployment();

    // Deploy Staking
    const Staking = await hre.ethers.getContractFactory("NFTStaking");
    staking = await Staking.deploy(await nft.getAddress(), await token.getAddress());
    await staking.waitForDeployment();

    // Setup NFT config
    await nft.configureTier(1, "Common", 1000);
    await nft.configureTier(2, "Rare", 500);

    // Mint NFTs to users
    await nft.mint(user1.address, 1, 10, "0x");
    await nft.mint(user2.address, 2, 5, "0x");

    // Approve staking contract
    await nft.connect(user1).setApprovalForAll(await staking.getAddress(), true);
    await nft.connect(user2).setApprovalForAll(await staking.getAddress(), true);
  });

  describe("Staking", function () {
    it("Should allow a user to stake an NFT and create a position", async function () {
      const tx = await staking.connect(user1).stake(1, 2);
      await expect(tx).to.emit(staking, "NFTStaked").withArgs(user1.address, 1, 1, 2);

      // Check NFT balances
      expect(await nft.balanceOf(user1.address, 1)).to.equal(8);
      expect(await nft.balanceOf(await staking.getAddress(), 1)).to.equal(2);

      // Check position state
      const pos = await staking.positions(1);
      expect(pos.positionId).to.equal(1);
      expect(pos.tokenId).to.equal(1);
      expect(pos.amount).to.equal(2);
      expect(pos.startTime).to.be.gt(0);

      // Check user positions
      const userPositions = await staking.getUserPositions(user1.address);
      expect(userPositions.length).to.equal(1);
      expect(userPositions[0]).to.equal(1);
    });

    it("Should allow multiple independent positions for the same NFT", async function () {
      await staking.connect(user1).stake(1, 2);
      await staking.connect(user1).stake(1, 3); // Another position

      const pos1 = await staking.positions(1);
      const pos2 = await staking.positions(2);

      expect(pos1.amount).to.equal(2);
      expect(pos2.amount).to.equal(3);

      const userPositions = await staking.getUserPositions(user1.address);
      expect(userPositions.length).to.equal(2);
      expect(userPositions[0]).to.equal(1);
      expect(userPositions[1]).to.equal(2);
    });

    it("Should fail if amount is 0", async function () {
      await expect(
        staking.connect(user1).stake(1, 0)
      ).to.be.revertedWith("Cannot stake 0");
    });
  });

  describe("Batch Staking", function () {
    beforeEach(async function () {
      await nft.mint(user1.address, 2, 5, "0x");
    });

    it("Should allow batch staking multiple NFTs", async function () {
      const tx = await staking.connect(user1).stakeBatch([1, 2], [3, 4]);
      
      // Position 1 for token 1, Position 2 for token 2
      const pos1 = await staking.positions(1);
      const pos2 = await staking.positions(2);

      expect(pos1.tokenId).to.equal(1);
      expect(pos1.amount).to.equal(3);
      expect(pos2.tokenId).to.equal(2);
      expect(pos2.amount).to.equal(4);

      // NFTs custody
      expect(await nft.balanceOf(await staking.getAddress(), 1)).to.equal(3);
      expect(await nft.balanceOf(await staking.getAddress(), 2)).to.equal(4);

      const userPositions = await staking.getUserPositions(user1.address);
      expect(userPositions.length).to.equal(2);
    });
  });

  describe("Unstaking", function () {
    beforeEach(async function () {
      await staking.connect(user1).stake(1, 4);
    });

    it("Should allow user to unstake completely", async function () {
      const tx = await staking.connect(user1).unstake(1);
      await expect(tx).to.emit(staking, "NFTUnstaked").withArgs(user1.address, 1, 1, 4);

      // Check NFT returned
      expect(await nft.balanceOf(user1.address, 1)).to.equal(10);
      expect(await nft.balanceOf(await staking.getAddress(), 1)).to.equal(0);

      // Check position state marked 0
      const pos = await staking.positions(1);
      expect(pos.amount).to.equal(0);
    });

    it("Should revert if unauthorized user unstakes", async function () {
      await expect(
        staking.connect(user2).unstake(1)
      ).to.be.revertedWith("Not position owner");
    });

    it("Should revert if already unstaked", async function () {
      await staking.connect(user1).unstake(1);
      await expect(
        staking.connect(user1).unstake(1)
      ).to.be.revertedWith("Position does not exist or already unstaked");
    });
  });

  describe("Batch Unstaking", function () {
    beforeEach(async function () {
      await nft.mint(user1.address, 2, 5, "0x");
      await staking.connect(user1).stakeBatch([1, 2], [3, 4]);
    });

    it("Should allow user to batch unstake", async function () {
      const tx = await staking.connect(user1).unstakeBatch([1, 2]);

      const pos1 = await staking.positions(1);
      const pos2 = await staking.positions(2);
      
      expect(pos1.amount).to.equal(0);
      expect(pos2.amount).to.equal(0);

      expect(await nft.balanceOf(user1.address, 1)).to.equal(10);
      expect(await nft.balanceOf(user1.address, 2)).to.equal(5);
    });
  });
});
