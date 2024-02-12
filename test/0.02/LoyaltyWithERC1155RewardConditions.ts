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
  type CreatorContracts,
} from "../../utils/deployLoyaltyUtils";
import { getERC1155UserProgress } from "../../utils/userProgressTestUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";

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
    const programTwoRewardGoal = 3; //representing tier index 3
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
    const {
      points: pointsOne,
      userObjsComplete: userCompletedObjsOne,
      balance: balanceOne,
    } = await getERC1155UserProgress(loyaltyOne, escrowOne, userOne);

    expect(pointsOne).equal(800, "Incorrect points");
    expect(userCompletedObjsOne).deep.equal(
      [true, true, false, false, false],
      "Incorrect complete objs"
    );
    expect(balanceOne.length).equal(
      0,
      "Incorrect - no tokens should be rewarded yet"
    );

    //complete objective index 2 which should reward user.
    //it should reward 2 token id #0's.
    await loyaltyOne
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexTwo);

    const {
      points: pointsTwo,
      userObjsComplete: userCompletedObjsTwo,
      balance: balanceTwo,
    } = await getERC1155UserProgress(loyaltyOne, escrowOne, userOne);

    const correctUserBalShape = [{ tokenId: 0, amount: 2 }];

    expect(pointsTwo).equal(1800, "Incorrect points");
    expect(userCompletedObjsTwo).deep.equal(
      [true, true, true, false, false],
      "Incorrect complete objs"
    );
    expect(balanceTwo).deep.equal(correctUserBalShape, "Incorrect balance");

    //complete remaining two objective indexes.
    //ensure tokens arent rewarded again, since this RewardCondition is SingleObjective.
    //it should only reward the token for completing objective index two, one time.
    const objectiveIndexThree = 3;
    const objectiveIndexFour = 4;

    await loyaltyOne
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexThree);

    await loyaltyOne
      .connect(creatorOne)
      .completeCreatorAuthorityObjective(objectiveIndexFour, userOne.address);

    const userFinalBal = await escrowOne.getUserRewards(userOne.address);
    expect(userFinalBal.length).equal(
      1,
      "Should still only have 1 rewarded token"
    );
  });
  it("ensures that 0.02 loyalty/ERC1155 escrow correctly processes SingleTier rewardCondition as users complete objectives", async () => {
    //loyalty program 2's ERC1155 escrow has a SingleTier reward condition.
    //in this program, users should be rewarded 1 token id #1, only when they reach tier 3.
    //7000 points is needed to reach tier 3.
    const loyaltyTwo = contracts[1].loyalty;
    const escrowTwo = contracts[1].escrow;

    const objectiveIndexTwo = 2;
    const objectiveIndexThree = 3;
    const objectiveIndexFour = 4;

    //complete objective index 2 and 3 which brings points to 3000.
    //this should not warrant tokens to be rewarded.
    await loyaltyTwo
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexTwo);
    await loyaltyTwo
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexThree);

    const {
      points: pointsOne,
      currentTier: currentTierOne,
      userObjsComplete: userCompletedObjsOne,
      balance: balanceOne,
    } = await getERC1155UserProgress(loyaltyTwo, escrowTwo, userOne);

    expect(pointsOne).equal(3000, "Incorrect points");
    expect(currentTierOne).equal(1, "Incorrect tier");
    expect(userCompletedObjsOne).deep.equal(
      [false, false, true, true, false],
      "Incorrect completed objs"
    );
    expect(balanceOne.length).equal(
      0,
      "Incorrect, no tokens should have rewarded yet"
    );

    //complete objective index 4 (worth 4000 points).
    //this will bring points total to 7000.
    //tier 3 requires 7000 points, so this should move user into tier 3.
    //it should reward the user 1 token id #1.
    await loyaltyTwo
      .connect(creatorTwo)
      .completeCreatorAuthorityObjective(objectiveIndexFour, userOne.address);

    const {
      points: pointsTwo,
      currentTier: currentTierTwo,
      userObjsComplete: userCompletedObjsTwo,
      balance: balanceTwo,
    } = await getERC1155UserProgress(loyaltyTwo, escrowTwo, userOne);
    const correctBalShape = [{ tokenId: 1, amount: 1 }];

    expect(pointsTwo).equal(7000, "Incorrect points");
    expect(currentTierTwo).equal(3, "Incorrect tier");
    expect(userCompletedObjsTwo).deep.equal(
      [false, false, true, true, true],
      "Incorrect completed objs"
    );
    expect(balanceTwo.length).equal(
      1,
      "Incorrect - user should have been rewarded"
    );
    expect(balanceTwo).deep.equal(correctBalShape, "Incorrect balance");
  });
  it("ensures that 0.02 loyalty/ERC1155 escrow correctly processes PointsTotal rewardCondition as users complete objectives", async () => {
    //loyalty program 3 has a PointsTotal reward condition.
    //meaning that reaching or surpassing 5000 total points will reward.
    //user should be rewarded 3 token id #2's.
    const loyaltyThree = contracts[2].loyalty;
    const escrowThree = contracts[2].escrow;

    //first, complete objectives which shoyld not reward a token.
    //complete objective indexes and 0 and 1 first.
    //ensure no tokens were rewarded.
    const objectiveIndexZero = 0;
    const objectiveIndexOne = 1;
    const objectiveIndexTwo = 2;
    const objectiveIndexThree = 3;
    const objectIndexFour = 4;

    await loyaltyThree
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexZero);
    await loyaltyThree
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexOne);

    const {
      points: pointsOne,
      userObjsComplete: userCompletedObjsOne,
      balance: balanceOne,
    } = await getERC1155UserProgress(loyaltyThree, escrowThree, userOne);

    expect(pointsOne).equal(800, "Incorrect points");
    expect(userCompletedObjsOne).deep.equal(
      [true, true, false, false, false],
      "Incorrect complete objs"
    );
    expect(balanceOne.length).equal(
      0,
      "Incorrect - no tokens should be rewarded yet"
    );

    //complete objective index 3 and 4 which will bring points total to 6800.
    //3 token id #2's should be rewarded to user now since they passed 5000 rewardGoal.
    await loyaltyThree
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexThree);
    await loyaltyThree
      .connect(creatorThree)
      .completeCreatorAuthorityObjective(objectIndexFour, userOne.address);

    const {
      points: pointsTwo,
      userObjsComplete: userCompletedObjsTwo,
      balance: balanceTwo,
    } = await getERC1155UserProgress(loyaltyThree, escrowThree, userOne);

    const correctBalanceShape = [
      {
        tokenId: 2,
        amount: 3,
      },
    ];

    expect(pointsTwo).equal(6800, "Incorrect points");
    expect(userCompletedObjsTwo).deep.equal(
      [true, true, false, true, true],
      "Incorrect completed objs"
    );
    expect(balanceTwo).deep.equal(
      correctBalanceShape,
      "Incorrect balance - user shouldve been rewarded"
    );

    //complete additional objective to ensure tokens arent rewarded again.
    //since PointsTotal is a one-off reward condition.
    await loyaltyThree
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexTwo);

    const { points: pointsThree, balance: balanceThree } =
      await getERC1155UserProgress(loyaltyThree, escrowThree, userOne);
    expect(pointsThree).equal(7800, "Incorrect points");
    expect(balanceThree.length).equal(
      1,
      "No more tokens shouldve been rewarded"
    );
  });
  it("ensures that 0.02 loyalty/ERC1155 escrow correctly processes EachObjective rewardCondition as users complete objectives", async () => {
    //loyalty program 4 has EachObjective reward condition.
    //it should reward tokens for each objective completed by users.
    //payouts were:
    //these token ids: [0, 1, 2, 3, 4]
    //these amounts: [1, 1, 2, 2, 4];
    //completing objective index 0 should reward 1 token id #0.
    //completing objective index 1 should reward 1 token id #1.
    //and so on....

    //complete all objectives in loyalty program 4.
    //ensure that balances are correct.
    const loyaltyFour = contracts[3].loyalty;
    const escrowFour = contracts[3].escrow;
    const objectiveIndexes = [0, 1, 2, 3, 4];

    //complete first 4 objectives (user authority)
    for (let i = 0; i < objectiveIndexes.length - 1; i++) {
      await loyaltyFour
        .connect(userOne)
        .completeUserAuthorityObjective(objectiveIndexes[i]);
    }

    //complete last objective (creator authority)
    await loyaltyFour
      .connect(creatorFour)
      .completeCreatorAuthorityObjective(objectiveIndexes[4], userOne.address);

    //ensure progression is processed and ensure correct token balance.
    const { points, userObjsComplete, balance, currentTier } =
      await getERC1155UserProgress(loyaltyFour, escrowFour, userOne);
    const correctTokenBalance = [
      {
        tokenId: 0,
        amount: 1,
      },
      { tokenId: 1, amount: 1 },
      { tokenId: 2, amount: 2 },
      { tokenId: 3, amount: 2 },
      { tokenId: 4, amount: 4 },
    ];

    expect(points).equal(7800, "Incorrect points");
    expect(currentTier).equal(4, "Incorrect tier");
    expect(userObjsComplete).deep.equal(
      Array(objectiveIndexes.length).fill(true),
      "Incorrect - all objs should be completed"
    );
    expect(balance).deep.equal(
      correctTokenBalance,
      "Incorrect balances - should have been rewarded for each obj index"
    );
  });
  it("ensures that 0.02 loyalty/ERC1155 escrow correctly processes EachTier rewardCondition as users complete objectives", async () => {
    //loyalty program 5 has EachTier reward condition.
    //it should reward tokens for each tier reached by user.
    //it should also reward for "skipped tiers".
    //for example, if user was in tier 1 and earned enough points to go directly to tier 4,
    //it should still reward for tier 1, 2, 3, and 4.
    //tier index 0 cannot be set to payout any tokens. so if not in at least tier index 1,
    //no token should be rewarded.
    //token ids to payout: [0, 1, 1, 3, 4]
    //amounts of each to payout: [0, 2, 2, 3, 3]
    //note that the zero indexes are forced to be 0's here (from setEscrowSettings)

    const loyaltyFive = contracts[4].loyalty;
    const escrowFive = contracts[4].escrow;

    //first, complete objective index 0, worth 400 points.
    //points required for tier index 1 is 400, so user should be rewarded for tier 1.
    //they should be rewarded 2 token id #1's.
    const objectiveIndexes = [0, 1, 2, 3, 4];
    await loyaltyFive
      .connect(userTwo)
      .completeUserAuthorityObjective(objectiveIndexes[0]);

    const {
      points: pointsOne,
      userObjsComplete: userCompletedObjsOne,
      balance: balanceOne,
      currentTier: currentTierOne,
    } = await getERC1155UserProgress(loyaltyFive, escrowFive, userTwo);

    const correctBalanceOne = [{ tokenId: 1, amount: 2 }];

    expect(pointsOne).equal(400, "Incorrect points");
    expect(userCompletedObjsOne).deep.equal(
      [true, false, false, false, false],
      "Incorrect completed objs"
    );
    expect(currentTierOne).equal(1, "Incorrect - user should now be in tier 1");
    expect(balanceOne).deep.equal(
      correctBalanceOne,
      "Incorrect - should have 2 token id #1's"
    );

    //complete objective indexes 1, 2, and 3.
    //this will bring points to 3800, however, tier should not changed.
    //ensure balance is still the same.
    for (let i = objectiveIndexes[1]; i < objectiveIndexes.length - 1; i++) {
      await loyaltyFive
        .connect(userTwo)
        .completeUserAuthorityObjective(objectiveIndexes[i]);
    }
    const {
      points: pointsTwo,
      userObjsComplete: userCompletedObjsTwo,
      balance: balanceTwo,
      currentTier: currentTierTwo,
    } = await getERC1155UserProgress(loyaltyFive, escrowFive, userTwo);

    expect(pointsTwo).equal(3800, "Incorrect points");
    expect(userCompletedObjsTwo).deep.equal(
      [true, true, true, true, false],
      "Incorrect completed objs"
    );
    expect(currentTierTwo).equal(
      1,
      "Incorrect - user should still be in tier 1, as tier 2 requires 4400 points"
    );
    expect(balanceTwo).deep.equal(
      correctBalanceOne,
      "Incorrect - balance should not have changed"
    );

    //complete the last objective, objective index 4.
    //this should cause a "tier skip" from tier index 1 all the way to last tier, tier index 4.
    //ensure that user was rewarded for each tier skip - 2, 3, and 4.
    await loyaltyFive
      .connect(creatorFive)
      .completeCreatorAuthorityObjective(objectiveIndexes[4], userTwo.address);

    const {
      points: pointsFinal,
      userObjsComplete: userCompletedObjsFinal,
      balance: balanceFinal,
      currentTier: currentTierFinal,
    } = await getERC1155UserProgress(loyaltyFive, escrowFive, userTwo);

    const correctFinalBalance = [
      { tokenId: 1, amount: 2 },
      { tokenId: 1, amount: 2 },
      { tokenId: 3, amount: 3 },
      { tokenId: 4, amount: 3 },
    ];

    expect(pointsFinal).equal(7800, "Incorrect points");
    expect(userCompletedObjsFinal).deep.equal(
      Array(objectiveIndexes.length).fill(true),
      "Incorrect - all objs should be completed"
    );
    expect(currentTierFinal).equal(4, "Incorrect - should be in last tier");
    expect(balanceFinal).deep.equal(
      correctFinalBalance,
      "Incorrect - all tiers should be rewarded for"
    );
  });
});
