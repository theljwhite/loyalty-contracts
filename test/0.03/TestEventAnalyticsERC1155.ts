import { expect } from "chai";
import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ONE_MONTH_MS, THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  handleTestERC1155TokenTransfer,
} from "../../utils/deployLoyaltyUtils";
import {
  ERC1155RewardCondition,
  EscrowState,
  LoyaltyState,
  RewardType,
} from "../../constants/contractEnums";
import { calculateRootHash } from "../../utils/merkleUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";
import { getAllContractLogsForEvent } from "../../utils/eventsUtils";

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

let relayer: SignerWithAddress;

let users: SignerWithAddress[] = [];

let programOne: any;
let escrowOne: any;

let testCollection: any;

const treeAddresses: string[] = [];
let initialMerkleRoot: string = "";

describe("LoyaltyProgram", async () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();

    creatorOne = accounts[1];
    relayer = accounts[5];
    users = accounts.slice(5);

    //deploy test ERC1155 collection to be used for ERC1155 escrow rewards
    //transfer tokens from minter to creatorOne to deposit as rewards
    testCollection = await hre.ethers.deployContract("TestERC1155Collection");

    const amountsOfEachTokenId = Array(5).fill(1000);
    const creatorBalance = await handleTestERC1155TokenTransfer(
      testCollection,
      creatorOne,
      accounts[0],
      amountsOfEachTokenId
    );
    const creatorBalanceToNum = creatorBalance.map((bal: any) =>
      bal.toNumber()
    );
    expect(creatorBalanceToNum).deep.equal(
      amountsOfEachTokenId,
      "Incorrect creator initial balances"
    );

    //deploy a loyalty program with ERC1155 escrow contract
    initialMerkleRoot = calculateRootHash(treeAddresses);

    const { loyaltyContract, escrowContract } =
      await deployProgramAndSetUpUntilDepositPeriod(
        "0_03",
        RewardType.ERC1155,
        true,
        creatorOne,
        testCollection.address,
        initialMerkleRoot
      );

    programOne = loyaltyContract;
    escrowOne = escrowContract;
    expect(programOne.address).to.not.be.undefined;
    expect(escrowOne.address).to.not.be.undefined;

    //deposit reward tokens to be used for rewards
    const tokenIdsToDeposit = [0, 1, 2, 3];
    const amountsToDeposit = Array(4).fill(800);

    await testCollection
      .connect(creatorOne)
      [
        "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)"
      ](creatorOne.address, escrowOne.address, tokenIdsToDeposit, amountsToDeposit, depositKeyBytes32);
  });

  it("sets escrow settings and makes program active in order to further test events", async () => {
    //move time forward 3 days so that the deposit period is ended
    await moveTime(THREE_DAYS_MS);

    //set escrow settings to reward each completed objective by a user
    const tokenIdsPayout = [0, 1, 2, 3, 0];
    const tokenAmounts = [1, 1, 1, 2, 4];
    await escrowOne
      .connect(creatorOne)
      .setEscrowSettingsAdvanced(
        ERC1155RewardCondition.EachObjective,
        tokenIdsPayout,
        tokenAmounts
      );

    //set the program to active, ensure contract states are correct
    await programOne.connect(creatorOne).setLoyaltyProgramActive();

    const loyaltyState = await programOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(loyaltyState).equal(LoyaltyState.Active);
    expect(escrowState).equal(EscrowState.InIssuance);
  });
  it("ensures ERC1155 rewarded events are still emitting properly", async () => {
    //complete objective index 0 for each of the 15 user accounts

    for (const user of users) {
      await programOne
        .connect(user)
        .completeUserAuthorityObjective(0, user.address);
    }

    //retrieve events emitted by loyalty contract for each objective completion
    const objectiveEvents = await getAllContractLogsForEvent(
      programOne,
      "ObjectiveCompleted"
    );

    //retrieve events emitted by escrow contract for each objective completion,
    //since in this case each objective completion yields an ERC1155 token to be rewarded
    const rewardEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC1155Rewarded"
    );

    expect(objectiveEvents.length).equal(15, "Incorrect obj events length");
    expect(rewardEvents.length).equal(15, "Incorrect reward events length");
  });
  it("explores basic aggregate analytics just based off of emitted ERC1155 escrow events", async () => {
    //complete 3 more diff objectives for 15 users
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

    //events should not be 55 plus the 15 events from earlier (70)
    const objectiveEvents = await getAllContractLogsForEvent(
      programOne,
      "ObjectiveCompleted"
    );
    const rewardEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC1155Rewarded"
    );

    expect(objectiveEvents.length).equal(70, "Incorrect - should be 70 events");
    expect(rewardEvents.length).equal(70, "Incorrect reward events length");

    //get total unique addresses who were rewarded a token
    const erc155EventsAddresses = rewardEvents.map((event) => event.args[0]);
    const uniqueERC1155EventAddresses = new Set(erc155EventsAddresses);

    expect(uniqueERC1155EventAddresses.size).equal(users.length);

    //get total amounts rewarded of each token id
    const tokenAmounts = rewardEvents.reduce((prev, curr) => {
      const tokenId = curr.args[1].toNumber();
      const amount = curr.args[2].toNumber();

      if (!prev[tokenId]) prev[tokenId] = 0;
      prev[tokenId] = amount + prev[tokenId];
      return prev;
    }, {});

    expect(tokenAmounts["0"]).equal(55, "Incorrect - sb 55 token id 0's");
    expect(tokenAmounts["1"]).equal(15, "Incorrect - sb 15 token id 1's");
    expect(tokenAmounts["2"]).equal(15, "Incorrect - sb 15 token id 2's");
    expect(tokenAmounts["3"]).equal(30, "Incorrect - sb 30 token id 3's");

    //count the instances of token ids being rewarded (not the amounts).
    //the number of events where any amounts of each token id were rewarded.
    const tokenInstances = rewardEvents.reduce((prev, curr) => {
      const tokenId = curr.args[1].toNumber();

      if (!prev[tokenId]) prev[tokenId] = 0;
      ++prev[tokenId];
      return prev;
    }, {});

    expect(tokenInstances["0"]).equal(25);
    expect(tokenInstances["1"]).equal(15);
    expect(tokenInstances["2"]).equal(15);
    expect(tokenInstances["3"]).equal(15);

    //get total amount of each deposited token ids remaining in escrow.
    //without using contract state, only emitted events.
    const initTokenDepositAmounts = Array(4).fill(800);

    const remainingEscrowBalanceEvents = Object.entries(tokenAmounts).map(
      ([key, value]) => ({
        tokenId: key,
        value:
          initTokenDepositAmounts[key as keyof typeof initTokenDepositAmounts] -
          Number(value),
      })
    );

    //verify that it matches actual contract state
    const remainingEscrowBalanceContract = [];

    for (let tokenId = 0; tokenId < initTokenDepositAmounts.length; tokenId++) {
      const balance = await escrowOne.getEscrowTokenBalance(tokenId);
      remainingEscrowBalanceContract.push({
        tokenId: String(tokenId),
        value: balance.toNumber(),
      });
    }

    expect(remainingEscrowBalanceEvents).deep.equal(
      remainingEscrowBalanceContract,
      "Incorrect - remaining bal from contract events mismatches contract state"
    );
  });
  it("explores more basic aggregate analytics just based off of emitted ERC1155 escrow and program events", async () => {
    const objectiveEvents = await getAllContractLogsForEvent(
      programOne,
      "ObjectiveCompleted"
    );
    const rewardEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC1155Rewarded"
    );

    //get aggregate list of user points only from events and not contract state.
    //this should be a simple call in a db, as wont have to iterate every event, but still
    const userLastEvents = objectiveEvents.reduce((prev, curr) => {
      const user = curr.args[0];
      const currTimestamp = curr.args[2].toNumber();
      if (!prev[user]) prev[user] = curr;

      if (currTimestamp > prev[user].args[2].toNumber()) {
        prev[user] = curr;
      }

      return prev;
    }, {});

    expect(Object.keys(userLastEvents).length).equal(users.length);

    //verify that a user who completed all 5 objectives has correct total points,
    //returned by the events. args 3 is the totalPoints event topic.
    const userFifteen = users[14].address;
    const userFifteenPointsTotal = userLastEvents[userFifteen].args[3];
    const { rewardsEarned: userFifteenPointsFromContract } =
      await programOne.getUserProgression(userFifteen);

    expect(userFifteenPointsTotal.toNumber()).equal(
      7800,
      "Incorrect points total from events"
    );
    expect(userFifteenPointsFromContract.toNumber()).equal(
      7800,
      "Incorrect points total in contract state"
    );

    //verify that a user who completed only 4 objectives has correct total points,
    //returned by the events
    const userOne = users[0].address;
    const userOnePointsTotal = userLastEvents[userOne].args[3];
    const { rewardsEarned: userOnePointsFromContract } =
      await programOne.getUserProgression(userOne);

    expect(userOnePointsTotal.toNumber()).equal(
      3800,
      "Incorrect points from events"
    );
    expect(userOnePointsFromContract.toNumber()).equal(
      3800,
      "Incorrect points from contract"
    );

    //show aggregate list of user addresses and total points
    const pointsList = Object.entries(userLastEvents).map(([key, value]) => ({
      user: key,
      points: (value as Record<string, any>).args[3].toNumber(),
    }));

    const correctFirstFiveUsers = users
      .slice(0, 5)
      .map((user) => ({ user: user.address, points: 3800 }));
    const correctNextTenUsers = users
      .slice(-10)
      .map((user) => ({ user: user.address, points: 7800 }));
    const correctListShape = [...correctFirstFiveUsers, ...correctNextTenUsers];

    expect(pointsList).deep.equal(correctListShape);
  });
  it("continues exploring more aggregate analytics just based off of emitted ERC1155 escrow events", async () => {
    const rewardEvents = await getAllContractLogsForEvent(
      escrowOne,
      "ERC1155Rewarded"
    );

    //get token balance of each user from events.
    //show aggregate list of user addresses and rewarded balances
    const userEventBalances = rewardEvents.reduce((prev, curr) => {
      const user = curr.args[0];
      const tokenId = curr.args[1].toNumber();
      const amount = curr.args[2].toNumber();

      if (!prev[user]) prev[user] = [];
      prev[user].push({ tokenId, amount });

      return prev;
    }, {});

    expect(Object.keys(userEventBalances).length).equal(15);

    const userOneEventBal = userEventBalances[users[0].address];
    const userFifteenEventBal = userEventBalances[users[14].address];

    const correctUserOneBalShape = [
      {
        tokenId: 0,
        amount: 1,
      },
      { tokenId: 1, amount: 1 },
      { tokenId: 2, amount: 1 },
      { tokenId: 3, amount: 2 },
    ];
    const correctUserFifteenBalShape = [
      ...correctUserOneBalShape,
      { tokenId: 0, amount: 4 },
    ];

    expect(userOneEventBal).deep.equal(correctUserOneBalShape);
    expect(userFifteenEventBal).deep.equal(correctUserFifteenBalShape);

    //estimate time users took to withdraw tokens from time of last reward.
    //move time forward about 1 month
    await moveTime(ONE_MONTH_MS);

    //withdraw tokens for first five users
    const firstFiveUsers = users.slice(0, 5);

    for (const user of firstFiveUsers) {
      await escrowOne.connect(user).userWithdrawAll();
    }

    const withdrawEventsOne = await getAllContractLogsForEvent(
      escrowOne,
      "UserWithdrawAll"
    );

    expect(withdrawEventsOne.length).equal(5);

    //move time forward about 2 months again and withdraw with next set of users
    await moveTime(ONE_MONTH_MS * 2);

    const nextFiveUsers = users.slice(6, 11);

    for (const user of nextFiveUsers) {
      await escrowOne.connect(user).userWithdrawAll();
    }

    const withdrawEventsTwo = await getAllContractLogsForEvent(
      escrowOne,
      "UserWithdrawAll"
    );

    //get users last rewarded token timestamp
    const usersWhoWithdrew = [...firstFiveUsers, ...nextFiveUsers].map(
      (user) => user.address
    );

    const onlyWithdrawUserEvents = rewardEvents.filter((event) =>
      usersWhoWithdrew.some((address) => address === event.args[0])
    );

    const userLastEvents = onlyWithdrawUserEvents.reduce((prev, curr) => {
      const user = curr.args[0];
      const currTimestamp = curr.args[3].toNumber();
      if (!prev[user]) prev[user] = curr;

      if (currTimestamp > prev[user].args[2].toNumber()) {
        prev[user] = curr;
      }

      return prev;
    }, {});

    expect(Object.keys(userLastEvents).length).equal(usersWhoWithdrew.length);

    //..TODO unfinished
  });
});
