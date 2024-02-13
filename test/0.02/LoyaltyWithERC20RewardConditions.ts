import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
  ERC20RewardCondition,
} from "../../constants/contractEnums";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  checkContractsState,
  type CreatorContracts,
} from "../../utils/deployLoyaltyUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";
import { getERC20UserProgress } from "../../utils/userProgressTestUtils";

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;
let creatorThree: SignerWithAddress;
let creatorFour: SignerWithAddress;
let creatorFive: SignerWithAddress;
let creatorSix: SignerWithAddress;
let creatorSeven: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

const contracts: CreatorContracts[] = [];
let loyaltyCreators: SignerWithAddress[] = [];

let testToken: any;
let testTokenDeployer: SignerWithAddress;

describe("LoyaltyProgram", () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    testTokenDeployer = accounts[0];

    creatorOne = accounts[1];
    creatorTwo = accounts[2];
    creatorThree = accounts[3];
    creatorFour = accounts[4];
    creatorFive = accounts[5];
    creatorSix = accounts[6];
    creatorSeven = accounts[7];

    userOne = accounts[10];
    userTwo = accounts[11];
    userThree = accounts[12];

    loyaltyCreators = [
      creatorOne,
      creatorTwo,
      creatorThree,
      creatorFour,
      creatorFive,
      creatorSix,
      creatorSeven,
    ];

    //deploy ERC20 test token to be used as rewards for escrow contracts
    testToken = await hre.ethers.deployContract("AdajToken");

    //transfer test ERC20 tokens to all creators to be used for rewards depositing
    const creatorInitialBalances: number[] = [];
    for (let i = 0; i < loyaltyCreators.length; i++) {
      await testToken.transfer(loyaltyCreators[i].address, 1_000_000);
      const balance = await testToken.balanceOf(loyaltyCreators[i].address);
      creatorInitialBalances.push(balance);
    }
    const creatorInitBalancesToNum = creatorInitialBalances.map((bal: any) =>
      bal.toNumber()
    );
    expect(creatorInitBalancesToNum).deep.equal(
      Array(loyaltyCreators.length).fill(1_000_000),
      "Incorrect initial creator balance"
    );

    //deploy 7 loyalty programs, 1 for each creator, to later test each ERC20 rewardCondition.
    const useTiers = true;
    for (const loyaltyCreator of loyaltyCreators) {
      const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
        await deployProgramAndSetUpUntilDepositPeriod(
          "0_02",
          RewardType.ERC20,
          useTiers,
          loyaltyCreator,
          testToken.address
        );
      contracts.push({
        loyaltyAddress: loyaltyAddress,
        escrowAddress: escrowAddress ?? "",
        escrow: escrowContract,
        loyalty: loyaltyContract,
      });
    }

    //ensure initial state is correct for each contract
    const { escrowStates, loyaltyStates } =
      await checkContractsState(contracts);

    expect(loyaltyStates).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Idle),
      "Incorrect - states should be idle"
    );
    expect(escrowStates).deep.equal(
      Array(contracts.length).fill(EscrowState.DepositPeriod),
      "Incorrect - states should be in deposit period"
    );
  });

  it("deposits ERC20 tokens into each escrow contract and sets escrow settings in order to further test ERC20 rewardConditions", async () => {
    //deposit ERC20 tokens into each of the 7 escrow contracts to be used as rewards.
    const tokenAmountsToDeposit = [500, 500, 500, 10_000, 20_000, 200, 1000];

    for (let i = 0; i < contracts.length; i++) {
      await testToken
        .connect(loyaltyCreators[i])
        .increaseAllowance(
          contracts[i].escrowAddress,
          tokenAmountsToDeposit[i]
        );
      await contracts[i].escrow
        .connect(loyaltyCreators[i])
        .depositBudget(tokenAmountsToDeposit[i], testToken.address);
    }

    //move time forward 3+ days so that deposit periods are over for each escrow contract.
    await moveTime(THREE_DAYS_MS);

    //ensure escrow states are now AwaitingEscrowSettings
    const {
      escrowStates: escrowStatesAfterDeposit,
      loyaltyStates: loyaltyStatesAfterDeposit,
    } = await checkContractsState(contracts);

    expect(escrowStatesAfterDeposit).deep.equal(
      Array(contracts.length).fill(EscrowState.AwaitingEscrowSettings),
      "Incorrect escrow states"
    );
    expect(loyaltyStatesAfterDeposit).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Idle)
    );

    //ensure escrowBalance state variables were set correctly after deposits
    const escrowBalanceStates = [];
    for (let i = 0; i < contracts.length; i++) {
      const escrowBal = await contracts[i].escrow
        .connect(loyaltyCreators[i])
        .lookupEscrowBalance();
      escrowBalanceStates.push(escrowBal.toNumber());
    }

    expect(escrowBalanceStates).deep.equal(
      tokenAmountsToDeposit,
      "Incorrect escrow balances state"
    );

    //set escrow settings in each escrow contract to further test all ERC20 reward conditions.
    //for "basic" reward conditions, setEscrowSettingsBasic function is used.
    //for "advanced" reward conditions, setEscrowSettingsAdvanced function is used.

    //rewardGoal in setEscrowSettingsBasic represents either desired tier index to reward,
    //or desired objective index to reward, or the PointsTotal to reward.
    //it is not needed for AllObjectivesComplete and AllTiersComplete, so can pass in 0.

    //for the "basic" conditions, since they are "one-off" conditions,
    //pass in the rewardAmount (ERC20 token value) for completing the condition.

    const escrowOneRewardAmount = 20;
    await contracts[0].escrow
      .connect(creatorOne)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.AllObjectivesComplete,
        0,
        escrowOneRewardAmount
      );

    const escrowTwoRewardAmount = 20;
    await contracts[1].escrow
      .connect(creatorTwo)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.AllTiersComplete,
        0,
        escrowTwoRewardAmount
      );

    const escrowThreeRewardAmount = 10;
    const escrowThreeRewardGoalObjIndex = 3;
    await contracts[2].escrow
      .connect(creatorThree)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.SingleObjective,
        escrowThreeRewardGoalObjIndex,
        escrowThreeRewardAmount
      );

    const escrowFourRewardAmount = 200;
    const escrowFourRewardGoalTierIndex = 2;
    await contracts[3].escrow
      .connect(creatorFour)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.SingleTier,
        escrowFourRewardGoalTierIndex,
        escrowFourRewardAmount
      );

    const escrowFiveRewardAmount = 1000;
    const escrowFiveRewardGoalPoints = 7000;
    await contracts[4].escrow
      .connect(creatorFive)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.PointsTotal,
        escrowFiveRewardGoalPoints,
        escrowFiveRewardAmount
      );

    //for the "advanced" conditions, RewardPerObjective and RewardPerTier,
    //use setEscrowSettingsAdvanced.
    //payouts array corresponds to tier indexes or objective indexes.
    //it represents the amount of ERC20 to reward per objective or tier completion.

    const escrowSixPayouts = [2, 2, 3, 4, 5]; //corresponding to objective indexes
    await contracts[5].escrow
      .connect(creatorSix)
      .setEscrowSettingsAdvanced(
        ERC20RewardCondition.RewardPerObjective,
        escrowSixPayouts
      );

    //first tier index is not allowed to payout, or contract will revert by design.
    //so pass in 0 as the first index.
    const escrowSevenPayouts = [0, 20, 30, 40, 80]; //corresponding to tier indexes
    await contracts[6].escrow
      .connect(creatorSeven)
      .setEscrowSettingsAdvanced(
        ERC20RewardCondition.RewardPerTier,
        escrowSevenPayouts
      );

    //set loyalty programs to active now that settings are set.
    for (let i = 0; i < contracts.length; i++) {
      await contracts[i].loyalty
        .connect(loyaltyCreators[i])
        .setLoyaltyProgramActive();
    }

    //ensure that all escrow states are now InIssuance.
    const {
      escrowStates: escrowStatesAfterSettings,
      loyaltyStates: loyaltyStatesAfterSettings,
    } = await checkContractsState(contracts);

    expect(loyaltyStatesAfterSettings).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Active)
    );
    expect(escrowStatesAfterSettings).deep.equal(
      Array(contracts.length).fill(EscrowState.InIssuance)
    );
  });
  it("ensures that 0.02 loyalty/ERC20 escrow correctly processes AllObjectivesComplete rewardCondition as users complete objectives", async () => {
    //loyalty program 1 has AllObjectivesComplete rewardCondition.
    //this means that it shouldnt reward tokens until all objectives are complete.
    //it should reward 20 ERC20 tokens when user completes all objectives.

    const loyaltyOne = contracts[0].loyalty;
    const escrowOne = contracts[0].escrow;

    //complete first four objective indexes and ensure no tokens were rewarded yet
    const objectiveIndexes = [0, 1, 2, 3, 4];

    for (let i = 0; i < objectiveIndexes.length - 1; i++) {
      await loyaltyOne
        .connect(userOne)
        .completeUserAuthorityObjective(objectiveIndexes[i]);
    }

    const {
      points: pointsOne,
      userObjsComplete: userObjsCompleteOne,
      balance: balanceOne,
    } = await getERC20UserProgress(loyaltyOne, escrowOne, userOne, creatorOne);

    expect(pointsOne).equal(3800, "Incorrect points");
    expect(userObjsCompleteOne).deep.equal(
      [true, true, true, true, false],
      "Incorrect completed objs"
    );
    expect(balanceOne).equal(
      0,
      "Incorrect - should have not been rewarded yet"
    );

    //complete the last objective, index 4, which will satisfy AllObjectivesComplete condition.
    //ensure that 20 ERC20 tokens were awarded to user for completion.

    await loyaltyOne
      .connect(creatorOne)
      .completeCreatorAuthorityObjective(objectiveIndexes[4], userOne.address);

    const {
      points: pointsFinal,
      userObjsComplete: userObjsFinal,
      balance: balanceFinal,
    } = await getERC20UserProgress(loyaltyOne, escrowOne, userOne, creatorOne);

    expect(pointsFinal).equal(7800, "Incorrect points");
    expect(userObjsFinal).deep.equal(
      Array(objectiveIndexes.length).fill(true),
      "Incorrect - all objs should be completed"
    );
    expect(balanceFinal).equal(
      20,
      "Incorrect, user should have been rewarded 20 ERC20 tokens"
    );

    //ensure amount rewarded to user escrow account is decreased from escrow balance.
    //escrow balance for esrow one was initially 500.
    const escrowBal = await escrowOne.connect(creatorOne).lookupEscrowBalance();
    expect(escrowBal.toNumber()).equal(
      480,
      "Incorrect, rewarded amount should be subtracted"
    );
  });
  it("ensures that 0.02 loyalty/ERC20 escrow correctly processes AllTiersComplete rewardCondition as users complete objectives", async () => {
    //loyalty program 2 has a AllTiersComplete reward condition.
    //completing all tiers (reaching last tier) should reward 20 ERC20 tokens.
    //no tokens should be rewarded until the last tier, index 4, is reached by user.

    const loyaltyTwo = contracts[1].loyalty;
    const escrowTwo = contracts[1].escrow;

    const objectiveIndexes = [0, 1, 2, 3, 4];

    //complete last 2 objective indexes which moves user into tier 2.
    //ensure no tokens are rewarded.
    await loyaltyTwo
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexes[3]);
    await loyaltyTwo
      .connect(creatorTwo)
      .completeCreatorAuthorityObjective(objectiveIndexes[4], userOne.address);

    const {
      points: pointsOne,
      currentTier: currentTierOne,
      userObjsComplete: userObjsOne,
      balance: balancesOne,
    } = await getERC20UserProgress(loyaltyTwo, escrowTwo, userOne, creatorTwo);

    expect(pointsOne).equal(6000, "Incorrect points");
    expect(currentTierOne).equal(2, "Incorrect tier");
    expect(userObjsOne).deep.equal(
      [false, false, false, true, true],
      "Incorrect completd objs"
    );
    expect(balancesOne).equal(0, "Incorrect - no tokens should be rewarded.");
  });
  it("ensures that 0.02 loyalty/ERC20 escrow correctly processes SingleObjective rewardCondition as users complete objectives", async () => {
    //loyalty program 3 has a SingleObjective reward condition.
    //the reward goal (objective index) was set to 3.
    //so only completing objective index 3 should reward tokens.
    //it should reward user with 10 ERC20 tokens.

    const loyaltyThree = contracts[2].loyalty;
    const escrowThree = contracts[2].escrow;

    //first, complete objectives that are not index 3 to ensure they dont reward tokens.
    const objectiveIndexZero = 0;
    const objectiveIndexFour = 4;
    const objectiveIndexThree = 3;

    await loyaltyThree
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexZero);
    await loyaltyThree
      .connect(creatorThree)
      .completeCreatorAuthorityObjective(objectiveIndexFour, userOne.address);

    const {
      points: pointsOne,
      userObjsComplete: userObjsCompleteOne,
      balance: balanceOne,
    } = await getERC20UserProgress(
      loyaltyThree,
      escrowThree,
      userOne,
      creatorThree
    );

    expect(pointsOne).equal(4400, "Incorrect points");
    expect(userObjsCompleteOne).deep.equal(
      [true, false, false, false, true],
      "Incorrect completed objs"
    );
    expect(balanceOne).equal(
      0,
      "Incorrect - no tokens should have been rewarded yet"
    );

    //complete the reward goal objective index 3.
    //ensure that it rewarded user with 10 ERC20 tokens.
    await loyaltyThree
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexThree);

    const {
      points: pointsFinal,
      userObjsComplete: userObjsFinal,
      balance: balanceFinal,
    } = await getERC20UserProgress(
      loyaltyThree,
      escrowThree,
      userOne,
      creatorThree
    );

    expect(pointsFinal).equal(6400, "Incorrect points");
    expect(userObjsFinal).deep.equal(
      [true, false, false, true, true],
      "Incorrect completed objs"
    );
    expect(balanceFinal).equal(
      10,
      "Incorrect token balance, should have been rewarded"
    );
  });
  it("ensures that 0.02 loyalty/ERC20 escrow correctly processes SingleTier rewardCondition as users complete objectives", async () => {
    //loyalty program 4 has a SingleTier reward condition.
    //the reward goal tier index was set to 2.
    //so reaching tier 2 or a higher tier should reward tokens.
    //if a user skips directly from tier 1 to tier 4, for example, it should still reward.
    //it should reward 200 ERC20 tokens to user.

    const loyaltyFour = contracts[3].loyalty;
    const escrowFour = contracts[3].escrow;

    //tier index 2 required 4400 points.
    //first, complete objectives that do not reach 4400 points.
    //ensure no tokens are rewarded.
    const objectiveIndexZero = 0;
    const objectiveIndexOne = 1;
    const objectiveIndexTwo = 2;
    const objectiveIndexThree = 3;
    const objectiveIndexFour = 4;

    await loyaltyFour
      .connect(userTwo)
      .completeUserAuthorityObjective(objectiveIndexZero);
    await loyaltyFour
      .connect(userTwo)
      .completeUserAuthorityObjective(objectiveIndexOne);
    await loyaltyFour
      .connect(userTwo)
      .completeUserAuthorityObjective(objectiveIndexThree);

    const {
      points: pointsOne,
      currentTier: currentTierOne,
      userObjsComplete: userObjsOne,
      balance: balanceOne,
    } = await getERC20UserProgress(
      loyaltyFour,
      escrowFour,
      userTwo,
      creatorFour
    );

    expect(pointsOne).equal(2800, "Incorrect points");
    expect(currentTierOne).equal(
      1,
      "Incorrect - user should only be in tier 1"
    );
    expect(userObjsOne).deep.equal(
      [true, true, false, true, false],
      "Incorrect completed objs"
    );
    expect(balanceOne).equal(0, "Incorrect - should not be rewarded yet");

    //complete objective index 2 and index 4.
    //this will cause a tier skip from tier 1 straight to tier 4.
    //the rewardGoal of tier index 2 should still be rewarded for.
    await loyaltyFour
      .connect(userTwo)
      .completeUserAuthorityObjective(objectiveIndexTwo);
    await loyaltyFour
      .connect(creatorFour)
      .completeCreatorAuthorityObjective(objectiveIndexFour, userTwo.address);

    const {
      points: pointsFinal,
      currentTier: currentTierFinal,
      userObjsComplete: userObjsFinal,
      balance: balanceFinal,
    } = await getERC20UserProgress(
      loyaltyFour,
      escrowFour,
      userTwo,
      creatorFour
    );

    expect(pointsFinal).equal(7800, "Incorrect points");
    expect(currentTierFinal).equal(4, "Incorrect tier");
    expect(userObjsFinal).deep.equal(
      [true, true, true, true, true],
      "Incorrect completed objs"
    );
    expect(balanceFinal).equal(
      200,
      "Incorrect - user should have been rewarded"
    );
  });
  it("ensures that 0.02 loyalty/ERC20 escrow correctly processes PointsTotal rewardCondition as users complete objectives", async () => {
    //loyalty program 5 has a PointsTotal reward condition.
    //the reward goal was set to 7000 points.
    //when 7000 points is reached or surpassed, it should reward tokens.
    //it should reward 1000 tokens.

    const loyaltyFive = contracts[4].loyalty;
    const escrowFive = contracts[4].escrow;

    //complete objective indexes 3 and 4 which brings points to 6000.
    //ensure no tokens are rewarded yet.
    const objectiveIndexThree = 3;
    const objectiveIndexFour = 4;
    const objectiveIndexTwo = 2;
    const objectiveIndexOne = 1;

    await loyaltyFive
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexThree);
    await loyaltyFive
      .connect(creatorFive)
      .completeCreatorAuthorityObjective(objectiveIndexFour, userOne.address);

    const {
      points: pointsOne,
      userObjsComplete: userObjsOne,
      balance: balanceOne,
    } = await getERC20UserProgress(
      loyaltyFive,
      escrowFive,
      userOne,
      creatorFive
    );

    expect(pointsOne).equal(6000, "Incorrect points");
    expect(userObjsOne).deep.equal(
      [false, false, false, true, true],
      "Incorrect completed objs"
    );
    expect(balanceOne).equal(
      0,
      "Incorrect - no tokens should have rewarded yet"
    );

    //complete objective index 2 which brings points to 7000.
    //ensure tokens were rewarded.
    await loyaltyFive
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexTwo);

    const {
      points: pointsTwo,
      userObjsComplete: userObjsTwo,
      balance: balanceTwo,
    } = await getERC20UserProgress(
      loyaltyFive,
      escrowFive,
      userOne,
      creatorFive
    );

    expect(pointsTwo).equal(7000, "Incorrect points");
    expect(userObjsTwo).deep.equal(
      [false, false, true, true, true],
      "Incorrect completed objs"
    );
    expect(balanceTwo).equal(
      1000,
      "Incorrect - should have been rewarded 1000 tokens"
    );

    //complete additional objective to ensure tokens arent rewarded again.
    //since PointsTotal is a "one-off" reward condition.
    await loyaltyFive
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexOne);

    const { points: finalPoints, balance: finalBalance } =
      await getERC20UserProgress(loyaltyFive, escrowFive, userOne, creatorFive);

    expect(finalPoints).equal(7400, "Incorrect points");
    expect(finalBalance).equal(
      1000,
      "Incorrect - balance should have stayed same"
    );
  });
  it("ensures that 0.02 loyalty/ERC20 escrow correctly processes RewardPerObjective rewardCondition as users complete objectives", async () => {
    //loyalty program 6 has RewardPerObjective (each objective) reward condition.
    //for each objective completed, it should reward tokens.
    //in escrow settings, it was set to reward these amounts:
    //corresponding to objective indexes - [2, 2, 3, 4, 5];

    const loyaltySix = contracts[5].loyalty;
    const escrowSix = contracts[5].escrow;
    const objectiveIndexes = [0, 1, 2, 3, 4];

    //complete the first four objective indexes (user authority)
    for (let i = 0; i < objectiveIndexes.length - 1; i++) {
      await loyaltySix
        .connect(userOne)
        .completeUserAuthorityObjective(objectiveIndexes[i]);
    }

    //complete objective index 4 (creator authority)
    await loyaltySix
      .connect(creatorSix)
      .completeCreatorAuthorityObjective(objectiveIndexes[4], userOne.address);

    //ensure that the user was rewarded correctly for each completion.
    const { points, currentTier, userObjsComplete, balance } =
      await getERC20UserProgress(loyaltySix, escrowSix, userOne, creatorSix);

    const correctBalance = 16; //add up amounts rewarded for each obj - [2, 2, 3, 4, 5]

    expect(points).equal(7800, "Incorrect points");
    expect(currentTier).equal(4, "Incorrect tier");
    expect(userObjsComplete).deep.equal(
      [true, true, true, true, true],
      "Incorrect completed objs"
    );
    expect(balance).equal(correctBalance);
  });
  it("ensures that 0.02 loyalty/ERC20 escrow correctly processes RewardPerTier rewardCondition as users complete objectives", async () => {
    //loyalty program 7 has RewardPerTier (each tier) reward condition.
    //each tier should reward tokens.
    //escrow settings was set to reward these amounts:
    //[0, 20, 30, 40, 80] (first tier cannot payout by design).

    const loyaltySeven = contracts[6].loyalty;
    const escrowSeven = contracts[6].escrow;
    const objectiveIndexes = [0, 1, 2, 3, 4];

    //complete all objectives to allow user to reach max tier.
    //ensure that all tiers were rewarded for.

    for (let i = 0; i < objectiveIndexes.length - 1; i++) {
      await loyaltySeven
        .connect(userOne)
        .completeUserAuthorityObjective(objectiveIndexes[i]);
    }

    await loyaltySeven
      .connect(creatorSeven)
      .completeCreatorAuthorityObjective(objectiveIndexes[4], userOne.address);

    //ensure that the user was rewarded correctly for tier reached.
    const { points, currentTier, userObjsComplete, balance } =
      await getERC20UserProgress(
        loyaltySeven,
        escrowSeven,
        userOne,
        creatorSeven
      );
    const correctBalance = 170; // add up these amounts for each tier - [0, 20, 30, 40, 80]

    expect(points).equal(7800, "Incorrect points");
    expect(currentTier).equal(4, "Incorrect tier");
    expect(userObjsComplete).deep.equal(
      [true, true, true, true, true],
      "Incorrect completed objs"
    );
    expect(balance).equal(correctBalance, "Incorrect balance");
  });
});
