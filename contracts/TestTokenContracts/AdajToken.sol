// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract AdajToken is ERC20 {
  constructor() ERC20("Adaj", "ADAJ") {
    _mint(msg.sender, 10000000000);
  }
}
