import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import * as allContractRoutes from "../constants/contractRoutes";
import { RewardType } from "../constants/contractEnums";
import {
  programName,
  targetObjectivesBytes32,
  authoritiesBytes32,
  rewards,
  tierNamesBytes32,
  tierRewardsRequired,
} from "../constants/basicLoyaltyConstructorArgs";
import { ONE_MONTH_SECONDS } from "../constants/timeAndDate";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

//these functions will deploy a basic loyalty program contract.
//and also an optional escrow contract.
//just some utility so that for further testing in contract versions to come,
//I wont have to go through the deploy logic anymore except for initial deploy testing for any new version.
//can just deploy programs right away when non-deploy related tests are needed (like for users completing objectives in case I change the logic)

type DeployLoyaltyReturn = {
  loyaltyAddress: string;
  escrowAddress?: string;
};

export const deployLoyaltyProgram = async (
  contractVersion: string,
  rewardType: RewardType,
  withTiers: boolean,
  creator: SignerWithAddress,
  rewardsAddress?: string
): Promise<DeployLoyaltyReturn> => {
  const loyaltyFactoryRoute =
    allContractRoutes[
      `VERSION_${contractVersion}_LOYALTY_FACTORY` as keyof typeof allContractRoutes
    ];

  const loyaltyContractFactory =
    await hre.ethers.getContractFactory(loyaltyFactoryRoute);

  const threeMonthsFromNow = ONE_MONTH_SECONDS * 3;
  const programEndsAtDate = threeMonthsFromNow + (await time.latest());
  const tierSortingActive = true;

  const newLoyaltyProgram = await loyaltyContractFactory
    .connect(creator)
    .deploy(
      programName,
      targetObjectivesBytes32,
      authoritiesBytes32,
      rewards,
      rewardType,
      programEndsAtDate,
      withTiers ? tierSortingActive : false,
      withTiers ? tierNamesBytes32 : [],
      withTiers ? tierRewardsRequired : []
    );

  if (rewardType === RewardType.Points) {
    return { loyaltyAddress: newLoyaltyProgram.address };
  } else {
    const rewardTypeEnumAsString = RewardType[rewardType];
    const escrowFactoryRoute =
      allContractRoutes[
        `VERSION_${contractVersion}_${rewardTypeEnumAsString}_ESCROW` as keyof typeof allContractRoutes
      ];

    const escrowFactory =
      await hre.ethers.getContractFactory(escrowFactoryRoute);

    const escrowContract = await escrowFactory
      .connect(creator)
      .deploy(
        newLoyaltyProgram.address,
        creator.address,
        programEndsAtDate,
        rewardsAddress,
        [creator.address]
      );

    return {
      loyaltyAddress: newLoyaltyProgram.address,
      escrowAddress: escrowContract.address,
    };
  }
};
