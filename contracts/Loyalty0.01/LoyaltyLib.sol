// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

library LoyaltyLib {
  enum RewardType {
    Points,
    ERC20,
    ERC721,
    ERC1155
  }

  struct Objective {
    bytes32 name;
    uint256 reward;
    bytes32 authority;
  }
}
