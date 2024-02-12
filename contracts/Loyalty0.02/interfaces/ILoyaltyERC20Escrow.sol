// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILoyaltyERC20Escrow {
    function handleRewardsUnlock(address _user, uint256 _rewardGoal) external;

    function handleTierRewardsUnlock(
        address _user,
        uint256 _tierIndex,
        uint256[] memory _passedTiers
    ) external;
}
