// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ILoyaltyERC1155Escrow {
    function handleRewardsUnlock(
        address _user,
        uint256 _objIndex,
        uint256 _tierIndex,
        uint256[] memory _passedTiers
    ) external;
}
