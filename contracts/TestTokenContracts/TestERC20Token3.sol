// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract CoffeeToken is ERC20 {
    constructor() ERC20("COFFEE", "COFE") {
        _mint(msg.sender, 110_000_000_000 * (10 ** 6));
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
