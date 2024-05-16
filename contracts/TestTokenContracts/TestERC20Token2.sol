// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestTokenTwo is ERC20 {
    constructor() ERC20("Adaj", "ADAJ") {
        _mint(msg.sender, 120_000_000 * (10 ** 18));
    }
}
