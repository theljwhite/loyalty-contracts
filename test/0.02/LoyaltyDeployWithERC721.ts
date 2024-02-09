import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VERSION_0_02_ERC721_ESCROW,
  VERSION_0_02_LOYALTY_FACTORY,
  VERSION_0_02_LOYALTY_PROGRAM,
} from "../../constants/contractRoutes";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
  ERC721RewardCondition,
  ERC721RewardOrder,
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
import { simulateOffChainSortTokens } from "../../utils/sortTokens";

let currentTimeInSeconds: number = 0;
let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;
let depositorOne: SignerWithAddress;
let depositorTwo: SignerWithAddress;

let loyaltyProgramOne: any;
let loyaltyProgramOneAddress: string = "";
let loyaltyProgramOneEndsAt: number = 0;

let erc721EscrowOne: any;
let erc721EscrowOneAddress: string = "";

let testCollection: any;

describe("LoyaltyProgram", () => {
  before(async () => {
    currentTimeInSeconds = await time.latest();
    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];
    creatorTwo = accounts[2];
    depositorOne = accounts[3];
    depositorTwo = accounts[4];

    //deploy test ERC721 collection to be used as rewards for ERC721 escrow
    const testERC20Token = await hre.ethers.deployContract("AdajToken");
    testCollection = await hre.ethers.deployContract("TestERC721Contract", [
      "TestCollection",
      "TEST",
      testERC20Token.address,
    ]);

    await testERC20Token.transfer(creatorOne.address, 1_000_000);
    await testERC20Token
      .connect(creatorOne)
      .approve(testCollection.address, 5000);
    await testERC20Token
      .connect(creatorOne)
      .increaseAllowance(testCollection.address, 5000);

    //mint test ERC721 tokens to be used as rewards
    await testCollection.setSaleState(true);
    await testCollection.setMaxToMint(1000);
    await testCollection.connect(creatorOne).mintNoodles(200);

    const creatorOneNFTBalance = await testCollection.balanceOf(
      creatorOne.address
    );
    expect(creatorOneNFTBalance.toNumber()).equal(200);
  });

  it("ensures that a loyalty program with ERC721 rewards can still be deployed after tier handling moved directly to constructor", async () => {
    //in first contract version, tiers required an additional external call to be added.
    //this will ensure that with tier info added directly to contract constructor,
    //that the tiers are added directly with contract deploy
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
        RewardType.ERC721,
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
    expect(rewardType).equal(RewardType.ERC721, "Incorrect reward type");
    expect(objectives.length).equal(5, "Incorrect length");
  });
  it("ensures that an ERC721 escrow contract can still be deployed and set in corresponding loyalty program contract, since constructor args have changed", async () => {
    const erc721EscrowFactory = await hre.ethers.getContractFactory(
      VERSION_0_02_ERC721_ESCROW
    );
    const rewardTokenAddress = testCollection.address;
    const approvedDepositors: string[] = [
      creatorOne.address,
      depositorOne.address,
      depositorTwo.address,
    ];

    const erc721EscrowContract = await erc721EscrowFactory
      .connect(creatorOne)
      .deploy(
        loyaltyProgramOneAddress,
        creatorOne.address,
        loyaltyProgramOneEndsAt,
        rewardTokenAddress,
        approvedDepositors
      );
    erc721EscrowOne = await hre.ethers.getContractAt(
      VERSION_0_02_ERC721_ESCROW,
      erc721EscrowContract.address
    );
    erc721EscrowOneAddress = erc721EscrowContract.address;

    //ensure state vars are set from constructor
    const creator = await erc721EscrowOne.creator.call();
    const programEndDate = await erc721EscrowOne.loyaltyProgramEndsAt.call();
    const loyaltyAddress = await erc721EscrowOne.loyaltyProgramAddress.call();

    expect(creator).equal(creatorOne.address, "Incorrect");
    expect(programEndDate.toNumber()).equal(
      loyaltyProgramOneEndsAt,
      "Incorrect date"
    );
    expect(loyaltyAddress).equal(loyaltyProgramOneAddress);

    //ensure that initial escrow state and loyalty state are correct
    const initialLoyaltyState = await loyaltyProgramOne.state();
    const initialEscrowState = await erc721EscrowOne.escrowState();

    expect(initialLoyaltyState).equal(LoyaltyState.Idle, "Incorrect state");
    expect(initialEscrowState).equal(EscrowState.Idle, "Incorrect state");

    //ensure that escrow contract can be set in loyalty contract
    const setEscrow = await loyaltyProgramOne
      .connect(creatorOne)
      .setEscrowContract(erc721EscrowOneAddress, RewardType.ERC721);
    expect(setEscrow.hash).not.null;

    //ensure that reward collection and approved depositors are set now that
    //this functionality moved to the escrow contract's constructor.
    const isCreatorSenderApproved = await erc721EscrowOne.isSenderApproved(
      creatorOne.address
    );
    const isSenderApproved1 = await erc721EscrowOne.isSenderApproved(
      depositorOne.address
    );
    const isSenderApproved2 = await erc721EscrowOne.isSenderApproved(
      depositorTwo.address
    );
    const isRewardCollectionApproved =
      await erc721EscrowOne.isCollectionApproved(testCollection.address);

    expect(isCreatorSenderApproved).equal(
      true,
      "Incorrect, creator should be approved"
    );
    expect(isSenderApproved1).equal(
      true,
      "Incorrect - depositor 1 should be approved"
    );
    expect(isSenderApproved2).equal(
      true,
      "Incorrect - depositor 2 should be approved"
    );
    expect(isRewardCollectionApproved).equal(
      true,
      "Incorrect - reward collection should be approved"
    );
  });
  it("ensures that escrow state during deposit flow still works correctly after some steps were moved to constructor", async () => {
    //ensure deposit key can be set and that escrow state updates accordingly.
    //deposit period starts when deposit key is set, so escrow state should update
    const sampleDepositKey = "clscttni60000356tqrpthp7b";
    const depositKeyBytes32 =
      hre.ethers.utils.formatBytes32String(sampleDepositKey);
    const datePlusTwoDays = new Date().getTime() + TWO_DAYS_MS;
    const depositEndDate = Math.round(datePlusTwoDays / 1000);

    await erc721EscrowOne
      .connect(creatorOne)
      .setDepositKey(depositKeyBytes32, depositEndDate);

    const stateAfterDepositKeySet = await erc721EscrowOne.escrowState();
    expect(stateAfterDepositKeySet).equal(EscrowState.DepositPeriod);

    //now that deposit period is active, deposit 50 ERC721 tokens to be used as rewards
    //transfer with deposit key as bytes _data argument.
    //transfer the first 50 minted tokens (token ids 0 through 50);
    for (let i = 0; i < 50; i++) {
      await testCollection
        .connect(creatorOne)
        [
          "safeTransferFrom(address,address,uint256,bytes)"
        ](creatorOne.address, erc721EscrowOneAddress, i, depositKeyBytes32);
    }

    //ensure that state vars were updated after deposit
    const { totalTokens, name, symbol, collection } =
      await erc721EscrowOne.getBasicEscrowInfo();

    const tokenIdsState = await erc721EscrowOne
      .connect(creatorOne)
      .getEscrowTokenIds();
    const tokenIdsToNumber = tokenIdsState.map((tkn: any) => tkn.toNumber());
    const correctTokenIdShape = Array.from({ length: 50 }, (_, i) => i);

    expect(totalTokens.toNumber()).equal(
      50,
      "Incorrect token amount after deposit"
    );
    expect(name).equal("TestCollection", "Incorrect collection name");
    expect(symbol).equal("TEST", "Incorrect symbol");
    expect(collection).equal(
      testCollection.address,
      "Incorrect collection address"
    );
    expect(tokenIdsToNumber).deep.equal(
      correctTokenIdShape,
      "Incorrect token ids array"
    );

    //move time forward 3+ days so that the deposit period is ended.
    //ensure that escrow state is correct. State should not change to InIssuance...
    //...until the token ids are sorted (off-chain).
    //After deposit period is over and before sort, state should move to Idle.
    //Sorting is done when setEscrowSettings is called to customize escrow.
    //The creator chooses the reward order and sorting is done based on it.
    const blockNumBefore = await hre.ethers.provider.getBlockNumber();
    const datePlusThreeDays = new Date().getTime() + THREE_DAYS_MS;
    const movedTime = Math.round(datePlusThreeDays / 1000);

    await hre.ethers.provider.send("evm_mine", [movedTime]);

    const blockNumAfter = await hre.ethers.provider.getBlockNumber();
    const blockAfter = await hre.ethers.provider.getBlock(blockNumAfter);
    expect(blockNumAfter).to.be.greaterThan(blockNumBefore);
    expect(blockAfter.timestamp).to.be.equal(movedTime);

    const stateAfterDepositEnd = await erc721EscrowOne.escrowState();
    expect(stateAfterDepositEnd).equal(EscrowState.AwaitingEscrowSettings);

    //call escrow settings to customize escrow.
    //for this test, Ascending rewardOrder will be used. (first user who completes an objective is rewarded lowest token id);
    //after escrow settings are set, the sort tokens event is emitted and sorted off-chain.
    //once the token queue is returned to the contract, its state should change to InIssuance

    const rewardGoal = 4; //index of the objective that will reward a user a token once completed
    const setEscrowSettings = await erc721EscrowOne
      .connect(creatorOne)
      .setEscrowSettings(
        ERC721RewardOrder.Ascending,
        ERC721RewardCondition.ObjectiveCompleted,
        rewardGoal
      );
    const setEscrowSettingsReceipt = await setEscrowSettings.wait();
    const [sortTokenQueueEvent] = setEscrowSettingsReceipt.events.filter(
      (e: any) => e.event === "SortTokenQueue"
    );

    //ensure that emitted event arguments are correct
    const { creator, tokensArr, rewardOrder } = sortTokenQueueEvent.args;

    expect(creator).equal(creatorOne.address, "Incorrect event creator arg");
    expect(tokensArr.length).equal(50, "Incorrect token arr length");
    expect(rewardOrder).equal(
      ERC721RewardOrder.Ascending,
      "Incorrect reward order arg"
    );

    //ensure that state has moved to Idle since token queue is not sorted yet
    const stateAfterEscrowSettings = await erc721EscrowOne.escrowState();
    expect(stateAfterEscrowSettings).equal(
      EscrowState.Idle,
      "Incorrect - state should be Idle until sorted token queue is returned to contract"
    );

    //simulate an off-chain sorting of the token ids to account for Ascending reward order.
    //then, return the sorted token queue back to the contract.
    const returnedTokenIdsToNum = tokensArr.map((tkn: any) => tkn.toNumber());
    const sortedTokenIdsForAscending = simulateOffChainSortTokens(
      returnedTokenIdsToNum,
      rewardOrder
    );
    const correctSortedShape = Array.from({ length: 50 }, (_, i) => i).sort(
      (a, b) => b - a
    );
    expect(sortedTokenIdsForAscending).deep.equal(correctSortedShape);

    //now that the token queue is sorted for Ascending reward order, return the order to the contract.
    //ensure that tokenQueue state variable is updated correctly as well.
    const receiveTokenQueue = await erc721EscrowOne
      .connect(creatorOne)
      .receiveTokenQueue(sortedTokenIdsForAscending, depositKeyBytes32);
    const receiveTokenQueueReceipt = await receiveTokenQueue.wait();
    const [tokenQueueReceivedEvent] =
      await receiveTokenQueueReceipt.events.filter(
        (e: any) => e.event === "TokenQueueReceived"
      );
    const { sortedTokenQueue } = tokenQueueReceivedEvent.args;
    const formattedTokenQueueReturn = sortedTokenQueue.map((tkn: any) =>
      tkn.toNumber()
    );
    const sortedTokenQueueStateVar = await erc721EscrowOne
      .connect(creatorOne)
      .lookupTokenQueue();
    const tokenQueueStateVarFormatted = sortedTokenQueueStateVar.map(
      (tkn: any) => tkn.toNumber()
    );

    expect(formattedTokenQueueReturn).deep.equal(
      correctSortedShape,
      "Incorrect token queue event arg"
    );
    expect(tokenQueueStateVarFormatted).deep.equal(
      correctSortedShape,
      "Incorrect token queue state variable"
    );

    //state should still be Idle until loyalty program is set to active.
    //afterwards, it should immediately change to InIssuance
    const escrowStateAfterEscrowSettings = await erc721EscrowOne.escrowState();
    expect(escrowStateAfterEscrowSettings).equal(EscrowState.Idle, "Incorrect");

    await loyaltyProgramOne.connect(creatorOne).setLoyaltyProgramActive();
    const escrowStateAfterProgramActive = await erc721EscrowOne.escrowState();
    const loyaltyProgramStateAfterActive = await loyaltyProgramOne.state();

    expect(escrowStateAfterProgramActive).equal(
      EscrowState.InIssuance,
      "Incorrect. LP is active and token queue is sorted with escrow settings set. Should be in issuance."
    );
    expect(loyaltyProgramStateAfterActive).equal(
      LoyaltyState.Active,
      "Incorrect"
    );
  });
});
