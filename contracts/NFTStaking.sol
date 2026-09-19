// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IStaking.sol";

    error InsufficientRewardPool();

contract NFTStaking is IStaking, AccessControl, Pausable, ReentrancyGuard, ERC1155Holder {
    using SafeERC20 for IERC20;

    bytes32 public constant PARAMETER_MANAGER_ROLE = keccak256("PARAMETER_MANAGER_ROLE");
    bytes32 public constant REWARD_MANAGER_ROLE = keccak256("REWARD_MANAGER_ROLE");
    bytes32 public constant TREASURY_MANAGER_ROLE = keccak256("TREASURY_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC1155 public immutable nftContract;
    IERC20 public immutable rewardToken;

    struct TokenRewardData {
        uint256 rewardRate; // Tokens per second per 1 unit of NFT
        uint256 accRewardPerNFT;
        uint256 lastUpdateTime;
    }

    struct MultiplierTier {
        uint256 minDuration; // in seconds
        uint256 multiplierBps; // 10000 = 1x
    }

    // --- STORAGE ---
    mapping(uint256 => StakePosition) public positions;
    mapping(address => uint256[]) public userPositions;
    uint256 public nextPositionId = 1;

    mapping(uint256 => TokenRewardData) public rewardData;
    MultiplierTier[] public loyaltyTiers;

    // Timelock Proposals
    mapping(bytes32 => ParameterProposal) public parameterProposals;
    // Security configuration
    uint256 public constant TIMELOCK_DELAY = 0;
    bytes32 public constant PARAM_REWARD_RATE = keccak256("REWARD_RATE");
    bytes32 public constant PARAM_LOYALTY_TIER = keccak256("LOYALTY_TIER");
    bytes32 public constant PARAM_STAKING_FEE = keccak256("STAKING_FEE");
    bytes32 public constant PARAM_UNSTAKING_PENALTY = keccak256("UNSTAKING_PENALTY");

    // Configurations
    uint256 public stakingFee;
    uint256 public feeTreasuryShareBps;
    uint256 public feeRewardPoolShareBps;
    
    address public treasury;
    address public rewardSupportPool;

    // Unstaking Penalty Configs
    uint256 public lockDuration;
    uint256 public penaltyBps;
    uint256 public penaltyTreasuryShareBps;
    uint256 public penaltyRewardPoolShareBps;

    // Reward Pool Metrics
    uint256 public totalFunded;
    uint256 public totalDistributed;
    uint256 public totalClaimed;

    // Base limits
    uint256 public constant MAX_PENALTY = 3000; // 30%
    uint256 public constant MAX_MULTIPLIER = 20000; // 2.00x = 20000 bps
    uint256 public constant MAX_STAKING_FEE = 0.01 ether;
    uint256 public constant MAX_REWARD_RATE = 1000 ether;
    uint256 public constant MAX_LOCK_DURATION = 365 days;

    constructor(address _nftContract, address _rewardToken) {
        require(_nftContract != address(0), "Zero address for NFT");
        require(_rewardToken != address(0), "Zero address for Token");
        
        nftContract = IERC1155(_nftContract);
        rewardToken = IERC20(_rewardToken);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PARAMETER_MANAGER_ROLE, msg.sender);
        _grantRole(REWARD_MANAGER_ROLE, msg.sender);
        _grantRole(TREASURY_MANAGER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    // --- REWARD ENGINE CORE ---

    function updateRewardData(uint256 tokenId) internal {
        TokenRewardData storage data = rewardData[tokenId];
        if (block.timestamp > data.lastUpdateTime) {
            if (data.rewardRate > 0) {
                uint256 timeDelta = block.timestamp - data.lastUpdateTime;
                data.accRewardPerNFT += timeDelta * data.rewardRate;
            }
            data.lastUpdateTime = block.timestamp;
        }
    }

    // --- TIMELOCK GOVERNANCE ---

    function proposeParameterChange(bytes32 parameterId, bytes calldata data) external {
        if (parameterId == PARAM_REWARD_RATE) {
            _checkRole(REWARD_MANAGER_ROLE);
            (, uint256 rate) = abi.decode(data, (uint256, uint256));
            require(rate <= MAX_REWARD_RATE, "Rate exceeds max");
        } else if (parameterId == PARAM_LOYALTY_TIER) {
            _checkRole(PARAMETER_MANAGER_ROLE);
            (uint256 minDuration, uint256 multiplierBps) = abi.decode(data, (uint256, uint256));
            require(multiplierBps <= MAX_MULTIPLIER, "Multiplier exceeds max");
            if (loyaltyTiers.length > 0) {
                require(minDuration > loyaltyTiers[loyaltyTiers.length - 1].minDuration, "Invalid duration order");
            }
        } else if (parameterId == PARAM_STAKING_FEE) {
            _checkRole(PARAMETER_MANAGER_ROLE);
            (uint256 fee, uint256 _treasuryBps, uint256 _rewardPoolBps) = abi.decode(data, (uint256, uint256, uint256));
            require(fee <= MAX_STAKING_FEE, "Fee exceeds max limit");
            require(_treasuryBps + _rewardPoolBps == 10000, "BPS must equal 10000");
        } else if (parameterId == PARAM_UNSTAKING_PENALTY) {
            _checkRole(PARAMETER_MANAGER_ROLE);
            (uint256 _lockDuration, uint256 _penaltyBps, uint256 _treasuryShareBps, uint256 _rewardPoolShareBps) = abi.decode(data, (uint256, uint256, uint256, uint256));
            require(_lockDuration <= MAX_LOCK_DURATION, "Lock duration exceeds max");
            require(_penaltyBps <= MAX_PENALTY, "Penalty exceeds max");
            require(_treasuryShareBps + _rewardPoolShareBps == 10000, "BPS must equal 10000");
        } else {
            revert("Invalid parameterId");
        }

        parameterProposals[parameterId] = ParameterProposal({
            parameterId: parameterId,
            data: data,
            executeAfter: block.timestamp + TIMELOCK_DELAY,
            executed: false,
            canceled: false,
            proposer: msg.sender
        });

        emit ParameterChangeProposed(parameterId, data, block.timestamp + TIMELOCK_DELAY, msg.sender);
    }

    function cancelParameterChange(bytes32 parameterId) external {
        ParameterProposal storage proposal = parameterProposals[parameterId];
        require(proposal.executeAfter > 0, "No proposal");
        require(!proposal.executed, "Already executed");
        require(!proposal.canceled, "Already canceled");
        
        if (parameterId == PARAM_REWARD_RATE) {
            _checkRole(REWARD_MANAGER_ROLE);
        } else {
            _checkRole(PARAMETER_MANAGER_ROLE);
        }
        
        proposal.canceled = true;
        emit ParameterChangeCancelled(parameterId);
    }

    function executeParameterChange(bytes32 parameterId) external {
        ParameterProposal storage proposal = parameterProposals[parameterId];
        require(proposal.executeAfter > 0, "No proposal");
        require(block.timestamp >= proposal.executeAfter, "Timelock active");
        require(!proposal.executed, "Already executed");
        require(!proposal.canceled, "Canceled");

        proposal.executed = true;

        if (parameterId == PARAM_REWARD_RATE) {
            (uint256 tokenId, uint256 rate) = abi.decode(proposal.data, (uint256, uint256));
            updateRewardData(tokenId);
            rewardData[tokenId].rewardRate = rate;
        } else if (parameterId == PARAM_LOYALTY_TIER) {
            (uint256 minDuration, uint256 multiplierBps) = abi.decode(proposal.data, (uint256, uint256));
            loyaltyTiers.push(MultiplierTier({
                minDuration: minDuration,
                multiplierBps: multiplierBps
            }));
        } else if (parameterId == PARAM_STAKING_FEE) {
            (uint256 fee, uint256 _treasuryBps, uint256 _rewardPoolBps) = abi.decode(proposal.data, (uint256, uint256, uint256));
            stakingFee = fee;
            feeTreasuryShareBps = _treasuryBps;
            feeRewardPoolShareBps = _rewardPoolBps;
        } else if (parameterId == PARAM_UNSTAKING_PENALTY) {
            (uint256 _lockDuration, uint256 _penaltyBps, uint256 _treasuryShareBps, uint256 _rewardPoolShareBps) = abi.decode(proposal.data, (uint256, uint256, uint256, uint256));
            lockDuration = _lockDuration;
            penaltyBps = _penaltyBps;
            penaltyTreasuryShareBps = _treasuryShareBps;
            penaltyRewardPoolShareBps = _rewardPoolShareBps;
        }

        emit ParameterChangeExecuted(parameterId, proposal.data);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
    }

    function setRewardSupportPool(address _pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pool != address(0), "Zero address");
        rewardSupportPool = _pool;
    }

    // --- CIRCUIT BREAKERS ---
    
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _distributeFee(uint256 feeAmount) internal {
        if (feeAmount == 0) return;
        
        uint256 treasuryShare = (feeAmount * feeTreasuryShareBps) / 10000;
        uint256 rewardPoolShare = feeAmount - treasuryShare;
        
        if (treasuryShare > 0 && treasury != address(0)) {
            (bool success, ) = treasury.call{value: treasuryShare}("");
            require(success, "Treasury transfer failed");
        }
        
        if (rewardPoolShare > 0 && rewardSupportPool != address(0)) {
            (bool success, ) = rewardSupportPool.call{value: rewardPoolShare}("");
            require(success, "Reward pool transfer failed");
        }
        
        emit StakingFeeCollected(msg.sender, feeAmount, treasuryShare, rewardPoolShare);
    }

    function getMultiplier(uint256 startTime) public view returns (uint256) {
        if (loyaltyTiers.length == 0) return 10000; // default 1x
        
        uint256 duration = block.timestamp - startTime;
        uint256 currentMultiplier = 10000;
        
        for (uint256 i = 0; i < loyaltyTiers.length; i++) {
            if (duration >= loyaltyTiers[i].minDuration) {
                currentMultiplier = loyaltyTiers[i].multiplierBps;
            } else {
                break;
            }
        }
        
        return currentMultiplier;
    }

    // --- STAKING CORE ---

    function stake(uint256 tokenId, uint256 amount) external payable override nonReentrant whenNotPaused {
        require(amount > 0, "Cannot stake 0");
        require(msg.value == stakingFee, "Incorrect staking fee");
        
        _distributeFee(msg.value);
        
        updateRewardData(tokenId);

        // Transfer NFT to this contract
        nftContract.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        uint256 positionId = nextPositionId++;
        
        positions[positionId] = StakePosition({
            positionId: positionId,
            tokenId: tokenId,
            amount: amount,
            startTime: block.timestamp,
            lastUpdateTime: block.timestamp,
            rewardRateSnapshot: rewardData[tokenId].accRewardPerNFT,
            accumulatedReward: 0
        });

        userPositions[msg.sender].push(positionId);

        emit NFTStaked(msg.sender, positionId, tokenId, amount);
    }

    function stakeBatch(uint256[] calldata tokenIds, uint256[] calldata amounts) external payable override nonReentrant whenNotPaused {
        require(tokenIds.length == amounts.length, "Length mismatch");
        require(tokenIds.length > 0, "Empty arrays");
        
        uint256 expectedFee = stakingFee * tokenIds.length;
        require(msg.value == expectedFee, "Incorrect staking fee");

        _distributeFee(msg.value);

        nftContract.safeBatchTransferFrom(msg.sender, address(this), tokenIds, amounts, "");

        uint256[] memory positionIds = new uint256[](tokenIds.length);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(amounts[i] > 0, "Cannot stake 0");
            
            uint256 tokenId = tokenIds[i];
            updateRewardData(tokenId);
            
            uint256 positionId = nextPositionId++;
            
            positions[positionId] = StakePosition({
                positionId: positionId,
                tokenId: tokenId,
                amount: amounts[i],
                startTime: block.timestamp,
                lastUpdateTime: block.timestamp,
                rewardRateSnapshot: rewardData[tokenId].accRewardPerNFT,
                accumulatedReward: 0
            });

            userPositions[msg.sender].push(positionId);
            positionIds[i] = positionId;
        }

        emit NFTBatchStaked(msg.sender, positionIds, tokenIds, amounts);
    }

    function unstake(uint256 positionId) external override nonReentrant {
        StakePosition storage pos = positions[positionId];
        require(pos.amount > 0, "Position does not exist or already unstaked");
        require(_isOwnerOfPosition(msg.sender, positionId), "Not position owner");

        _claimRewards(positionId);

        uint256 amount = pos.amount;
        uint256 tokenId = pos.tokenId;
        
        pos.amount = 0;

        nftContract.safeTransferFrom(address(this), msg.sender, tokenId, amount, "");
        emit NFTUnstaked(msg.sender, positionId, tokenId, amount);
    }

    function unstakeBatch(uint256[] calldata positionIds) external override nonReentrant {
        require(positionIds.length > 0, "Empty arrays");

        uint256[] memory tokenIds = new uint256[](positionIds.length);
        uint256[] memory amounts = new uint256[](positionIds.length);

        for (uint256 i = 0; i < positionIds.length; i++) {
            uint256 positionId = positionIds[i];
            StakePosition storage pos = positions[positionId];
            require(pos.amount > 0, "Position does not exist");
            require(_isOwnerOfPosition(msg.sender, positionId), "Not position owner");

            _claimRewards(positionId);

            tokenIds[i] = pos.tokenId;
            amounts[i] = pos.amount;
            pos.amount = 0;
        }

        nftContract.safeBatchTransferFrom(address(this), msg.sender, tokenIds, amounts, "");
        emit NFTBatchUnstaked(msg.sender, positionIds, tokenIds, amounts);
    }

    function claimRewards(uint256 positionId) external override nonReentrant {
        require(_isOwnerOfPosition(msg.sender, positionId), "Not position owner");
        _claimRewards(positionId);
    }

    function claimAllRewards() external override nonReentrant {
        uint256[] memory userPos = userPositions[msg.sender];
        uint256 _totalClaimed = 0;
        
        for (uint256 i = 0; i < userPos.length; i++) {
            uint256 posId = userPos[i];
            _totalClaimed += _claimRewards(posId);
        }
        
        require(_totalClaimed > 0, "No rewards to claim");
    }

    function _claimRewards(uint256 positionId) internal returns (uint256) {
        StakePosition storage pos = positions[positionId];
        
        uint256 rewardToClaim = pendingRewards(positionId);
        if (rewardToClaim == 0) return 0;

        // CEI: Update state before transfer
        if (pos.amount > 0) {
            updateRewardData(pos.tokenId);
            pos.rewardRateSnapshot = rewardData[pos.tokenId].accRewardPerNFT;
        }
        pos.accumulatedReward = 0;

        uint256 penaltyAmount = 0;
        if (block.timestamp - pos.startTime < lockDuration && penaltyBps > 0) {
            penaltyAmount = (rewardToClaim * penaltyBps) / 10000;
        }
        
        uint256 userReward = rewardToClaim - penaltyAmount;

        // Check pool liquidity
        if (availableBalance() < rewardToClaim) {
            revert InsufficientRewardPool();
        }

        totalDistributed += rewardToClaim;
        totalClaimed += userReward;

        // Penalty Distribution
        if (penaltyAmount > 0) {
            uint256 treasuryShare = (penaltyAmount * penaltyTreasuryShareBps) / 10000;
            uint256 rewardPoolShare = penaltyAmount - treasuryShare;
            
            if (treasuryShare > 0 && treasury != address(0)) {
                rewardToken.safeTransfer(treasury, treasuryShare);
            }
            
            emit PenaltyCollected(msg.sender, penaltyAmount, treasuryShare, rewardPoolShare);
        }

        // Transfer reward
        if (userReward > 0) {
            rewardToken.safeTransfer(msg.sender, userReward);
        }
        emit RewardClaimed(msg.sender, userReward);
        
        return userReward;
    }

    function pendingRewards(uint256 positionId) public view override returns (uint256) {
        StakePosition memory pos = positions[positionId];
        if (pos.amount == 0) return 0; // Or return what was accumulated before unstake if we support that later

        TokenRewardData memory data = rewardData[pos.tokenId];
        
        uint256 currentAccRewardPerNFT = data.accRewardPerNFT;
        if (block.timestamp > data.lastUpdateTime && data.rewardRate > 0) {
            uint256 timeDelta = block.timestamp - data.lastUpdateTime;
            currentAccRewardPerNFT += timeDelta * data.rewardRate;
        }

        uint256 baseReward = pos.amount * (currentAccRewardPerNFT - pos.rewardRateSnapshot);
        uint256 multiplierBps = getMultiplier(pos.startTime);
        
        uint256 multipliedReward = (baseReward * multiplierBps) / 10000;
        
        return pos.accumulatedReward + multipliedReward;
    }

    function fundRewardPool(uint256 amount) external override onlyRole(REWARD_MANAGER_ROLE) nonReentrant {
        require(amount > 0, "Cannot fund 0");
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        totalFunded += amount;
        emit RewardPoolFunded(msg.sender, amount);
    }

    function availableBalance() public view returns (uint256) {
        return rewardToken.balanceOf(address(this));
    }

    function getUserPositions(address user) external view returns (uint256[] memory) {
        return userPositions[user];
    }

    function _isOwnerOfPosition(address user, uint256 positionId) internal view returns (bool) {
        uint256[] memory userPos = userPositions[user];
        for (uint256 i = 0; i < userPos.length; i++) {
            if (userPos[i] == positionId) {
                return true;
            }
        }
        return false;
    }

    // --- OVERRIDES ---
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl, ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
