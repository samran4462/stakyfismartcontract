import hre from "hardhat";

async function main() {
  const [admin] = await hre.ethers.getSigners();
  console.log("Setting URI using account:", admin.address);

  // Address of NFTContract from our config
  const NFT_CONTRACT_ADDRESS = "0xa9ED3f441Ba9e50a187e1498E54e7a1362ec2772";

  // ABI for setURI
  const abi = [
    "function setURI(string memory newuri) external"
  ];

  const nftContract = new hre.ethers.Contract(NFT_CONTRACT_ADDRESS, abi, admin);

  const newUri = "http://localhost:5173/metadata/{id}.json";
  
  console.log("Setting new URI to:", newUri);
  const tx = await nftContract.setURI(newUri);
  console.log("Transaction Hash:", tx.hash);
  
  await tx.wait();
  console.log("URI updated successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
