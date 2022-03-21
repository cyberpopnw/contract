// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./ERC721.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract CyberClub is ERC721, Pausable, Ownable {
    constructor() ERC721("Cyber Club", "CBC") {
        totalSupply = 1;
    }

    function _baseURI() internal pure override returns (string memory) {
        return "https://api.cyberpop.online/head/";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function safeMint(address to) public onlyOwner {
        uint256 tokenId = totalSupply - 1;
        _safeMint(to, tokenId);
        unchecked {
            tokenId++;
        }
        totalSupply = tokenId;
    }

    function batchMint(address to, uint256 numTokens) external onlyOwner {
        _batchMint(to, numTokens);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override(ERC721) whenNotPaused {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    // The following functions are overrides required by Solidity.

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
