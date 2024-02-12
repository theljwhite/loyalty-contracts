import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

type ERC1155ProgressReturn = {
  points: number;
  balance: { tokenId: number; amount: number }[];
  userObjsComplete: boolean[];
  currentTier: number;
};

export const getERC1155UserProgress = async (
  loyaltyContract: any,
  escrowContract: any,
  user: SignerWithAddress
): Promise<ERC1155ProgressReturn> => {
  const progress = await loyaltyContract.getUserProgression(user.address);
  const userCompletedObjectives =
    await loyaltyContract.getUserCompletedObjectives(user.address);
  const userTokenBal = await escrowContract.getUserRewards(user.address);

  const formattedTokenBal = userTokenBal.map((bal: any) => ({
    tokenId: bal.tokenId.toNumber(),
    amount: bal.amount.toNumber(),
  }));

  return {
    points: progress.rewardsEarned.toNumber(),
    userObjsComplete: userCompletedObjectives,
    balance: formattedTokenBal,
    currentTier: progress.currentTier.toNumber(),
  };
};
