// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILoyaltyERC721Escrow {
  function handleRewardsUnlock(address _user, uint256 _rewardGoal) external;
}
