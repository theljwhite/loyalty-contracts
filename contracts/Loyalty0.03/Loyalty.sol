// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./LoyaltyProgram.sol";
import "./extensions/LoyaltyEscrowRegistry.sol";
import "./utils/LoyaltySorting.sol";


contract Loyalty is LoyaltyEscrowRegistry {
    constructor(
        string memory _name,
        bytes32[] memory _targetObjectives,
        bytes32[] memory _authorities,
        uint256[] memory _rewards,
        RewardType _rewardType,
        uint256 _programEndsAt,
        bool _tiersSortingActive,
        bytes32[] memory _tierNames,
        uint256[] memory _tierRewardsRequired,
    )
        LoyaltyProgram(
            _name,
            _targetObjectives,
            _authorities,
            _rewards,
            _rewardType,
            _programEndsAt,
            _tiersSortingActive,
            _tierNames,
            _tierRewardsRequired
        )
        LoyaltySorting(_tiersSortingActive)
    {}
}