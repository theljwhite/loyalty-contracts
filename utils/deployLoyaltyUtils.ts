import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import * as allContractRoutes from "../constants/contractRoutes";
import {
  EscrowState,
  LoyaltyState,
  RewardType,
} from "../constants/contractEnums";
import {
  programName,
  targetObjectivesBytes32,
  authoritiesBytes32,
  rewards,
  tierNamesBytes32,
  tierRewardsRequired,
  depositKeyBytes32,
} from "../constants/basicLoyaltyConstructorArgs";
import { ONE_MONTH_SECONDS, TWO_DAYS_MS } from "../constants/timeAndDate";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

//these functions will deploy a basic loyalty program contract.
//and also an optional escrow contract.
//just some utility so that for further testing in contract versions to come,
//I wont have to go through the deploy logic anymore except for initial deploy testing for any new version.
//can just deploy programs right away when non-deploy related tests are needed (like for users completing objectives in case I change the logic)

//TODO - fix types with the Contract instances if get around to it.

type DeployLoyaltyReturn = {
  loyaltyAddress: string;
  escrowAddress?: string;
  loyaltyContract: any;
  escrowContract?: any;
};

type ContractsStatesReturn = {
  loyaltyStates: LoyaltyState[];
  escrowStates: EscrowState[];
};

export type CreatorContracts = {
  loyaltyAddress: string;
  escrowAddress: string;
  loyalty: any;
  escrow: any;
};

export const deployLoyaltyProgram = async (
  contractVersion: string,
  rewardType: RewardType,
  withTiers: boolean,
  creator: SignerWithAddress,
  rewardsAddress?: string,
  merkleRoot?: string
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
      withTiers ? tierRewardsRequired : [],
      merkleRoot
    );

  if (rewardType === RewardType.Points) {
    return {
      loyaltyAddress: newLoyaltyProgram.address,
      loyaltyContract: newLoyaltyProgram,
    };
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

    await newLoyaltyProgram
      .connect(creator)
      .setEscrowContract(escrowContract.address, rewardType);

    return {
      loyaltyAddress: newLoyaltyProgram.address,
      escrowAddress: escrowContract.address,
      loyaltyContract: newLoyaltyProgram,
      escrowContract,
    };
  }
};

