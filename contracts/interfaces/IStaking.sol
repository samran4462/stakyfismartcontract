// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStaking {
    struct StakePosition {
        uint256 positionId;
        uint256 tokenId;
        uint256 amount;
        uint256 startTime;
        uint256 lastUpdateTime;
        uint256 rewardRateSnapshot;
        uint256 accumulatedReward;
    }

    struct ParameterProposal {
        bytes32 parameterId;
        bytes data;
        uint256 executeAfter;
        bool executed;
        bool canceled;
        address proposer;
    }

    // --- EVENTS ---
    event NFTStaked(address indexed user, uint256 indexed positionId, uint256 indexed tokenId, uint256 amount);
    event NFTBatchStaked(address indexed user, uint256[] positionIds, uint256[] tokenIds, uint256[] amounts);
    event NFTUnstaked(address indexed user, uint256 indexed positionId, uint256 indexed tokenId, uint256 amount);
    event NFTBatchUnstaked(address indexed user, uint256[] positionIds, uint256[] tokenIds, uint256[] amounts);
    
    event RewardClaimed(address indexed user, uint256 amount);
    event StakingFeeCollected(address indexed user, uint256 amount, uint256 treasuryShare, uint256 rewardPoolShare);
    event PenaltyCollected(address indexed user, uint256 amount, uint256 treasuryShare, uint256 rewardPoolShare);
    event RewardPoolFunded(address indexed funder, uint256 amount);
    
    event ParameterChangeProposed(bytes32 indexed parameterId, bytes data, uint256 executeAfter, address proposer);
    event ParameterChangeCancelled(bytes32 indexed parameterId);
    event ParameterChangeExecuted(bytes32 indexed parameterId, bytes data);

    // --- FUNCTIONS ---
    function stake(uint256 tokenId, uint256 amount) external payable;
    function stakeBatch(uint256[] calldata tokenIds, uint256[] calldata amounts) external payable;
    function unstake(uint256 positionId) external;
    function unstakeBatch(uint256[] calldata positionIds) external;
    
    function claimRewards(uint256 positionId) external;
    function claimAllRewards() external;
    
    function pendingRewards(uint256 positionId) external view returns (uint256);
    function fundRewardPool(uint256 amount) external;
}
