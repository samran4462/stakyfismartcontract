import hre from "hardhat";

const REWARD_TOKEN = "0xcD6e413F8Dec4cd8919412E11B1db905bE89fB61"; // STAKY
const ELN_NFT      = "0xCe56eceA6BBda665255a6E5f497168F22E131cFF"; // "Elon" ERC-721

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying NFTStaking721 with:", deployer.address);

  // 1. Deploy NFTStaking721
  const Factory = await hre.ethers.getContractFactory("NFTStaking721");
  const staking721 = await Factory.deploy(REWARD_TOKEN);
  await staking721.waitForDeployment();
  const staking721Address = await staking721.getAddress();
  console.log("NFTStaking721 deployed to:", staking721Address);

  // 2. Whitelist the ELN NFT collection
  //    Reward: 10 STAKY per day = 10e18 / 86400 per second
  const ratePerSec = hre.ethers.parseEther("10") / 86400n;
  let tx = await staking721.whitelistCollection(ELN_NFT, ratePerSec);
  await tx.wait(1);
  console.log("Whitelisted ELN NFT — Rate:", ratePerSec.toString(), "wei/sec");

  // 3. Fund reward pool with 100,000 STAKY
  const rewardToken = await hre.ethers.getContractAt("RewardToken", REWARD_TOKEN);
  const fundAmount = hre.ethers.parseEther("100000");
  tx = await rewardToken.mint(deployer.address, fundAmount);
  await tx.wait(1);
  tx = await rewardToken.approve(staking721Address, fundAmount);
  await tx.wait(1);
  tx = await staking721.fundRewardPool(fundAmount);
  await tx.wait(1);
  console.log("Funded 100,000 STAKY into reward pool");

  console.log("\n=== NFTStaking721 DEPLOYMENT COMPLETE ===");
  console.log("Contract:        ", staking721Address);
  console.log("Reward Token:    ", REWARD_TOKEN);
  console.log("ELN NFT:         ", ELN_NFT, "(whitelisted)");
  console.log("Rate:             10 STAKY / NFT / day");
  console.log("Pool:             100,000 STAKY");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
