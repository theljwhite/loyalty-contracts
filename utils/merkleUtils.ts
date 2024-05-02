import hre from "hardhat";

/**
 * These utils are inspired by:
 * Link: https://github.com/QuarkChain/DynamicMerkleTree/blob/main/contracts/DynamicMerkleTree.sol
 * Author: https://github.com/qizhou
 * I converted it to work with ethers and addresses
 */

const { soliditySha256 } = hre.ethers.utils;
const { HashZero } = hre.ethers.constants;

export const calculateRootHash = (addresses: string[]): string => {
  let nodes = addresses.map((a) => soliditySha256(["address"], [a]));

  if (nodes.length === 0) return HashZero;

  while (nodes.length > 1) {
    let newNodes = [];
    for (let i = 0; i < nodes.length; i += 2) {
      newNodes.push(
        soliditySha256(
          ["bytes32", "bytes32"],
          [nodes[i], i + 1 < nodes.length ? nodes[i + 1] : HashZero]
        )
      );
    }

    nodes = newNodes;
  }

  return nodes[0];
};

export const getUpdateProof = (
  addresses: string[],
  index: number
): string[] => {
  let nodes = addresses.map((a) => soliditySha256(["address"], [a]));

  if (index === nodes.length) nodes.push(HashZero);

  let proof = [];

  while (nodes.length > 1 || index !== 0) {
    let newIndex = Math.floor(index / 2) * 2;

    if (newIndex === index) newIndex += 1;
    if (newIndex < nodes.length) proof.push(nodes[newIndex]);

    let newNodes = [];

    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = i + 1 < nodes.length ? nodes[i + 1] : HashZero;
      newNodes.push(soliditySha256(["bytes32", "bytes32"], [left, right]));
    }

    nodes = newNodes;
    index = Math.floor(index / 2);
  }
  return proof;
};

export const getAppendProof = (addresses: string[]): string[] =>
  getUpdateProof(addresses, addresses.length);
