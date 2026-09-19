// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface INFTContract {
    function mint(address account, uint256 id, uint256 amount, bytes memory data) external;
}

contract PublicMinter {
    INFTContract public immutable nftContract;

    event Minted(address indexed account, uint256 indexed id, uint256 amount);

    constructor(address _nftContract) {
        require(_nftContract != address(0), "Invalid address");
        nftContract = INFTContract(_nftContract);
    }

    /**
     * @dev Public function to mint a tier.
     * @param id The token ID (1, 2, 3, or 4 for Bronze, Silver, Gold, Platinum).
     */
    function mint(uint256 id) external {
        require(id >= 1 && id <= 4, "Invalid Tier ID");
        // We mint 1 token per call to the sender
        nftContract.mint(msg.sender, id, 1, "");
        emit Minted(msg.sender, id, 1);
    }
}
