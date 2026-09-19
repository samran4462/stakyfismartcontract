import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying new NFTStaking contract with account:", deployer.address);

  const NFT_ADDRESS = "0xa9ED3f441Ba9e50a187e1498E54e7a1362ec2772";
  const STAKY_ADDRESS = "0xcD6e413F8Dec4cd8919412E11B1db905bE89fB61";

  // Deploy new staking contract
  const NFTStaking = await hre.ethers.getContractFactory("NFTStaking");
  const staking = await NFTStaking.deploy(NFT_ADDRESS, STAKY_ADDRESS);
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  console.log("New NFTStaking (V2) deployed to:", stakingAddress);

  // Setup STAKY tokens for reward pool
  console.log("Approving STAKY tokens for staking contract...");
  const erc20Abi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function mint(address to, uint256 amount) external",
    "function balanceOf(address account) view returns (uint256)"
  ];
  const staky = new hre.ethers.Contract(STAKY_ADDRESS, erc20Abi, deployer);

  // Mint 1,000,000 STAKY to admin wallet
  const fundAmount = hre.ethers.parseEther("1000000");
  console.log("Minting STAKY to admin...");
  let mintTx = await staky.mint(deployer.address, fundAmount);
  await mintTx.wait(1);

  // Approve and Fund Reward Pool (1,000,000 STAKY)
  let tx = await staky.approve(stakingAddress, fundAmount);
  await tx.wait(1);
  console.log("Approved STAKY.");

  console.log("Funding Reward Pool...");
  tx = await staking.fundRewardPool(fundAmount);
  await tx.wait(1);
  console.log("Reward Pool funded successfully.");

  // Propose and Execute Reward Rates
  console.log("Setting Reward Rates for Tiers 1 to 4...");
  
  // Rate: 0.05 STAKY per second
  const baseRate = hre.ethers.parseEther("0.05");
  
  const PARAM_REWARD_RATE = hre.ethers.id("REWARD_RATE"); // keccak256("REWARD_RATE")

  for (let tier = 1; tier <= 4; tier++) {
    // encode (tokenId, rate)
    const rateToSet = baseRate * BigInt(tier); // Tier 1: 0.05, Tier 2: 0.1, Tier 3: 0.15, Tier 4: 0.2
    const encodedData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [tier, rateToSet]
    );
    
    console.log(`Proposing Reward Rate for Tier ${tier} (${hre.ethers.formatEther(rateToSet)} STAKY/sec)...`);
    tx = await staking.proposeParameterChange(PARAM_REWARD_RATE, encodedData);
    await tx.wait(1);
    
    console.log(`Executing Reward Rate for Tier ${tier}...`);
    tx = await staking.executeParameterChange(PARAM_REWARD_RATE);
    await tx.wait(1);
  }

  console.log("All Reward Rates set successfully! New staking contract is ready.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
