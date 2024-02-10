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
import { ONE_MONTH_SECONDS, TWO_DAYS_MS } from "../constants/timeAndDate";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

//these functions will deploy a basic loyalty program contract.
//and also an optional escrow contract.
//just some utility so that for further testing in contract versions to come,
//I wont have to go through the deploy logic anymore except for initial deploy testing for any new version.
//can just deploy programs right away when non-deploy related tests are needed (like for users completing objectives in case I change the logic)

//TODO - fix types with the Contract instances if get around to it.

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

export const deployProgramAndSetUpUntilDepositPeriod = async (
  contractVersion: string,
  rewardType: RewardType,
  withTiers: boolean,
  creator: SignerWithAddress,
  rewardsAddress?: string
): Promise<DeployLoyaltyReturn> => {
  const { loyaltyAddress, escrowAddress } = await deployLoyaltyProgram(
    contractVersion,
    rewardType,
    withTiers,
    creator,
    rewardsAddress
  );

  const loyaltyProgramContractRoute =
    allContractRoutes[
      `VERSION_${contractVersion}_LOYALTY_PROGRAM` as keyof typeof allContractRoutes
    ];
  const loyaltyProgram = await hre.ethers.getContractAt(
    loyaltyProgramContractRoute,
    loyaltyAddress
  );

  if (escrowAddress) {
    const rewardTypeEnumAsString = RewardType[rewardType];
    const escrowFactoryRoute =
      allContractRoutes[
        `VERSION_${contractVersion}_${rewardTypeEnumAsString}_ESCROW` as keyof typeof allContractRoutes
      ];
    const escrow = await hre.ethers.getContractAt(
      escrowFactoryRoute,
      escrowAddress
    );

    const sampleDepositKey = "clscttni60000356tqrpthp7b";
    const depositKeyBytes32 =
      hre.ethers.utils.formatBytes32String(sampleDepositKey);
    const datePlusTwoDays = new Date().getTime() + TWO_DAYS_MS;
    const depositEndDate = Math.round(datePlusTwoDays / 1000);

    await escrow
      .connect(creator)
      .setDepositKey(depositKeyBytes32, depositEndDate);

    return { loyaltyAddress, escrowAddress };
  } else {
    await loyaltyProgram.setLoyaltyProgramActive();
    return { loyaltyAddress };
  }
};

export const handleTestERC721DeployMintAndTransfer = async (
  mintAmount: number,
  creator: SignerWithAddress
): Promise<{ balance: any; testERC721Contract: any }> => {
  const testERC20TokenToPayForMint =
    await hre.ethers.deployContract("AdajToken");
  const testERC721Collection = await hre.ethers.deployContract(
    "TestERC721Contract",
    ["TestCollection", "TEST", testERC20TokenToPayForMint.address]
  );

  await testERC20TokenToPayForMint.transfer(creator.address, 1_000_000);
  await testERC20TokenToPayForMint
    .connect(creator)
    .approve(testERC721Collection.address, 5000);
  await testERC20TokenToPayForMint
    .connect(creator)
    .increaseAllowance(testERC721Collection.address, 5000);

  await testERC721Collection.setSaleState(true);
  await testERC721Collection.setMaxToMint(1000);
  await testERC721Collection.connect(creator).mintNoodles(mintAmount);

  const creatorBalance = await testERC721Collection.balanceOf(creator.address);

  return { balance: creatorBalance, testERC721Contract: testERC721Collection };
};

export const handleTestERC1155TokenTransfer = async (
  testERC1155Contract: any,
  creator: SignerWithAddress,
  deployer: SignerWithAddress,
  tokenAmounts: number[]
): Promise<any> => {
  const testERC1155TokenIds = [0, 1, 2, 3, 4];

  await testERC1155Contract.setApprovalForAll(creator.address, true);
  await testERC1155Contract
    .connect(creator)
    .safeBatchTransferFrom(
      deployer.address,
      creator.address,
      testERC1155TokenIds,
      tokenAmounts,
      hre.ethers.utils.formatBytes32String("hi")
    );

  const balanceOfCreator = await testERC1155Contract.balanceOfBatch(
    Array(testERC1155TokenIds.length).fill(creator.address),
    testERC1155TokenIds
  );
  return balanceOfCreator;
};
