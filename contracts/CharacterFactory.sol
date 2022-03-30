// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "./interfaces/IERC1155Factory.sol";
import "./Cyborg.sol";
import "./utils/RNG.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract CharacterFactory is AccessControl, IERC1155Factory, RNG {
    using Counters for Counters.Counter;

    // address private spender;
    Counters.Counter private _tokenIdCounter;
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    address private cyberChar;

    uint256[] private charTypes = [70201, 70101];

    constructor(address _nftAddress) {
        cyberChar = _nftAddress;
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(MINTER_ROLE, _msgSender());
    }

    function setCharTypes(uint256[] memory newTypes)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        charTypes = newTypes;
    }

    function mint(
        uint256 _level,
        address _to,
        uint256 _amount,
        bytes memory
    ) public override onlyRole(MINTER_ROLE) {
        require(_amount == 1, "cannot mint more than 1");
        uint256 id = _tokenIdCounter.current();
        uint256 rng = (_random() % charTypes.length) * 100000;
        Cyborg(cyberChar).safeMint(_to, _level + charTypes[rng] + id);
        _tokenIdCounter.increment();
    }
}