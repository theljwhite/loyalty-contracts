import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VERSION_0_02_ERC1155_ESCROW,
  VERSION_0_02_LOYALTY_FACTORY,
  VERSION_0_02_LOYALTY_PROGRAM,
} from "../../constants/contractRoutes";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
  ERC1155RewardCondition,
} from "../../constants/contractEnums";
import {
  ONE_MONTH_SECONDS,
  THREE_DAYS_MS,
  TWO_DAYS_MS,
} from "../../constants/timeAndDate";
import {
  programName,
  targetObjectivesBytes32,
  authoritiesBytes32,
  rewards,
  tierNamesBytes32,
  tierRewardsRequired,
} from "../../constants/basicLoyaltyConstructorArgs";
import { moveTime } from "../../utils/moveTime";

let currentTimeInSeconds: number = 0;
let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

let depositorOne: SignerWithAddress;
let depositorTwo: SignerWithAddress;

let loyaltyProgramOne: any;
let loyaltyProgramOneAddress: string = "";
let loyaltyProgramOneEndsAt: number = 0;

let erc1155EscrowOne: any;
let erc1155EscrowOneAddress: string = "";

let testCollectionDeployer: SignerWithAddress;
let testCollection: any;

describe("LoyaltyProgram", () => {
  before(async () => {
    currentTimeInSeconds = await time.latest();
    accounts = await hre.ethers.getSigners();
    testCollectionDeployer = accounts[0];
    creatorOne = accounts[1];
    depositorOne = accounts[3];
    depositorTwo = accounts[4];

    //deploy test ERC1155 collection to be used as rewards for ERC1155 escrow.
    testCollection = await hre.ethers.deployContract("TestERC1155Collection");

    //transfer tokens to creatorOne to be used for rewards depositing.
    //send 100 of each token ID (token IDs 0 through 4);
    let tokenIds = [0, 1, 2, 3, 4];
    let tokenAmounts = [100, 100, 100, 100, 100];

    await testCollection.setApprovalForAll(creatorOne.address, true);
    await testCollection
      .connect(creatorOne)
      .safeBatchTransferFrom(
        testCollectionDeployer.address,
        creatorOne.address,
        tokenIds,
        tokenAmounts,
        hre.ethers.utils.formatBytes32String("hi")
      );

    const balanceOfCreatorOne = await testCollection.balanceOfBatch(
      Array(tokenIds.length).fill(creatorOne.address),
      tokenIds
    );
    const formattedBalance = balanceOfCreatorOne.map((bal: any) =>
      bal.toNumber()
    );
    expect(formattedBalance).deep.equal(tokenAmounts);
  });
  it("ensures that a loyalty program contract with ERC1155 rewards can still be deployed with tier handling moved directly to its constructor", async () => {
    //in first contract version, tiers required an additional external call to be added.
    //this will ensure that with tier info added directly to contract constructor,
    //that the tiers are added directly with contract deploy.

    const loyaltyContractFactory = await hre.ethers.getContractFactory(
      VERSION_0_02_LOYALTY_FACTORY
    );

    const threeMonthsFromNow = ONE_MONTH_SECONDS * 3;
    const programEndsAtDate = threeMonthsFromNow + currentTimeInSeconds;
    const tierSortingActive = true;

    //deploy loyalty program as creator one address
    const newLoyaltyProgram = await loyaltyContractFactory
      .connect(creatorOne)
      .deploy(
        programName,
        targetObjectivesBytes32,
        authoritiesBytes32,
        rewards,
        RewardType.ERC1155,
        programEndsAtDate,
        tierSortingActive,
        tierNamesBytes32,
        tierRewardsRequired
      );
    loyaltyProgramOne = await hre.ethers.getContractAt(
      VERSION_0_02_LOYALTY_PROGRAM,
      newLoyaltyProgram.address
    );
    loyaltyProgramOneAddress = newLoyaltyProgram.address;
    loyaltyProgramOneEndsAt = programEndsAtDate;

    //verify loyalty program settings
    const [
      tiersAreActive,
      tierCount,
      totalPointsPossible,
      rewardType,
      objectives,
    ] = await loyaltyProgramOne.getLoyaltyProgramSettings();

    expect(tiersAreActive).equal(true, "Incorrect");
    expect(tierCount.toNumber()).equal(5, "Incorrect"); //default tier is added since first tier rewards required was above 0
    expect(totalPointsPossible.toNumber()).equal(
      7800,
      "Incorrect total points"
    );
    expect(rewardType).equal(RewardType.ERC1155, "Incorrect reward type");
    expect(objectives.length).equal(5, "Incorrect length");
  });
  it("ensures that an ERC1155 escrow contract can still be deployed and set in corresponding loyalty program contract, since constructor args have changed", async () => {
    const erc1155EscrowFactory = await hre.ethers.getContractFactory(
      VERSION_0_02_ERC1155_ESCROW
    );
    const rewardTokenAddress = testCollection.address;
    const approvedDepositors: string[] = [
      creatorOne.address,
      depositorOne.address,
      depositorTwo.address,
    ];

    const erc1155EscrowContract = await erc1155EscrowFactory
      .connect(creatorOne)
      .deploy(
        loyaltyProgramOneAddress,
        creatorOne.address,
        loyaltyProgramOneEndsAt,
        rewardTokenAddress,
        approvedDepositors
      );
    erc1155EscrowOne = await hre.ethers.getContractAt(
      VERSION_0_02_ERC1155_ESCROW,
      erc1155EscrowContract.address
    );
    erc1155EscrowOneAddress = erc1155EscrowContract.address;

    //ensure that after deployment, initial state should be Idle;
    const initialState = await erc1155EscrowOne.escrowState();
    expect(initialState).equal(EscrowState.Idle, "Incorrect initial state");

    //ensure senders (depositors) are approved, reward collection is approved, etc.
    //since that is now handled in the constructor at deploy time in this contract version
    const isCreatorSenderApproved = await erc1155EscrowOne.isSenderApproved(
      creatorOne.address
    );
    const isDepositorOneApproved = await erc1155EscrowOne.isSenderApproved(
      depositorOne.address
    );
    const isDepositorTwoApproved = await erc1155EscrowOne.isSenderApproved(
      depositorTwo.address
    );
    const isCollectionApproved = await erc1155EscrowOne.isCollectionApproved(
      testCollection.address
    );

    expect(isCreatorSenderApproved).equal(
      true,
      "Incorrect - creator should be approved"
    );
    expect(isDepositorOneApproved).equal(
      true,
      "Incorrect - deposit should be approved"
    );
    expect(isDepositorTwoApproved).equal(
      true,
      "Incorrect - depositor should be approved"
    );
    expect(isCollectionApproved).equal(
      true,
      "Incorrect - collection should be approved"
    );

    //ensure state vars are set from constructor
    const loyaltyProgramStateInEscrow =
      await erc1155EscrowOne.getLoyaltyProgram();
    const creatorState = await erc1155EscrowOne.creator.call();

    expect(loyaltyProgramStateInEscrow).equal(
      loyaltyProgramOneAddress,
      "Incorrect address"
    );

    expect(creatorState).equal(creatorOne.address, "Incorrect creator state");
  });
  it("ensures that escrow state during deposit flow still works correctly after some steps were moved to constructor", async () => {
    //ensure deposit key can be set and that escrow state updates accordingly.
    //deposit period starts when deposit key is set, so escrow state should update
    const sampleDepositKey = "clscttni60000356tqrpthp7b";
    const depositKeyBytes32 =
      hre.ethers.utils.formatBytes32String(sampleDepositKey);
    const datePlusTwoDays = new Date().getTime() + TWO_DAYS_MS;
    const depositEndDate = Math.round(datePlusTwoDays / 1000);
    await erc1155EscrowOne
      .connect(creatorOne)
      .setDepositKey(depositKeyBytes32, depositEndDate);

    const stateAfterDepositKeySet = await erc1155EscrowOne.escrowState();
    expect(stateAfterDepositKeySet).equal(EscrowState.DepositPeriod);

    //now that deposit period is active, deposit tokens to be used for escrow rewards.
    //for this test, deposit different amounts of each token id.
    const tokenIdsToDeposit = [0, 1, 2, 3, 4];
    const amountsToDeposit = [20, 30, 40, 50, 60];

    await testCollection
      .connect(creatorOne)
      [
        "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)"
      ](creatorOne.address, erc1155EscrowOneAddress, tokenIdsToDeposit, amountsToDeposit, depositKeyBytes32);

    //ensure that state variables/balances are updated...
    //...after deposit received by onERC1155BatchReceived function
    const {
      totalTokenIds,
      collectionAddress,
      tokens: tokensArr,
    } = await erc1155EscrowOne.getEscrowTokenDetails();

    const correctTokensArrShape = tokenIdsToDeposit.map(
      (tkn: number, index: number) => ({
        id: tkn,
        value: amountsToDeposit[index],
      })
    );
    const formattedTokensArrReturn = tokensArr.map((tkn: any) => ({
      id: tkn.id.toNumber(),
      value: tkn.value.toNumber(),
    }));

    expect(totalTokenIds.toNumber()).equal(
      tokenIdsToDeposit.length,
      "Incorrect token ids length"
    );
    expect(collectionAddress).equal(testCollection.address, "Incorrect");
    expect(formattedTokensArrReturn).deep.equal(correctTokensArrShape);

    //ensure that tokenBalances mapping is correct
    const tokenBalances: number[] = [];
    for (let i = 0; i < tokenIdsToDeposit.length; i++) {
      const balance = await erc1155EscrowOne.getEscrowTokenBalance(i);
      tokenBalances.push(balance.toNumber());
    }
    expect(tokenBalances).deep.equal(amountsToDeposit);

    //now that tokens are deposited, move time forward 3+ days so deposit period is over.
    //since deposit period is over, escrow's state should be AwaitingEscrowSettings
    const { movedTime, blockNumBefore, blockNumAfter, blockAfterTimestamp } =
      await moveTime(THREE_DAYS_MS);

    expect(blockNumAfter).to.be.greaterThan(blockNumBefore);
    expect(blockAfterTimestamp).to.be.equal(movedTime);

    const stateAfterDepositEnd = await erc1155EscrowOne.escrowState();
    expect(stateAfterDepositEnd).equal(EscrowState.AwaitingEscrowSettings);

    //set escrow settings.
    //this will customize the loyalty program's escrow settings.
    //state should move to Idle after escrow settings are set.
    //once loyalty program is set to active, escrow's state should change to InIssuance.
    //for this test, use EachObjective reward condition.
    //completing objective index 0 will reward 2 token ID 0's for example.

    const tokenIdsToRewardForObjCompletion = [0, 4, 2, 3, 1]; //corresponding to objectives indexes
    const tokenAmountsForEachPayout = [2, 1, 1, 1, 2]; // two token Id 0's, one token Id 4, etc.

    await erc1155EscrowOne
      .connect(creatorOne)
      .setEscrowSettingsAdvanced(
        ERC1155RewardCondition.EachObjective,
        tokenIdsToRewardForObjCompletion,
        tokenAmountsForEachPayout
      );

    //ensure that initially after escrow settings are set,
    //that escrow state moves to Idle until loyalty program is set to active
    const stateAfterSettingsSet = await erc1155EscrowOne.escrowState();
    expect(stateAfterSettingsSet).equal(EscrowState.Idle, "Incorrect state");

    //set loyalty program to active and ensure loyalty state and escrow state change
    //escrow state should now be InIssuance.
    await loyaltyProgramOne.connect(creatorOne).setLoyaltyProgramActive();
    const loyaltyStateAfterActive = await loyaltyProgramOne.state();
    const escrowStateAfterActive = await erc1155EscrowOne.escrowState();

    expect(loyaltyStateAfterActive).equal(LoyaltyState.Active);
    expect(escrowStateAfterActive).equal(EscrowState.InIssuance);

    //ensure escrow reward details were updated.
    //reward goal isnt needed for EachObjective rewardCondition, so it should be 0
    const { rewardGoal, rewardCondition } =
      await erc1155EscrowOne.getEscrowRewardDetails();
    expect(rewardGoal.toNumber()).equal(0, "Incorrect");
    expect(rewardCondition).equal(ERC1155RewardCondition.EachObjective);

    //ensure that payoutIndexToPayouts mapping was updated,
    //since EachObjective rewardCondition was chosen.
    const payouts: { tokenId: number; payoutAmount: number }[] = [];
    const correctPayoutsShape = tokenIdsToRewardForObjCompletion.map(
      (tkn: number, index: number) => ({
        tokenId: tkn,
        payoutAmount: tokenAmountsForEachPayout[index],
      })
    );

    for (let i = 0; i < tokenIdsToRewardForObjCompletion.length; i++) {
      const tokenId = i;
      const payout = await erc1155EscrowOne.getPayoutInfo(tokenId);
      payouts.push({
        tokenId: payout.tokenId.toNumber(),
        payoutAmount: payout.payoutAmount.toNumber(),
      });
    }

    expect(payouts).deep.equal(correctPayoutsShape, "Incorrect payouts");
  });
});
