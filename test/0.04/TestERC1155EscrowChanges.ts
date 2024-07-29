import { expect } from "chai";
import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  handleTestERC1155TokenTransfer,
} from "../../utils/deployLoyaltyUtils";
import {
  ERC1155RewardCondition,
  ERC1155EscrowState,
  LoyaltyState,
  RewardType,
} from "../../constants/contractEnums";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";

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

    userOne = accounts[6];
    userTwo = accounts[7];
    userThree = accounts[8];

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

    const { loyaltyContract, escrowContract } =
      await deployProgramAndSetUpUntilDepositPeriod(
        "0_03",
        RewardType.ERC1155,
        true,
        creatorOne,
        testCollection.address
      );

    programOne = loyaltyContract;
    escrowOne = escrowContract;
    expect(programOne.address).to.not.be.undefined;
    expect(escrowOne.address).to.not.be.undefined;
  });
  it("deposits reward tokens and sets escrow settings in order to further test any ERC1155 changes", async () => {
    //deposit reward tokens to be used for rewards
    const tokenIdsToDeposit = [0, 1, 2, 3]; //800 of each token id
    const amountsToDeposit = Array(4).fill(800);

    await testCollection
      .connect(creatorOne)
      [
        "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)"
      ](creatorOne.address, escrowOne.address, tokenIdsToDeposit, amountsToDeposit, depositKeyBytes32);

    //move time so that deposit period is finished
    await moveTime(THREE_DAYS_MS);

    const lpState1 = await programOne.state();
    const escrowState1 = await escrowOne.escrowState();

    expect(lpState1).equal(LoyaltyState.Idle);
    expect(escrowState1).equal(ERC1155EscrowState.AwaitingEscrowSettings);

    //set escrow settings to reward each objective
    const programFourTokenIdsPayout = [0, 1, 2, 3, 3]; //token ids to pay corresponding to objective indexes
    const programFourTokenAmounts = [1, 1, 2, 2, 4];
    await escrowOne
      .connect(creatorOne)
      .setEscrowSettingsAdvanced(
        ERC1155RewardCondition.EachObjective,
        programFourTokenIdsPayout,
        programFourTokenAmounts
      );

    const escrowDetail = await escrowOne.getEscrowTokenDetails();
    const escrowBal = escrowDetail.tokens.map((item: any) => ({
      id: item.id.toNumber(),
      value: item.value.toNumber(),
    }));
    const correctBal = [
      {
        id: 0,
        value: 800,
      },
      { id: 1, value: 800 },
      { id: 2, value: 800 },
      { id: 3, value: 800 },
    ];
    expect(escrowDetail.totalTokenIds.toNumber()).equal(4);
    expect(escrowBal).deep.equal(correctBal);

    //set loyalty program to active
    await programOne.connect(creatorOne).setLoyaltyProgramActive();

    const lpState2 = await programOne.state();
    const escrowState2 = await escrowOne.escrowState();

    expect(lpState2).equal(LoyaltyState.Active);
    expect(escrowState2).equal(ERC1155EscrowState.InIssuance);
  });
  it("PLACEHOLDER TEST for if I experiment with allowing ERC1155 reward deposits outside of only DepositPeriod state", async () => {
    //TODO?
  });
  it("tests frozen and canceled escrow contract states", async () => {
    //complete objectives, ensure everything is as normal
    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(0, userOne.address);
    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(0, userTwo.address);

    const u1Bal = await escrowOne.getUserRewards(userOne.address);
    const u1BalToNum = u1Bal.map((b: any) => ({
      tokenId: b.tokenId.toNumber(),
      amount: b.amount.toNumber(),
    }));

    expect(u1BalToNum).deep.equal([{ tokenId: 0, amount: 1 }]);

    //freeze only escrow -  ensure states, flows are correct.
    //user and creator should not be able to withdraw while escrow is frozen
    await escrowOne.connect(creatorOne).emergencyFreeze(true);

    const lpState1 = await programOne.state();
    const escrowState1 = await escrowOne.escrowState();

    expect(lpState1).equal(LoyaltyState.Active);
    expect(escrowState1).equal(ERC1155EscrowState.Frozen);

    const userWd = escrowOne.connect(userOne).userWithdrawAll();
    const creatorWd = escrowOne.connect(creatorOne).creatorWithdrawToken(0, 10);
    const creatorWdAll = escrowOne
      .connect(creatorOne)
      .creatorWithdrawAllBalance();

    expect(userWd).to.be.rejectedWith("FundsAreLocked()");
    expect(creatorWd).to.be.rejectedWith("MustBeCompletedOrCanceled()");
    expect(creatorWdAll).to.be.rejectedWith("MustBeCompletedOrCanceled()");

    const obj = programOne
      .connect(relayer)
      .completeUserAuthorityObjective(0, userThree.address);

    expect(obj).to.be.rejectedWith("NotInIssuance()");

    //unfreeze escrow
    await escrowOne.connect(creatorOne).emergencyFreeze(false);

    const lpState2 = await programOne.state();
    const escrowState2 = await escrowOne.escrowState();

    expect(lpState2).equal(LoyaltyState.Active);
    expect(escrowState2).equal(ERC1155EscrowState.InIssuance);

    //test canceled escrow, ensure lp still works.
    //obj calls shouldnt revert, but return early now so that lp is still tracked w/ no rewards
    //creator and user sb able to withdraw now
    await escrowOne.connect(creatorOne).cancelProgramEscrow();

    const escrowState3 = await escrowOne.escrowState();
    expect(escrowState3).equal(ERC1155EscrowState.Canceled);

    await escrowOne.connect(userOne).userWithdrawAll();

    const user2ContractBal = await escrowOne.getUserRewards(userOne.address);
    const user2WalletBal = await testCollection.balanceOf(userOne.address, 0);

    expect(user2ContractBal).deep.equal([], "Should have no contract bal now");
    expect(user2WalletBal.toNumber()).equal(1);

    //withdraw only token id 3's as creator (all 800)
    await escrowOne.connect(creatorOne).creatorWithdrawToken(3, 800);

    const escrowTokens1: { id: number; value: number }[] = [];

    for (let tokenId = 0; tokenId < 4; tokenId++) {
      const balance = await escrowOne.getEscrowTokenBalance(tokenId);
      escrowTokens1.push({ id: tokenId, value: balance.toNumber() });
    }
    expect(escrowTokens1).deep.equal([
      {
        id: 0,
        value: 797,
      },
      { id: 1, value: 800 },
      { id: 2, value: 800 },
      { id: 3, value: 0 },
    ]);

    //withdraw the remaining balance as creator
    await escrowOne.connect(creatorOne).creatorWithdrawAllBalance();

    const escrowTokens2: { id: number; value: number }[] = [];

    for (let tokenId = 0; tokenId < 4; tokenId++) {
      const balance = await escrowOne.getEscrowTokenBalance(tokenId);
      escrowTokens2.push({ id: tokenId, value: balance.toNumber() });
    }

    expect(escrowTokens2).deep.equal(
      Array.from({ length: 4 }, (_, i) => ({ id: i, value: 0 })),
      "All balances should now be 0"
    );
  });
});
