import { expect } from "chai";
import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  ONE_MONTH_MS,
  ONE_MONTH_SECONDS,
  THREE_DAYS_MS,
} from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import { deployProgramAndSetUpUntilDepositPeriod } from "../../utils/deployLoyaltyUtils";
import {
  ERC20RewardCondition,
  EscrowState,
  LoyaltyState,
  RewardType,
} from "../../constants/contractEnums";
import { calculateRootHash } from "../../utils/merkleUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";
import { getAllContractLogsForEvent } from "../../utils/eventsUtils";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

let relayer: SignerWithAddress;

let users: SignerWithAddress[] = [];

let programOne: any;
let escrowOne: any;

let testToken: any;

const treeAddresses: string[] = [];
let initialMerkleRoot: string = "";

let objectiveCompleteEventsCount = 0;
let pointsGivenEventsCount = 0;
let erc20rewardedEventsCount = 0;

describe("LoyaltyProgram", async () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();

    creatorOne = accounts[1];
    relayer = accounts[5];
    users = accounts.slice(5);

    //deploy test ERC20 token to be used for ERC20 escrow rewards
    //transfer amount from minter to creatorOne to deposit as rewards
    testToken = await hre.ethers.deployContract("TestTokenTwo");

    const transferAmount = hre.ethers.utils.parseUnits("0.8", "ether");
    await testToken.transfer(creatorOne.address, transferAmount);

    const creatorOneInitialBal = await testToken.balanceOf(creatorOne.address);
    const creatorInitialBalEther = hre.ethers.utils.formatUnits(
      creatorOneInitialBal,
      "ether"
    );
    expect(creatorInitialBalEther).equal("0.8", "Incorrect starting bal");

    //deploy a loyalty program with ERC20Escrow contract
    initialMerkleRoot = calculateRootHash(treeAddresses);

    const { loyaltyContract, escrowContract } =
      await deployProgramAndSetUpUntilDepositPeriod(
        "0_03",
        RewardType.ERC20,
        true,
        creatorOne,
        testToken.address,
        initialMerkleRoot
      );

    programOne = loyaltyContract;
    escrowOne = escrowContract;
    expect(programOne.address).to.not.be.undefined;
    expect(escrowOne.address).to.not.be.undefined;

    //deposit reward tokens
    const depositAmountOne = hre.ethers.utils.parseUnits("0.6", "ether");

    await testToken
      .connect(creatorOne)
      .increaseAllowance(escrowOne.address, depositAmountOne);
    await escrowOne
      .connect(creatorOne)
      .depositBudget(depositAmountOne, depositKeyBytes32);

    const escrowBalOne = await escrowOne.escrowBalance.call();
    const escrowBalOneEther = hre.ethers.utils.formatUnits(
      escrowBalOne,
      "ether"
    );
    expect(escrowBalOneEther).equal("0.6", "Incorrect amount after deposit");
  });
  it("sets escrow settings and makes program active in order to further test events", async () => {
    //move time forward so deposit periods are over
    await moveTime(THREE_DAYS_MS);

    //set escrow settings.
    //reward tokens for each objective completed by a user.
    const payoutAmounts = Array(5).fill(
      hre.ethers.utils.parseUnits("0.0002", "ether")
    );

    await escrowOne
      .connect(creatorOne)
      .setEscrowSettingsAdvanced(
        ERC20RewardCondition.RewardPerObjective,
        payoutAmounts
      );

    //set program to active
    await programOne.connect(creatorOne).setLoyaltyProgramActive();

    //ensure contracts are ready to issue rewards
    const programState = await programOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(programState).equal(LoyaltyState.Active);
    expect(escrowState).equal(EscrowState.InIssuance);
  });
  it("completes objectives/gives points to a variety of users and ensures events are still emitting properly", async () => {
    //complete objective index 0 for each of the 15 user accounts.
    //also give points directly to all 15 users.
    //for simplicity, merkle root experimentative flow is commented out.
    //and also signature verification is disabled, since those arent important for the scope of this test
    for (const user of users) {
      await programOne
        .connect(relayer)
        .completeUserAuthorityObjective(0, user.address);

      await programOne.connect(relayer).givePointsToUser(user.address, 400);
    }

    //retrieve events emitted for each objective completion
    const objectiveEvents = await getAllContractLogsForEvent(
      programOne,
      "ObjectiveCompleted"
    );
    expect(objectiveEvents.length).equal(users.length);

    //retrieve events emitted for each points given
    const pointsEvents = await getAllContractLogsForEvent(
      programOne,
      "PointsUpdate"
    );
    expect(pointsEvents.length).equal(users.length);

    //retrieve events for ERC20 tokens rewarded for objective completion
    const rewardedEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC20Rewarded"
    );
    expect(rewardedEvents.length).equal(users.length);

    //maintain a count of the events (actually will be stored in off-chain db Moralis or my own db)
    objectiveCompleteEventsCount += objectiveEvents.length;
    pointsGivenEventsCount += pointsEvents.length;
    erc20rewardedEventsCount += rewardedEvents.length;
  });
  it("explores basic aggregate analytics just based off of emitted events", async () => {
    //complete 3 more diff objectives for 15 users.
    for (const user of users) {
      for (let objIndex = 1; objIndex < 4; objIndex++) {
        await programOne
          .connect(relayer)
          .completeUserAuthorityObjective(objIndex, user.address);
      }
    }

    //complete objective index 4 for only 10 of the users
    const onlySomeUsers = users.slice(5);
    const objIndexFour = 4;
    for (const user of onlySomeUsers) {
      await programOne
        .connect(creatorOne)
        .completeCreatorAuthorityObjective(objIndexFour, user.address);
    }

    //event counts should now be 55 plus the 15 events from earlier (70)
    const objectiveEvents = await getAllContractLogsForEvent(
      programOne,
      "ObjectiveCompleted"
    );
    const erc20RewardedEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC20Rewarded"
    );
    expect(objectiveEvents.length).equal(objectiveCompleteEventsCount + 55);
    expect(erc20RewardedEvents.length).equal(erc20rewardedEventsCount + 55);

    objectiveCompleteEventsCount += 55;
    erc20rewardedEventsCount += 55;

    //these ops will be straightforward in a db or with prisma, but anyways

    //count unique addresses that interacted with any objective
    //args 0 is the user topic from objective event
    const allAddresses = objectiveEvents.map((event) => event.args[0]);
    const uniqueAddressesAllEvents = new Set(allAddresses);

    expect(uniqueAddressesAllEvents.size).equal(users.length);

    //count all addresses that interacted with a particular objective.
    //args 1 is the objIndex topic from objective event
    const allAddressesOneObj = objectiveEvents
      .filter((event) => event.args[1].toNumber() === objIndexFour)
      .map((event) => event.args[0]);

    expect(allAddressesOneObj.length).equal(
      10,
      "Incorrect - only 10 users completed obj 4"
    );

    //get total interactions for each objective
    const onlyIndexesFromEvents = objectiveEvents.map((event) =>
      event.args[1].toNumber()
    );
    const objInteractions = onlyIndexesFromEvents.reduce((prev, curr) => {
      return prev[curr] ? ++prev[curr] : (prev[curr] = 1), prev, prev;
    }, {});

    expect(objInteractions["0"]).equal(15);
    expect(objInteractions["1"]).equal(15);
    expect(objInteractions["2"]).equal(15);
    expect(objInteractions["3"]).equal(15);
    expect(objInteractions["4"]).equal(10);
  });
  it("explores basic analytics for rewards distribution just based off of emitted events", async () => {
    const erc20RewardedEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC20Rewarded"
    );

    //total unique addresses who were rewarded a token
    const erc20EventsAddresses = erc20RewardedEvents.map(
      (event) => event.args[0]
    );
    const uniqueERC20EventAddresses = new Set(erc20EventsAddresses);

    expect(uniqueERC20EventAddresses.size).equal(users.length);

    //get total tokens rewarded in escrow just from emitted events..
    //70 objectives complete should yield 0.014 total tokens rewarded across users
    const totalRewardsAmount: number = erc20RewardedEvents
      .map((event) => Number(event.args[1]))
      .reduce((prev, curr) => prev + curr, 0);

    const totalRewardsAmountInEth = hre.ethers.utils.formatUnits(
      String(totalRewardsAmount),
      "ether"
    );

    expect(totalRewardsAmountInEth).equal(
      "0.014",
      "Incorrect total tokens rewarded"
    );

    //get all reward events for a particular user
    //reward condition is each objective, and user1 completed 4 objs.
    //so should have 4 ERC20Rewarded events
    const userOneEvents = erc20RewardedEvents.filter(
      (event) => event.args[0] === users[0].address
    );
    const userOneRewardsAmount: number = userOneEvents
      .map((event) => Number(event.args[1]))
      .reduce((prev, curr) => prev + curr, 0);

    const userOneRewardsAmountInEth = hre.ethers.utils.formatUnits(
      String(userOneRewardsAmount),
      "ether"
    );

    expect(userOneEvents[0].args[0]).equal(users[0].address);
    expect(userOneEvents.length).equal(4, "Incorrect user one events length");
    expect(userOneRewardsAmountInEth).equal(
      "0.0008",
      "Incorrect amounts retrieved by events"
    );

    //withdraw all rewarded tokens for each of the first five users
    //all users have earned 0.0008 tokens.
    const firstFiveUsers = users.slice(0, 5);

    for (const user of firstFiveUsers) {
      await escrowOne.connect(user).userWithdrawAll();
    }

    const withdrawEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC20UserWithdraw"
    );

    expect(withdrawEvents.length).equal(5, "Incorrect - 5 users withdrew");

    //get total amount withdrawn,  total rewarded tkns still in escrow.
    //also tokens that were rewarded but not yet withdrawn.
    //...strictly from events ofc, and then compare to actual escrow balance state.
    //5 users withdrew 0.008 tokens which should be 0.004 total.
    const totalAmountWithdrawn = withdrawEvents
      .map((event) => Number(event.args[1]))
      .reduce((prev, curr) => prev + curr, 0);

    const totalAmountWithdrawnInEth = hre.ethers.utils.formatUnits(
      String(totalAmountWithdrawn),
      "ether"
    );

    expect(totalAmountWithdrawnInEth).equal(
      "0.004",
      "Incorrect total amount withdrawn"
    );

    const unclaimedRewardedTokens = totalRewardsAmount - totalAmountWithdrawn;
    const unclaimedRewardedTokensInEth = hre.ethers.utils.formatUnits(
      String(unclaimedRewardedTokens),
      "ether"
    );

    expect(unclaimedRewardedTokensInEth).equal(
      "0.01",
      "Incorrect bal retrieved by events"
    );

    const inEscrowAmountContract = await escrowOne.lookupEscrowBalance();
    const escrowBalContractInEth = hre.ethers.utils.formatUnits(
      String(inEscrowAmountContract),
      "ether"
    );
    expect(escrowBalContractInEth).equal(
      "0.586",
      "Incorrect escrow contract bal"
    );
  });
  it("tests other analytics based on emitted events", async () => {
    //move time forward 1 month & withdraw more rewarded tokens as different users
    await moveTime(ONE_MONTH_MS);

    const nextFiveUsers = users.slice(5, 10);

    for (const user of nextFiveUsers) {
      await escrowOne.connect(user).userWithdrawAll();
    }

    const withdrawEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC20UserWithdraw"
    );

    expect(withdrawEvents.length).equal(10, "Incorrect withdraw events length");

    //shabbily calculate time between last reward and first withdraw by user
    //this prob wont have to be done with events stored in a db,
    //but is still nice to experiment. (i'm on generator power with no internet)
    //also prob doesnt need this much iteration, but oh well.
    const allRewardEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC20Rewarded"
    );

    const latestRewardEventPerUser = allRewardEvents.reduce((prev, curr) => {
      const user = curr.args[0];
      const rewardedAt = curr.args[2].toNumber();
      if (!prev[user]) prev[user] = rewardedAt;
      if (rewardedAt > prev[user]) prev[user] = rewardedAt;
      return prev;
    }, {});

    const firstWithdrawEventPerUser = withdrawEvents.reduce((prev, curr) => {
      const user = curr.args[0];
      const withdrawnAt = curr.args[2].toNumber();
      if (!prev[user]) prev[user] = withdrawnAt;
      if (withdrawnAt < prev[user]) prev[user] = withdrawnAt;
      return prev;
    }, {});

    //filter out users who havent withdrawn
    const userEventTimestamps = Object.keys(latestRewardEventPerUser)
      .map((key) => ({
        user: key,
        rewardTimestamp: latestRewardEventPerUser[key],
        withdrawTimestamp: firstWithdrawEventPerUser[key],
      }))
      .filter((item) => item.withdrawTimestamp);

    const userElapsedTimes = userEventTimestamps.map((item) => ({
      user: item.user,
      elapsedTimeMs: item.withdrawTimestamp - item.rewardTimestamp,
    }));

    const totalElapsedTimeMs =
      userElapsedTimes.reduce((prev, curr) => prev + curr.elapsedTimeMs, 0) /
      userElapsedTimes.length;

    const avgElapsedTimeMin = Math.floor(totalElapsedTimeMs / 60_000);

    //5 users withdrew right away (within 50ms of being rewarded LOL)
    //and then 5 users withdrew after 30+ days, so the average is about 19 min
    expect(avgElapsedTimeMin).equal(19, "Incorrect - should average out to 19");
  });
});
