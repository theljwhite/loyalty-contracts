import { ERC721RewardOrder } from "../constants/contractEnums";

export const simulateOffChainSortTokens = (
  tokenIdsArr: number[],
  rewardOrder: ERC721RewardOrder
) => {
  if (rewardOrder == ERC721RewardOrder.Ascending) {
    const sortedMaxToMin = tokenIdsArr.sort((a, b) => b - a);

    return sortedMaxToMin;
  } else if (rewardOrder == ERC721RewardOrder.Descending) {
    const sortedMinToMax = tokenIdsArr.sort((a, b) => a - b);
    return sortedMinToMax;
  } else {
    for (let i = tokenIdsArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tokenIdsArr[i], tokenIdsArr[j]] = [tokenIdsArr[j], tokenIdsArr[i]];
    }
    return tokenIdsArr;
  }
};
