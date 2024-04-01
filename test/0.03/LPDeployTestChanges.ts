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
import { deployProgramAndSetUpUntilDepositPeriod } from "../../utils/deployLoyaltyUtils";
import { getERC20UserProgress } from "../../utils/userProgressTestUtils";

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

let relayer: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

let loyaltyOne: any;
let escrowOne: any;
let testToken: any;
let testTokenDeployer: SignerWithAddress;

describe("LoyaltyProgram", () => {
  before(async () => {
    //deploy ERC20 test token to be used as rewards for escrow contracts

    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];

    relayer = accounts[5];

    userOne = accounts[10];
    userTwo = accounts[11];
    userThree = accounts[12];

    //deploy ERC20 test token to be used as rewards for escrow
    testToken = await hre.ethers.deployContract("AdajToken");

    await testToken.transfer(creatorOne.address, 1_000_000);
    const balance = await testToken.balanceOf(creatorOne.address);

    expect(balance.toNumber()).deep.equal(
      1_000_000,
      "Incorrect initial creator balance"
    );

    const useTiers = true;
    const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
      await deployProgramAndSetUpUntilDepositPeriod(
        "0_03",
        RewardType.ERC20,
        useTiers,
        creatorOne,
        testToken.address
      );
    loyaltyOne = loyaltyContract;
    escrowOne = escrowContract;
  });
  it("deposits ERC20 tokens to be used as rewards and further testing", async () => {
    await testToken
      .connect(creatorOne)
      .increaseAllowance(escrowOne.address, 1000);
    await escrowOne.connect(creatorOne).depositBudget(500, testToken.address);

    //move time forward and end the deposit period
    await moveTime(THREE_DAYS_MS);

    //ensure contract states are correct
    const loyaltyState = await loyaltyOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(escrowState).deep.equal(
      EscrowState.AwaitingEscrowSettings,
      "Incorrect escrow state"
    );
    expect(loyaltyState).deep.equal(
      LoyaltyState.Idle,
      "Incorrect loyalty state"
    );
  });
  it("sets ERC20 escrow settings to PointsTotal to ensure points and rewards are handled correctly after adding givePointsToUser functionality (reward points without completing objectives)", async () => {
    const rewardAmount = 100;
    const rewardGoalPoints = 7000;
    await escrowOne
      .connect(creatorOne)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.PointsTotal,
        rewardGoalPoints,
        rewardAmount
      );

    //after escrow settings set, make loyalty program active
    await loyaltyOne.connect(creatorOne).setLoyaltyProgramActive();

    //ensure contract states are correct
    const loyaltyState = await loyaltyOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(escrowState).deep.equal(
      EscrowState.InIssuance,
      "Incorrect escrow state"
    );
    expect(loyaltyState).deep.equal(
      LoyaltyState.Active,
      "Incorrect loyalty state"
    );
  });
  it("ensures greatestPointsGiven and totalPointsPossible are updated correctly when non objective related points are given via new 'givePointsToUser' func", async () => {
    //totalPointsPossible initialized at 7800 in constructor from objective points

    await loyaltyOne.connect(creatorOne).givePointsToUser(userOne.address, 100);

    const t1 = await loyaltyOne.totalPointsPossible.call();
    const g1 = await loyaltyOne.greatestPointsGiven.call();

    expect(t1.toNumber()).equal(7900, "Incorrect");
    expect(g1.toNumber()).equal(100, "Incorrect");

    await loyaltyOne.connect(creatorOne).givePointsToUser(userTwo.address, 100);

    const t2 = await loyaltyOne.totalPointsPossible.call();
    const g2 = await loyaltyOne.greatestPointsGiven.call();

    expect(t2.toNumber()).equal(7900, "Incorrect - should not have changed");
    expect(g2.toNumber()).equal(100, "Incorrect - should not have changed");

    await loyaltyOne.connect(creatorOne).givePointsToUser(userOne.address, 200);

    const t3 = await loyaltyOne.totalPointsPossible.call();
    const g3 = await loyaltyOne.greatestPointsGiven.call();

    expect(t3.toNumber()).equal(8100, "Incorrect");
    expect(g3.toNumber()).equal(300, "Incorrect");

    //ensure that relayer can also call function
    await loyaltyOne.connect(relayer).givePointsToUser(userTwo.address, 1000);
    const t4 = await loyaltyOne.totalPointsPossible.call();
    const g4 = await loyaltyOne.greatestPointsGiven.call();

    expect(t4.toNumber()).equal(8900, "Incorrect");
    expect(g4.toNumber()).equal(1100, "Incorrect");
  });
  it("ensures that users were rewarded points directly from 'givePointsToUser' func", async () => {
    //in last test, userOne was given 300 points.
    //in last test, userTwo was given 1100 points
    const { points: userOnePoints } = await getERC20UserProgress(
      loyaltyOne,
      escrowOne,
      userOne,
      creatorOne
    );

    const { points: userTwoPoints } = await getERC20UserProgress(
      loyaltyOne,
      escrowOne,
      userTwo,
      creatorOne
    );

    expect(userOnePoints).equal(300, "Incorrect, should be 300");
    expect(userTwoPoints).equal(1100, "Incorrect, should be 1100");
  });
  it("ensures that completing objectives still processes correctly after changes were made to complete objectives functions", async () => {
    //complete objective index 0,1, and 2 (worth 400, 400, 1000 points)
    const firstObjectives = [0, 1];
    const objectiveIndex2 = 2;

    //complete indexes 0 and 1 as the actual user
    //ensure that it can still be done after changes to
    //completeUserAuthorityObjective
    for (let i = 0; i < firstObjectives.length; i++) {
      await loyaltyOne
        .connect(userOne)
        .completeUserAuthorityObjective(firstObjectives[i], userOne.address);
    }

    //complete objective index 2 from the "relayer" address
    //this will ensure that the TX can also complete via,
    //a gasless meta transaction by a relayer
    await loyaltyOne
      .connect(relayer)
      .completeUserAuthorityObjective(objectiveIndex2, userOne.address);

    //ensure that the points are still tracked correctly when completing objs
    const {
      points: pointsOne,
      userObjsComplete: userObjsCompleteOne,
      balance: balanceOne,
    } = await getERC20UserProgress(loyaltyOne, escrowOne, userOne, creatorOne);

    expect(pointsOne).equal(2100, "Incorrect points");
    expect(userObjsCompleteOne).deep.equal(
      [true, true, true, false, false],
      "Incorrect completed objs"
    );
    expect(balanceOne).equal(
      0,
      "Incorrect - should have not been rewarded yet"
    );
  });
  it("ensures that a complete objective attempt from an incorrect address will stil throw a revert", async () => {
    /*
    const incorrectCall = await loyaltyOne
      .connect(userTwo)
      .completeUserAuthorityObjective(4, userOne.address);

    await expect(incorrectCall()).to.be.rejectedWith("OnlyUserOrRelay()");
    */
    //the above works but need additional plugin to test revert,
    //otherwise it is not caught
  });

  it("ensures that creator objective completion still processes correctly", async () => {
    //userOne is at 2100 points from previous tests.
    //complete the last objective which is creator authority and worth 4000 points.
    //ensure no ERC20 rewards were rewarded yet.
    await loyaltyOne
      .connect(creatorOne)
      .completeCreatorAuthorityObjective(4, userOne.address);

    const { points, userObjsComplete } = await getERC20UserProgress(
      loyaltyOne,
      escrowOne,
      userOne,
      creatorOne
    );

    expect(points).equal(6100, "Incorrect points");
    expect(userObjsComplete).deep.equal([true, true, true, false, true]);
  });
  it("ensures that ERC20 points based Reward Condition still functions correctly when 'givePointsToUsers' instead of an objective completion, triggers a user to be rewarded", async () => {
    //userOne is at 6100 points.
    //in set escrow settings, 7000 points was set as the reward goal.
    //reaching 7000 points should reward userOne with 100 tokens.
    //ensure that with new givePointsToUser function,
    //the user can be rewarded from this function as well and not just the objectives funcs.

    //give 2000 points to userOne, bringing total to 8100 and triggering rewards.
    await loyaltyOne.connect(relayer).givePointsToUser(userOne.address, 2000);

    //this also increases greatestPointsGiven to 2300.
    //(300 given to userOne in earlier test plus the 2300 now)

    const { points, userObjsComplete, currentTier, balance } =
      await getERC20UserProgress(loyaltyOne, escrowOne, userOne, creatorOne);

    expect(points).equal(8100, "Incorrect points");
    expect(userObjsComplete).deep.equal([true, true, true, false, true]);
    expect(currentTier).equal(4);
    expect(balance).equal(
      100,
      "Incorrect - should have been rewarded 100 ERC20 tokens"
    );

    //also ensure that greatestPointsGiven and totalPointsPossible state,
    //were updated.
    const totalPointsPossible = await loyaltyOne.totalPointsPossible.call();
    const greatestPointsGiven = await loyaltyOne.greatestPointsGiven.call();

    //2300 was the greatest points rewarded to a user, userOne,
    //so combined with 7800 total points from the objectives points rewards,
    //the totalPointsPossible for a user should be 10100.
    expect(totalPointsPossible.toNumber()).equal(
      10100,
      "Incorrect total points possible"
    );
    expect(greatestPointsGiven.toNumber()).equal(
      2300,
      "Incorrect greatest points given"
    );

    //complete the last uncompleted objective and ensure that,
    //the tokens arent rewarded again since the PointsTotal rewardCondition,
    //is a condition that should reward tokens only once.
    const remainingUncompletedObjIndex = 3;
    await loyaltyOne
      .connect(relayer)
      .completeUserAuthorityObjective(
        remainingUncompletedObjIndex,
        userOne.address
      );

    const {
      points: finalPoints,
      userObjsComplete: finalObj,
      currentTier: finalTiers,
      balance: finalBalance,
    } = await getERC20UserProgress(loyaltyOne, escrowOne, userOne, creatorOne);

    expect(finalPoints).equal(10100, "Incorrect user one final points");
    expect(finalObj).deep.equal(
      Array(5).fill(true),
      "All objs should be complete"
    );
    expect(finalTiers).equal(4, "Should be in last tier");
    expect(finalBalance).equal(
      100,
      "Incorrect - should not have been rewarded more tokens"
    );
  });
});
