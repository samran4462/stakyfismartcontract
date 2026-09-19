// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title NFTStaking721
 * @notice Stake any ERC-721 NFT to earn ERC-20 STAKY rewards
 */
contract NFTStaking721 is IERC721Receiver, AccessControl, ReentrancyGuard, Pausable {

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct StakePosition {
        address nftContract;   // Which ERC-721 collection
        uint256 tokenId;       // Which NFT
        address staker;
        uint256 startTime;
        bool active;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20  public immutable rewardToken;

    // rewardRate: STAKY wei per second per staked NFT
    mapping(address => uint256) public rewardRatePerSec;  // nftContract => rate

    // positionId => StakePosition
    mapping(uint256 => StakePosition) public positions;
    uint256 public nextPositionId = 1;

    // user => list of positionIds
    mapping(address => uint256[]) public userPositions;

    // Whitelisted NFT collections
    mapping(address => bool) public whitelisted;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Staked(address indexed user, address nftContract, uint256 tokenId, uint256 positionId);
    event Unstaked(address indexed user, uint256 positionId, uint256 rewards);
    event RewardsClaimed(address indexed user, uint256 positionId, uint256 amount);
    event CollectionWhitelisted(address nftContract, uint256 rewardRatePerSec);
    event RewardPoolFunded(uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _rewardToken) {
        rewardToken = IERC20(_rewardToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    // ─── Admin Functions ──────────────────────────────────────────────────────

    /// @notice Whitelist an ERC-721 collection with a reward rate
    /// @param nftContract The ERC-721 contract address
    /// @param ratePerSec  STAKY tokens (in wei) earned per second per NFT
    function whitelistCollection(address nftContract, uint256 ratePerSec)
        external onlyRole(MANAGER_ROLE)
    {
        whitelisted[nftContract] = true;
        rewardRatePerSec[nftContract] = ratePerSec;
        emit CollectionWhitelisted(nftContract, ratePerSec);
    }

    function removeCollection(address nftContract) external onlyRole(MANAGER_ROLE) {
        whitelisted[nftContract] = false;
    }

    function fundRewardPool(uint256 amount) external onlyRole(MANAGER_ROLE) {
        rewardToken.transferFrom(msg.sender, address(this), amount);
        emit RewardPoolFunded(amount);
    }

    function pause() external onlyRole(MANAGER_ROLE) { _pause(); }
    function unpause() external onlyRole(MANAGER_ROLE) { _unpause(); }

    // ─── Core Functions ───────────────────────────────────────────────────────

    /// @notice Stake an ERC-721 NFT
    function stake(address nftContract, uint256 tokenId)
        external nonReentrant whenNotPaused
    {
        require(whitelisted[nftContract], "Collection not whitelisted");
        IERC721(nftContract).safeTransferFrom(msg.sender, address(this), tokenId);

        uint256 posId = nextPositionId++;
        positions[posId] = StakePosition({
            nftContract: nftContract,
            tokenId: tokenId,
            staker: msg.sender,
            startTime: block.timestamp,
            active: true
        });
        userPositions[msg.sender].push(posId);

        emit Staked(msg.sender, nftContract, tokenId, posId);
    }

    /// @notice Unstake NFT and claim all rewards
    function unstake(uint256 positionId) external nonReentrant {
        StakePosition storage pos = positions[positionId];
        require(pos.active, "Not active");
        require(pos.staker == msg.sender, "Not owner");

        uint256 rewards = pendingRewards(positionId);
        pos.active = false;

        // Return NFT
        IERC721(pos.nftContract).safeTransferFrom(address(this), msg.sender, pos.tokenId);

        // Pay rewards
        if (rewards > 0 && rewardToken.balanceOf(address(this)) >= rewards) {
            rewardToken.transfer(msg.sender, rewards);
        }

        emit Unstaked(msg.sender, positionId, rewards);
    }

    /// @notice Claim rewards without unstaking
    function claimRewards(uint256 positionId) external nonReentrant {
        StakePosition storage pos = positions[positionId];
        require(pos.active, "Not active");
        require(pos.staker == msg.sender, "Not owner");

        uint256 rewards = pendingRewards(positionId);
        require(rewards > 0, "No rewards");

        // Reset startTime to now (rewards start from 0 again)
        pos.startTime = block.timestamp;

        rewardToken.transfer(msg.sender, rewards);
        emit RewardsClaimed(msg.sender, positionId, rewards);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function pendingRewards(uint256 positionId) public view returns (uint256) {
        StakePosition storage pos = positions[positionId];
        if (!pos.active) return 0;
        uint256 elapsed = block.timestamp - pos.startTime;
        return elapsed * rewardRatePerSec[pos.nftContract];
    }

    function getUserPositions(address user) external view returns (uint256[] memory) {
        return userPositions[user];
    }

    function availableRewardPool() external view returns (uint256) {
        return rewardToken.balanceOf(address(this));
    }

    // ─── IERC721Receiver ──────────────────────────────────────────────────────

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}