export const deployProgramAndSetUpUntilDepositPeriod = async (
  contractVersion: string,
  rewardType: RewardType,
  withTiers: boolean,
  creator: SignerWithAddress,
  rewardsAddress?: string,
  merkleRoot?: string
): Promise<DeployLoyaltyReturn> => {
  const { loyaltyAddress, escrowAddress } = await deployLoyaltyProgram(
    contractVersion,
    rewardType,
    withTiers,
    creator,
    rewardsAddress,
    merkleRoot
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

    await loyaltyProgram
      .connect(creator)
      .setEscrowContract(escrowAddress, rewardType);

    const datePlusTwoDays = new Date().getTime() + TWO_DAYS_MS;
    const depositEndDate = Math.round(datePlusTwoDays / 1000);

    await escrow
      .connect(creator)
      .setDepositKey(depositKeyBytes32, depositEndDate);

    return {
      loyaltyAddress,
      escrowAddress,
      loyaltyContract: loyaltyProgram,
      escrowContract: escrow,
    };
  } else {
    await loyaltyProgram.setLoyaltyProgramActive();
    return { loyaltyAddress, loyaltyContract: loyaltyProgram };
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

export const handleTransferTestERC721ToEscrow = async (
  tokenIdStart: number,
  tokenIdEnd: number,
  testCollectionContract: any,
  escrowAddress: string,
  creator: SignerWithAddress
): Promise<void> => {
  for (let i = tokenIdStart; i < tokenIdEnd; i++) {
    await testCollectionContract
      .connect(creator)
      [
        "safeTransferFrom(address,address,uint256,bytes)"
      ](creator.address, escrowAddress, i, depositKeyBytes32);
  }
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

export const handleTestERC1155TransferToEscrow = async (
  tokenIds: number[],
  tokenAmounts: number[],
  testCollectionContract: any,
  escrowAddress: string,
  creator: SignerWithAddress
): Promise<void> => {
  await testCollectionContract
    .connect(creator)
    [
      "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)"
    ](creator.address, escrowAddress, tokenIds, tokenAmounts, depositKeyBytes32);
};

export const transferERC721 = async (
  tokenIdStart: number,
  tokenIdEnd: number,
  from: SignerWithAddress,
  to: SignerWithAddress,
  collection: any
): Promise<{ receiverBalance: any; senderBalance: any }> => {
  for (let i = tokenIdStart; i < tokenIdEnd; i++) {
    await collection
      .connect(from)
      [
        "safeTransferFrom(address,address,uint256)"
      ](from.address, to.address, i);
  }

  const balanceOfSender = await collection.balanceOf(from.address);
  const balanceOfReceiver = await collection.balanceOf(to.address);

  return { receiverBalance: balanceOfReceiver, senderBalance: balanceOfSender };
};

export const checkContractsState = async (
  contracts: CreatorContracts[]
): Promise<ContractsStatesReturn> => {
  const loyaltyStates: LoyaltyState[] = [];
  const escrowStates: EscrowState[] = [];
  for (let i = 0; i < contracts.length; i++) {
    const loyaltyState = await contracts[i].loyalty.state();
    const escrowState = await contracts[i].escrow.escrowState();
    loyaltyStates.push(loyaltyState);
    escrowStates.push(escrowState);
  }
  return { escrowStates, loyaltyStates };
};

export const estimateGasDeploy = async (
  contractVersion: string,
  rewardType: RewardType,
  withTiers: boolean,
  creator: SignerWithAddress,
  loyaltyAddress: string,
  rewardsAddress?: string,
  merkleRoot?: string
): Promise<{
  loyaltyGasEth: any;
  escrowGasEth: any;
} | null> => {
  const loyaltyFactoryRoute =
    allContractRoutes[
      `VERSION_${contractVersion}_LOYALTY_FACTORY` as keyof typeof allContractRoutes
    ];

  const rewardTypeEnumAsString = RewardType[rewardType];
  const loyaltyContractFactory =
    await hre.ethers.getContractFactory(loyaltyFactoryRoute);

  const threeMonthsFromNow = ONE_MONTH_SECONDS * 3;
  const programEndsAtDate = threeMonthsFromNow + (await time.latest());

  const constructorArgs = [
    programName,
    targetObjectivesBytes32,
    authoritiesBytes32,
    rewards,
    rewardType,
    programEndsAtDate,
    withTiers ? true : false,
    withTiers ? tierNamesBytes32 : [],
    withTiers ? tierRewardsRequired : [],
    merkleRoot,
  ];

  const lpDeployTx = loyaltyContractFactory.getDeployTransaction(
    ...constructorArgs
  );

  let escrowCostEth = null;

  if (rewardType !== RewardType.Points) {
    const escrowConstructorArgs = [
      loyaltyAddress,
      creator.address,
      programEndsAtDate,
      rewardsAddress,
      [creator.address],
    ];
    const escrowFactoryRoute =
      allContractRoutes[
        `VERSION_${contractVersion}_${rewardTypeEnumAsString}_ESCROW` as keyof typeof allContractRoutes
      ];
    const escrowFactory =
      await hre.ethers.getContractFactory(escrowFactoryRoute);

    const escrowDeployTx = escrowFactory.getDeployTransaction(
      ...escrowConstructorArgs
    );
    const escrowPrice = await escrowFactory.signer.estimateGas(escrowDeployTx);
    const gasPriceEscrow = await escrowFactory.signer.getGasPrice();
    const escrowDeployPriceWei = gasPriceEscrow.mul(escrowPrice);
    escrowCostEth = hre.ethers.utils.formatUnits(escrowDeployPriceWei, "ether");
  }

  const lpPrice = await loyaltyContractFactory.signer.estimateGas(lpDeployTx);
  const gasPriceLp = await loyaltyContractFactory.signer.getGasPrice();
  const lpDeployPriceWei = gasPriceLp.mul(lpPrice);
  const lpCostEth = hre.ethers.utils.formatUnits(lpDeployPriceWei, "ether");

  // const polygonRate = await getActualTokenToUSDRate("Polygon")
  // const ethRate = await getActualTokenToUSDRate("Ethereum");
  // const actualCostLp = (parseFloat(lpCostEth) * ethRate).toFixed(2);
  // const actualCostEscrow = (parseFloat(escrowCostEth) * ethRate).toFixed(2);

  return { loyaltyGasEth: lpCostEth, escrowGasEth: escrowCostEth };
};

const getActualTokenToUSDRate = async (tokenName: string): Promise<number> => {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/coins/${tokenName}`
  );
  if (response.ok) {
    const data = await response.json();
    const rate = data.market_data.current_price.usd;
    return parseInt(rate);
  }
  return 0;
};

export const createMerkleTree = (
  addresses: string[]
): { root: string; tree: MerkleTree } => {
  const hashedAddressArr = addresses.map((a) => keccak256(a));
  const merkleTree = new MerkleTree(hashedAddressArr, keccak256, {
    sort: true,
  });
  const merkleRoot = merkleTree.getRoot().toString("hex");

  return { root: "0x" + merkleRoot, tree: merkleTree };
};
