import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  handleTestERC721DeployMintAndTransfer,
} from "../../utils/deployLoyaltyUtils";
import {
  ERC721EscrowState,
  ERC721RewardCondition,
  ERC721RewardOrder,
  LoyaltyState,
  RewardType,
} from "../../constants/contractEnums";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";
import { simulateOffChainSortTokens } from "../../utils/sortTokens";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";

//tests small changes to ERC721 escrow.
//since it is a little different than ERC20 and ERC1155 escrow,
//DepositPeriod will remain the same in this contract.
//this mostly tests frozen/canceled states and ensures depositing and withdrawing,
//is still okay.

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

let relayer: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

let programOne: any;
let escrowOne: any;

let testCollection: any;

describe("LoyaltyProgram", async () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];

    relayer = accounts[5];
    userOne = accounts[10];
    userTwo = accounts[11];
    userThree = accounts[12];

    //deploy test ERC721 to be used as ERC721 escrow rewards
    const { balance, testERC721Contract } =
      await handleTestERC721DeployMintAndTransfer(200, creatorOne);

    const { loyaltyContract, escrowContract } =
      await deployProgramAndSetUpUntilDepositPeriod(
        "0_03",
        RewardType.ERC721,
        true,
        creatorOne,
        testERC721Contract.address
      );

    programOne = loyaltyContract;
    escrowOne = escrowContract;
    testCollection = testERC721Contract;

    expect(programOne.address).to.not.be.undefined;
    expect(escrowOne.address).to.not.be.undefined;

    const lpState = await programOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(lpState).equal(LoyaltyState.Idle);
    expect(escrowState).equal(ERC721EscrowState.DepositPeriod);
  });
  it("deposits tokens, sets escrow settings in order to further test changes", async () => {
    for (let i = 0; i < 50; i++) {
      await testCollection
        .connect(creatorOne)
        [
          "safeTransferFrom(address,address,uint256,bytes)"
        ](creatorOne.address, escrowOne.address, i, depositKeyBytes32);
    }

    //ensure that state vars were updated after deposit
    const { totalTokens } = await escrowOne.getBasicEscrowInfo();

    expect(totalTokens.toNumber()).equal(
      50,
      "Incorrect token amount after deposit"
    );

    await moveTime(THREE_DAYS_MS);

    const lpState1 = await programOne.state();
    const escrowState1 = await escrowOne.escrowState();

    expect(lpState1).equal(LoyaltyState.Idle);
    expect(escrowState1).equal(ERC721EscrowState.AwaitingEscrowSettings);

    //set escrow settings to reward a token in ascending order,
    //when objective index 4 is completed by a user
    const rewardGoal = 4; //index of the objective that will reward a user a token once completed
    const setEscrowSettings = await escrowOne
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
    const stateAfterEscrowSettings = await escrowOne.escrowState();
    expect(stateAfterEscrowSettings).equal(ERC721EscrowState.Idle);

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
    const receiveTokenQueue = await escrowOne
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
    const sortedTokenQueueStateVar = await escrowOne
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
    const escrowStateAfterEscrowSettings = await escrowOne.escrowState();
    expect(escrowStateAfterEscrowSettings).equal(
      ERC721EscrowState.Idle,
      "Incorrect"
    );

    await programOne.connect(creatorOne).setLoyaltyProgramActive();
    const escrowStateAfterProgramActive = await escrowOne.escrowState();
    const loyaltyProgramStateAfterActive = await programOne.state();

    expect(escrowStateAfterProgramActive).equal(
      ERC721EscrowState.InIssuance,
      "Incorrect. LP is active and token queue is sorted with escrow settings set. Should be in issuance."
    );
    expect(loyaltyProgramStateAfterActive).equal(
      LoyaltyState.Active,
      "Incorrect"
    );
  });
  it("completes objectives, tests frozen states", async () => {
    //obj 4 will reward a token to user one and user two
    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(4, userOne.address);

    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(4, userTwo.address);

    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(0, userThree.address);

    const userOneAccount = await escrowOne
      .connect(creatorOne)
      .getUserAccount(userOne.address);
    const userOneBal = userOneAccount.map((b: any) => b.toNumber());

    expect(userOneBal).deep.equal(
      [0],
      "Incorrect, shouldve been rewarded first token #0"
    );

    //ensure as the program is active and in issuance, user one can withdraw,
    //their rewards.
    await escrowOne.connect(userOne).userWithdrawAll();

    const userOneAccount2 = await escrowOne
      .connect(creatorOne)
      .getUserAccount(userOne.address);

    expect(userOneAccount2).deep.equal(
      [],
      "Should now have no user one balance in contract"
    );

    const userOneWalletBal = await testCollection.balanceOf(userOne.address);

    expect(userOneWalletBal.toNumber()).equal(
      1,
      "User one should have 1 token in their wallet now"
    );

    //freeze escrow contract and ensure that user cant withdraw,
    //and that completing obj's doesnt reward a token
    await escrowOne.connect(creatorOne).emergencyFreeze(true);

    const lpState = await programOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(lpState).equal(LoyaltyState.Active);
    expect(escrowState).equal(ERC721EscrowState.Frozen);

    const obj = programOne
      .connect(relayer)
      .completeUserAuthorityObjective(2, userOne.address);

    expect(obj).to.be.rejectedWith("NotInUssuance()");

    const userWd = escrowOne.connect(userTwo).userWithdrawAll();
    const creatorWd = escrowOne.connect(creatorOne).creatorWithdrawAll();

    expect(userWd).to.be.rejectedWith("FundsAreLocked()");
    expect(creatorWd).to.be.rejectedWith("MustBeActiveOrCompleted()");

    //unfreeze escrow contract and ensure it behaves correctly as normal

    await escrowOne.connect(creatorOne).emergencyFreeze(false);

    const lpState2 = await programOne.state();
    const escrowState2 = await escrowOne.escrowState();

    expect(lpState2).equal(LoyaltyState.Active);
    expect(escrowState2).equal(ERC721EscrowState.InIssuance);

    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(3, userThree.address);

    const userThreeProg = await programOne.getUserCompletedObjectives(
      userThree.address
    );

    expect(userThreeProg).deep.equal([true, false, false, true, false]);
  });
  it("tests cancelled state for LP and ERC721 escrow", async () => {
    //first cancel only escrow, ensure LP still behaves normally

    await escrowOne.connect(creatorOne).cancelProgramEscrow();

    const escrowState1 = await escrowOne.escrowState();

    expect(escrowState1).equal(ERC721EscrowState.Canceled);

    //complete another objective as user three and ensure LP progress is still tracked
    await programOne
      .connect(creatorOne)
      .completeCreatorAuthorityObjective(4, userThree.address);

    const userThreeProg = await programOne.getUserCompletedObjectives(
      userThree.address
    );

    expect(userThreeProg).deep.equal([true, false, false, true, true]);

    //ensure both user and creator can withdraw tokens with a canceled escrow
    await escrowOne.connect(userTwo).userWithdrawAll();

    const userTwoContractBal = await escrowOne
      .connect(creatorOne)
      .getUserAccount(userTwo.address);

    const userTwoWalletBal = await testCollection.balanceOf(userTwo.address);

    expect(userTwoContractBal).deep.equal([], "Should now be empty");
    expect(userTwoWalletBal.toNumber()).equal(
      1,
      "Should have one token in wallet"
    );

    await escrowOne.connect(creatorOne).creatorWithdrawAll();

    const escrowTokens = await escrowOne.connect(creatorOne).lookupTokenQueue();
    const escrowTokensArr = escrowTokens.map((t: any) => t.toNumber());
    const correctEscrowShape = Array(48).fill(0);

    //should now be an array of 48 with a token id value of 0
    //due to how solidity handles deleting array indexes
    expect(escrowTokensArr).deep.equal(correctEscrowShape);
  });
});
