import hre from "hardhat";

export const moveTime = async (
  timeToAdd: number
): Promise<{
  movedTime: number;
  blockNumBefore: number;
  blockNumAfter: number;
  blockAfterTimestamp: number;
}> => {
  const blockNumBefore = await hre.ethers.provider.getBlockNumber();
  const datePlusTime = new Date().getTime() + timeToAdd;
  const movedTime = Math.round(datePlusTime / 1000);

  await hre.ethers.provider.send("evm_mine", [movedTime]);

  const blockNumAfter = await hre.ethers.provider.getBlockNumber();
  const blockAfter = await hre.ethers.provider.getBlock(blockNumAfter);

  return {
    movedTime,
    blockNumBefore: blockNumBefore,
    blockNumAfter: blockNumAfter,
    blockAfterTimestamp: blockAfter.timestamp,
  };
};
