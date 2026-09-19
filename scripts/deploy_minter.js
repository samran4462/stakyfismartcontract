import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying PublicMinter with account:", deployer.address);

  const NFT_CONTRACT_ADDRESS = "0xa9ED3f441Ba9e50a187e1498E54e7a1362ec2772";

  // Deploy PublicMinter
  const PublicMinter = await hre.ethers.getContractFactory("PublicMinter");
  const publicMinter = await PublicMinter.deploy(NFT_CONTRACT_ADDRESS);
  await publicMinter.waitForDeployment();
  const minterAddress = await publicMinter.getAddress();
  
  console.log("PublicMinter deployed to:", minterAddress);

  // Grant MINTER_ROLE on NFTContract
  const abi = [
    "function grantRole(bytes32 role, address account) external",
    "function MINTER_ROLE() view returns (bytes32)"
  ];
  const nftContract = new hre.ethers.Contract(NFT_CONTRACT_ADDRESS, abi, deployer);

  console.log("Fetching MINTER_ROLE...");
  const minterRole = await nftContract.MINTER_ROLE();
  
  console.log("Granting MINTER_ROLE to PublicMinter...");
  const tx = await nftContract.grantRole(minterRole, minterAddress);
  console.log("Transaction Hash:", tx.hash);
  await tx.wait();
  
  console.log("MINTER_ROLE granted successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
