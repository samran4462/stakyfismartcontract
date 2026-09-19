import hre from "hardhat";

// NFT Contract address from deployment
const NFT_ADDRESS = "0xa9ED3f441Ba9e50a187e1498E54e7a1362ec2772";
const STAKING_ADDRESS = "0x6849F813AaD22c1c3b378ca5Cd72da2839E4AE16";

// NFTContract ABI (minimal)
const NFT_ABI = [
  "function mint(address to, uint256 id, uint256 amount, bytes memory data) external",
  "function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) external",
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address account, address operator) external view returns (bool)",
  "function configureTier(uint256 tokenId, uint256 maxSupply) external",
  "function MINTER_ROLE() external view returns (bytes32)",
  "function grantRole(bytes32 role, address account) external",
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Using account:", deployer.address);

  const nft = new hre.ethers.Contract(NFT_ADDRESS, NFT_ABI, deployer);

  // 1. Configure tiers (if not already done)
  console.log("\nConfiguring tiers...");
  try {
    let tx = await nft.configureTier(1, 10000); await tx.wait(1); console.log("Tier 1 configured");
    tx = await nft.configureTier(2, 5000);  await tx.wait(1); console.log("Tier 2 configured");
    tx = await nft.configureTier(3, 2000);  await tx.wait(1); console.log("Tier 3 configured");
    tx = await nft.configureTier(4, 1000);  await tx.wait(1); console.log("Tier 4 configured");
  } catch (e) {
    console.log("Tiers may already be configured:", e.message?.slice(0, 80));
  }

  // 2. Mint NFTs to deployer (admin wallet)
  console.log("\nMinting NFTs...");
  const tx = await nft.mintBatch(
    deployer.address,
    [1, 2, 3, 4],           // Token IDs
    [10, 5, 3, 2],          // Amounts
    "0x"
  );
  await tx.wait(1);
  console.log("Minted: 10x Tier1, 5x Tier2, 3x Tier3, 2x Tier4");

  // 3. Check balances
  const b1 = await nft.balanceOf(deployer.address, 1);
  const b2 = await nft.balanceOf(deployer.address, 2);
  const b3 = await nft.balanceOf(deployer.address, 3);
  const b4 = await nft.balanceOf(deployer.address, 4);
  console.log(`\nBalances — Tier1: ${b1}, Tier2: ${b2}, Tier3: ${b3}, Tier4: ${b4}`);

  // 4. Approve staking contract
  const approved = await nft.isApprovedForAll(deployer.address, STAKING_ADDRESS);
  if (!approved) {
    const approveTx = await nft.setApprovalForAll(STAKING_ADDRESS, true);
    await approveTx.wait(1);
    console.log("\nStaking contract approved for all NFTs");
  } else {
    console.log("\nStaking contract already approved");
  }

  console.log("\n=== SETUP COMPLETE ===");
  console.log("Admin wallet has NFTs and staking is approved.");
  console.log("Go to /dashboard to see your NFT balances.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
