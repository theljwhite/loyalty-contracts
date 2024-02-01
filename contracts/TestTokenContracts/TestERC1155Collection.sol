// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract TestERC1155Collection is ERC1155 {
  uint256 public constant BRONZE = 0;
  uint256 public constant SILVER = 1;
  uint256 public constant GOLD = 2;
  uint256 public constant PLATINUM = 3;
  uint256 public constant DIAMOND = 4;

  constructor() ERC1155("TestURI") {
    _mint(msg.sender, BRONZE, 10**18, "");
    _mint(msg.sender, SILVER, 10**27, "");
    _mint(msg.sender, GOLD, 10**9, "");
    _mint(msg.sender, PLATINUM, 10**9, "");
    _mint(msg.sender, DIAMOND, 10000, "");
  }
}
