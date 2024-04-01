// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

abstract contract LoyaltySorting {
    bool public tiersSortingActive;

    constructor(bool _tiersSortingActive) {
        tiersSortingActive = _tiersSortingActive;
    }

    function areTiersAscendingNoDuplicates(
        uint256[] memory _tiersArr
    ) internal pure returns (bool) {
        for (uint256 i = 1; i < _tiersArr.length; i++) {
            if (_tiersArr[i] < _tiersArr[i - 1]) {
                return false;
            }
        }
        return allUniqueValues(_tiersArr);
    }

    function allUniqueValues(
        uint256[] memory _arr
    ) internal pure returns (bool) {
        uint256 length = _arr.length;

        for (uint256 i = 0; i < length - 1; i++) {
            for (uint256 j = 0; j < length - i - 1; j++) {
                if (_arr[j] > _arr[j + 1]) {
                    (_arr[j], _arr[j + 1] = _arr[j + 1], _arr[j]);
                }
            }
        }

        for (uint256 i = 0; i < length - 1; i++) {
            if (_arr[i] == _arr[i + 1]) {
                return false;
            }
        }
        return true;
    }
}
