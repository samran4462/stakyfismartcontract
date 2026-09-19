import { time } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

export async function setRewardRateHelper(staking, manager, tokenId, rate) {
    const PARAM_REWARD_RATE = await staking.PARAM_REWARD_RATE();
    const data = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [tokenId, rate]);
    await staking.connect(manager).proposeParameterChange(PARAM_REWARD_RATE, data);
    await time.increase(86400);
    await staking.connect(manager).executeParameterChange(PARAM_REWARD_RATE);
}

export async function addLoyaltyTierHelper(staking, manager, duration, multiplier) {
    const PARAM_LOYALTY_TIER = await staking.PARAM_LOYALTY_TIER();
    const data = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [duration, multiplier]);
    await staking.connect(manager).proposeParameterChange(PARAM_LOYALTY_TIER, data);
    await time.increase(86400);
    await staking.connect(manager).executeParameterChange(PARAM_LOYALTY_TIER);
}

export async function setStakingFeeHelper(staking, manager, fee, treasuryBps, poolBps) {
    const PARAM_STAKING_FEE = await staking.PARAM_STAKING_FEE();
    const data = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256"], [fee, treasuryBps, poolBps]);
    await staking.connect(manager).proposeParameterChange(PARAM_STAKING_FEE, data);
    await time.increase(86400);
    await staking.connect(manager).executeParameterChange(PARAM_STAKING_FEE);
}

export async function setUnstakingPenaltyHelper(staking, manager, duration, penalty, treasuryBps, poolBps) {
    const PARAM_UNSTAKING_PENALTY = await staking.PARAM_UNSTAKING_PENALTY();
    const data = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint256", "uint256"], [duration, penalty, treasuryBps, poolBps]);
    await staking.connect(manager).proposeParameterChange(PARAM_UNSTAKING_PENALTY, data);
    await time.increase(86400);
    await staking.connect(manager).executeParameterChange(PARAM_UNSTAKING_PENALTY);
}
