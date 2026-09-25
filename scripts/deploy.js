import { time } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

// Note: To use the helper properly in a live script, we bypass the time.increase since we can't advance real time easily. 
// But since timelock is 24 hours, proposing now means we'd have to wait 24h to execute. 
// However, the Master Prompt says "Configure Roles, Tiers, Treasury, Fees, and Timelock parameters."
// Since this is deployment, we can either:
// 1) Initialize the contract WITH these parameters in the constructor (which we didn't).
// 2) The admin proposes, but must wait 24 hours to execute. This is realistic. 
// Let's create the proposals in the deploy script. The admin will execute them tomorrow.
// Wait, the prompt implies configuring them. Let's submit the proposals.

async function main() {
    console.log("Starting deployment to Sepolia...");
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("Account balance:", hre.ethers.formatEther(balance));

    // 1. Deploy NFTContract.sol
    const NFT = await hre.ethers.getContractFactory("NFTContract");
    const nft = await NFT.deploy("https://api.example.com/{id}.json");
    await nft.waitForDeployment();
    const nftAddress = await nft.getAddress();
    console.log("NFTContract deployed to:", nftAddress);

    // 2. Deploy RewardToken.sol
    const RewardToken = await hre.ethers.getContractFactory("RewardToken");
    const rewardToken = await RewardToken.deploy("AURA", "AURA", hre.ethers.parseEther("10000000"));
    await rewardToken.waitForDeployment();
    const tokenAddress = await rewardToken.getAddress();
    console.log("RewardToken deployed to:", tokenAddress);

    // 3. Deploy NFTStaking.sol
    const NFTStaking = await hre.ethers.getContractFactory("NFTStaking");
    const staking = await NFTStaking.deploy(nftAddress, tokenAddress);
    await staking.waitForDeployment();
    const stakingAddress = await staking.getAddress();
    console.log("NFTStaking deployed to:", stakingAddress);

    // 4. Configure Roles
    console.log("Configuring Roles...");
    const PARAMETER_MANAGER_ROLE = await staking.PARAMETER_MANAGER_ROLE();
    const REWARD_MANAGER_ROLE = await staking.REWARD_MANAGER_ROLE();
    const TREASURY_MANAGER_ROLE = await staking.TREASURY_MANAGER_ROLE();
    const PAUSER_ROLE = await staking.PAUSER_ROLE();
    
    let tx;
    tx = await staking.grantRole(PARAMETER_MANAGER_ROLE, deployer.address);
    await tx.wait(1);
    tx = await staking.grantRole(REWARD_MANAGER_ROLE, deployer.address);
    await tx.wait(1);
    tx = await staking.grantRole(TREASURY_MANAGER_ROLE, deployer.address);
    await tx.wait(1);
    tx = await staking.grantRole(PAUSER_ROLE, deployer.address);
    await tx.wait(1);
    
    // Give minter role to deployer.
    const MINTER_ROLE = await rewardToken.MINTER_ROLE();
    tx = await rewardToken.grantRole(MINTER_ROLE, deployer.address);
    await tx.wait(1);

    // 5. Configure Treasury
    console.log("Configuring Treasury...");
    const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
    tx = await staking.setTreasury(treasuryAddress);
    await tx.wait(1);
    tx = await staking.setRewardSupportPool(treasuryAddress);
    await tx.wait(1);

    // 6. Propose Parameters (Timelock)
    console.log("Proposing Timelocked Parameters...");
    
    // Reward Rate: 10 STAKY per day = 10/86400 ether per sec
    const PARAM_REWARD_RATE = await staking.PARAM_REWARD_RATE();
    const rateData = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, hre.ethers.parseEther("10") / 86400n]);
    tx = await staking.proposeParameterChange(PARAM_REWARD_RATE, rateData);
    await tx.wait(1);
    console.log("Proposed Reward Rate.");

    // Loyalty Tier: 30 days -> 1.50x
    const PARAM_LOYALTY_TIER = await staking.PARAM_LOYALTY_TIER();
    const tierData = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [30 * 86400, 15000]);
    tx = await staking.proposeParameterChange(PARAM_LOYALTY_TIER, tierData);
    await tx.wait(1);
    console.log("Proposed Loyalty Tier.");

    // Staking Fee: 0.001 ETH, 70/30 split
    const PARAM_STAKING_FEE = await staking.PARAM_STAKING_FEE();
    const feeData = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256"], [hre.ethers.parseEther("0.001"), 7000, 3000]);
    tx = await staking.proposeParameterChange(PARAM_STAKING_FEE, feeData);
    await tx.wait(1);
    console.log("Proposed Staking Fee.");

    // Unstaking Penalty: 30 days lock, 20% penalty, 50/50 split
    const PARAM_UNSTAKING_PENALTY = await staking.PARAM_UNSTAKING_PENALTY();
    const penaltyData = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256", "uint256"], [30 * 86400, 2000, 5000, 5000]);
    tx = await staking.proposeParameterChange(PARAM_UNSTAKING_PENALTY, penaltyData);
    await tx.wait(1);
    console.log("Proposed Unstaking Penalty.");

    // 7. Fund the Reward Pool
    console.log("Funding Reward Pool with 1,000,000 STAKY...");
    const fundAmount = hre.ethers.parseEther("1000000");
    tx = await rewardToken.mint(deployer.address, fundAmount);
    await tx.wait(1);
    tx = await rewardToken.approve(stakingAddress, fundAmount);
    await tx.wait(1);
    tx = await staking.fundRewardPool(fundAmount);
    await tx.wait(1);
    
    console.log("\n=================================");
    console.log("DEPLOYMENT & CONFIGURATION COMPLETE");
    console.log("NFTContract:", nftAddress);
    console.log("RewardToken:", tokenAddress);
    console.log("NFTStaking:", stakingAddress);
    console.log("Note: Timelocked parameters have been PROPOSED. You must call executeParameterChange in 24 hours.");
    console.log("=================================\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
