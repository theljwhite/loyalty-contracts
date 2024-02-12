import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
  ERC1155RewardCondition,
} from "../../constants/contractEnums";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  handleTestERC1155TokenTransfer,
} from "../../utils/deployLoyaltyUtils";
import { simulateOffChainSortTokens } from "../../utils/sortTokens";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";

type CreatorContracts = {
  loyaltyAddress: string;
  escrowAddress: string;
  loyalty: any;
  escrow: any;
};

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;
let creatorThree: SignerWithAddress;
let creatorFour: SignerWithAddress;
let creatorFive: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

const contracts: CreatorContracts[] = [];
let loyaltyCreators: SignerWithAddress[] = [];

let testCollection: any;
let testCollectionDeployer: SignerWithAddress;

describe("LoyaltyProgram", () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    testCollectionDeployer = accounts[0];

    creatorOne = accounts[1];
    creatorTwo = accounts[2];
    creatorThree = accounts[3];
    creatorFour = accounts[4];
    creatorFive = accounts[5];

    userOne = accounts[10];
    userTwo = accounts[11];
    userThree = accounts[12];

    loyaltyCreators = [
      creatorOne,
      creatorTwo,
      creatorThree,
      creatorFour,
      creatorFive,
    ];

    //deploy test ERC1155 contract to be used as escrow rewards.
    //transfer test ERC155 tokens to loyalty program creators to be used for rewards depositing
    testCollection = await hre.ethers.deployContract("TestERC1155Collection");

    const creatorBalances: number[] = [];
    const amountsOfEachTokenId: number[] = Array(loyaltyCreators.length).fill(
      200
    );

    for (const loyaltyCreator of loyaltyCreators) {
      const creatorBalance = await handleTestERC1155TokenTransfer(
        testCollection,
        loyaltyCreator,
        testCollectionDeployer,
        amountsOfEachTokenId
      );
      const balanceToNum = creatorBalance.map((bal: any) => bal.toNumber());
      creatorBalances.push(balanceToNum);
    }

    expect(creatorBalances).deep.equal(
      Array(loyaltyCreators.length).fill(
        Array(amountsOfEachTokenId.length).fill(200)
      ),
      "Incorrect balances for each creator - should each have 200 of each token id"
    );

    //deploy 5 loyalty programs, 1 for each creator, to later test each ERC1155 rewardCondition.
    const useTiers = true;
    for (const loyaltyCreator of loyaltyCreators) {
      const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
        await deployProgramAndSetUpUntilDepositPeriod(
          "0_02",
          RewardType.ERC1155,
          useTiers,
          loyaltyCreator,
          testCollection.address
        );
      contracts.push({
        loyaltyAddress: loyaltyAddress,
        escrowAddress: escrowAddress ?? "",
        escrow: escrowContract,
        loyalty: loyaltyContract,
      });
    }

    //ensure initial state is correct for each contract
    const loyaltyStates: LoyaltyState[] = [];
    const escrowStates: EscrowState[] = [];

    for (const contract of contracts) {
      const loyaltyState = await contract.loyalty.state();
      const escrowState = await contract.escrow.escrowState();
      loyaltyStates.push(loyaltyState);
      escrowStates.push(escrowState);
    }

    expect(loyaltyStates).deep.equal(
      Array(loyaltyStates.length).fill(LoyaltyState.Idle),
      "Incorrect - states should be idle"
    );
    expect(escrowStates).deep.equal(
      Array(escrowStates.length).fill(EscrowState.DepositPeriod),
      "Incorrect - states should be in deposit period"
    );
  });
  it("deposits ERC1155 tokens into each escrow contracts and sets escrow settings in order to further test ERC1155 rewardConditions", async () => {
    //deposit 20 token id 0's, 30 token id 1's, 40 token id 2's, etc for each program
    const tokenIdsToDeposit = [0, 1, 2, 3, 4];
    const amountsToDeposit = [20, 30, 40, 50, 60];

    for (let i = 0; i < contracts.length; i++) {
      await testCollection
        .connect(loyaltyCreators[i])
        [
          "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)"
        ](loyaltyCreators[i].address, contracts[i].escrowAddress, tokenIdsToDeposit, amountsToDeposit, depositKeyBytes32);
    }

    //move time forward 3+ days so that deposit period is ended for each escrow contract.
    //ensure that state has now changed to AwaitingEscrowSettings for all contracts.
    await moveTime(THREE_DAYS_MS);

    const loyaltyStatesAfterDeposit: LoyaltyState[] = [];
    const escrowStatesAfterDeposit: EscrowState[] = [];
    for (let i = 0; i < contracts.length; i++) {
      const loyaltyState = await contracts[i].loyalty.state();
      const escrowState = await contracts[i].escrow.escrowState();
      loyaltyStatesAfterDeposit.push(loyaltyState);
      escrowStatesAfterDeposit.push(escrowState);
    }

    expect(loyaltyStatesAfterDeposit).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Idle),
      "Incorrect loyalty states"
    );
    expect(escrowStatesAfterDeposit).deep.equal(
      Array(contracts.length).fill(EscrowState.AwaitingEscrowSettings),
      "Incorrect escrow states"
    );

    //set escrow settings to test the different ERC1155 rewardConditions.
    //setEscrowSettingsBasic is used for desired SingleObjective, SingleTier, and PointsTotal conditions.
    //setEscrowSettingsAdvanced is used for desired EachObjective and EachTier rewardConditions.

    //first, set the first 3 contracts to test the "basic" reward conditions.
    //for these, "payout" represents the amount for the tokenId that creator wants to reward.
    //"rewardGoal" represents the objective index, tier index, or points total that will reward.

    const programOneTokenIdPayout = 0;
    const programOnePayoutAmount = 2;
    const programOneRewardGoal = 2; //representing objective index 2
    await contracts[0].escrow
      .connect(creatorOne)
      .setEscrowSettingsBasic(
        ERC1155RewardCondition.SingleObjective,
        programOneTokenIdPayout,
        programOnePayoutAmount,
        programOneRewardGoal
      );

    const programTwoTokenIdPayout = 1;
    const programTwoPayoutAmount = 1;
    const programTwoRewardGoal = 4; //representing tier index 4
    await contracts[1].escrow
      .connect(creatorTwo)
      .setEscrowSettingsBasic(
        ERC1155RewardCondition.SingleTier,
        programTwoTokenIdPayout,
        programTwoPayoutAmount,
        programTwoRewardGoal
      );

    const programThreeTokenIdPayout = 2;
    const programThreePayoutAmount = 3;
    const programThreeRewardGoal = 5000; //representing 5000 total points
    await contracts[2].escrow
      .connect(creatorThree)
      .setEscrowSettingsBasic(
        ERC1155RewardCondition.PointsTotal,
        programThreeTokenIdPayout,
        programThreePayoutAmount,
        programThreeRewardGoal
      );

    //set the last 2 contracts to test the "advanced" reward conditions
    const programFourTokenIdsPayout = [0, 1, 2, 3, 4]; //token ids to pay corresponding to objective indexes
    const programFourTokenAmounts = [1, 1, 2, 2, 4];
    await contracts[3].escrow
      .connect(creatorFour)
      .setEscrowSettingsAdvanced(
        ERC1155RewardCondition.EachObjective,
        programFourTokenIdsPayout,
        programFourTokenAmounts
      );

    //pass in zeros as first indexes because the first tier is not allowed to payout
    const programFiveTokenIdsPayout = [0, 1, 1, 3, 4]; //token ids to pay corresponding to tier indexes
    const programFiveTokenAmounts = [0, 2, 2, 3, 3];
    await contracts[4].escrow
      .connect(creatorFive)
      .setEscrowSettingsAdvanced(
        ERC1155RewardCondition.EachTier,
        programFiveTokenIdsPayout,
        programFiveTokenAmounts
      );

    //set all loyalty contracts to active which will move escrow state to InIssuance.
    //ensure now that escrow settings are set for each escrow contract,
    //...and now that programs are active, that escrow states have changed to InIssuance
    const loyaltyStatesAfterSettingsSet: LoyaltyState[] = [];
    const escrowStatesAfterSettingsSet: EscrowState[] = [];
    for (let i = 0; i < contracts.length; i++) {
      await contracts[i].loyalty
        .connect(loyaltyCreators[i])
        .setLoyaltyProgramActive();
      const loyaltyState = await contracts[i].loyalty.state();
      const escrowState = await contracts[i].escrow.escrowState();
      loyaltyStatesAfterSettingsSet.push(loyaltyState);
      escrowStatesAfterSettingsSet.push(escrowState);
    }

    expect(loyaltyStatesAfterSettingsSet).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Active),
      "Incorrect - states should be active"
    );
    expect(escrowStatesAfterSettingsSet).deep.equal(
      Array(contracts.length).fill(EscrowState.InIssuance),
      "Incorrect - escrow states should be InIssuance"
    );
  });
  it("ensures that 0.02 loyalty/ERC1155 escrow correctly processes SingleObjective rewardCondition as users complete objectives", async () => {
    //loyalty program 1 is set to SingleObjective reward condition.
    //it should payout 2 token id 0's per user completing objective index 2.

    //first, complete objective indexes 0 and 1, and ensure no tokens are rewarded.
    const loyaltyOne = contracts[0].loyalty;
    const escrowOne = contracts[0].escrow;

    const objectiveIndexZero = 0;
    const objectiveIndexOne = 1;
    const objectiveIndexTwo = 2;

    await loyaltyOne
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexZero);
    await loyaltyOne
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexOne);

    //ensure points are tracked but no tokens rewarded yet
    const userProgOne = await loyaltyOne.getUserProgression(userOne.address);
    const userCompletedObjsOne = await loyaltyOne.getUserCompletedObjectives(
      userOne.address
    );
    const userRewardBalOne = await escrowOne.getUserRewards(userOne.address);

    expect(userProgOne.rewardsEarned.toNumber()).equal(800, "Incorrect points");
    expect(userCompletedObjsOne).deep.equal(
      [true, true, false, false, false],
      "Incorrect complete objs"
    );
    expect(userRewardBalOne.length).equal(
      0,
      "Incorrect - no tokens should be rewarded yet"
    );

    //...TODO 2/11 - unfinished tests
  });
});
