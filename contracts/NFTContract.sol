// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

contract NFTContract is ERC1155, AccessControl, Pausable, ERC1155Supply {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Token ID configuration
    mapping(uint256 => string) public tokenTiers;
    mapping(uint256 => uint256) public tokenMaxSupply;

    // Base URI
    string private _baseMetadataURI;

    event TierConfigured(uint256 indexed tokenId, string tier, uint256 maxSupply);

    constructor(string memory uri_) ERC1155(uri_) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        
        _baseMetadataURI = uri_;
    }

    function setURI(string memory newuri) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setURI(newuri);
        _baseMetadataURI = newuri;
    }
    
    function uri(uint256) public view virtual override returns (string memory) {
        return _baseMetadataURI;
    }

    function configureTier(uint256 tokenId, string calldata tier, uint256 maxSupply) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tokenTiers[tokenId] = tier;
        tokenMaxSupply[tokenId] = maxSupply;
        emit TierConfigured(tokenId, tier, maxSupply);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function mint(address account, uint256 id, uint256 amount, bytes memory data)
        external
        onlyRole(MINTER_ROLE)
    {
        require(tokenMaxSupply[id] == 0 || totalSupply(id) + amount <= tokenMaxSupply[id], "Max supply exceeded");
        _mint(account, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        external
        onlyRole(MINTER_ROLE)
    {
        for (uint256 i = 0; i < ids.length; i++) {
            require(tokenMaxSupply[ids[i]] == 0 || totalSupply(ids[i]) + amounts[i] <= tokenMaxSupply[ids[i]], "Max supply exceeded");
        }
        _mintBatch(to, ids, amounts, data);
    }

    // --- OVERRIDES ---
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal virtual override(ERC1155, ERC1155Supply) whenNotPaused {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
