// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DynamicMerkleTree.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

//TODO - experimental,
//all of the items below may not be implemented due to necessary dynamic nature of loyalty programs

abstract contract LoyaltySecurity {
    using ECDSA for bytes32;

    bytes32 public merkleRoot;
    uint256 public merkleLength;
    mapping(address => uint256) private userToMerkleIndex;

    constructor(bytes32 _merkleRoot) {
        merkleRoot = _merkleRoot;
    }

    function merkleVerifyAndUpsert(
        bytes32[] memory _proof,
        address _user
    ) internal {
        uint256 userIndex = userToMerkleIndex[_user];

        if (userIndex == 0) {
            merkleRoot = DynamicMerkleTree.append(
                merkleLength,
                merkleRoot,
                keccak256(abi.encode(_user)),
                _proof
            );

            merkleLength = merkleLength + 1;
            userToMerkleIndex[_user] = merkleLength;
        } else {
            merkleRoot = DynamicMerkleTree.update(
                userIndex - 1,
                merkleLength,
                merkleRoot,
                keccak256(abi.encode(_user)),
                keccak256(abi.encode(_user)),
                _proof
            );
        }
    }

    function isSignatureVerified(
        bytes32 _messageHash,
        bytes memory _signature,
        address _signer
    ) internal pure returns (bool) {
        bytes32 hash = ECDSA.toEthSignedMessageHash(_messageHash);
        address signer = ECDSA.recover(hash, _signature);
        return signer == _signer;
    }
}
