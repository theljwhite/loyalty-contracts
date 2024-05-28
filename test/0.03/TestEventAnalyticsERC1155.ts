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
    const tokenIdsToDeposit = [0, 1, 2, 3, 4];
    const amountsToDeposit = Array(5).fill(800);

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
    //...TODO continue
  });
});
