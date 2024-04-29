// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

//TODO - experimental,
//all of the items below may not be implemented due to necessary dynamic nature of loyalty programs

abstract contract LoyaltySecurity {
    using ECDSA for bytes32;

    bytes32 public progressMerkleRoot;

    constructor(bytes32 _progressMerkleRoot) {
        progressMerkleRoot = _progressMerkleRoot;
    }

    function checkMerkleProof(
        bytes32[] calldata _merkleProof,
        address _addressToCheck
    ) public view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(_addressToCheck));
        require(
            MerkleProof.verify(_merkleProof, progressMerkleRoot, leaf),
            "Not in merkle"
        );
        return true;
    }

    function updateProgressMerkleRoot(bytes32 _newMerkleRoot) external {
        progressMerkleRoot = _newMerkleRoot;
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
