import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import { deployProgramAndSetUpUntilDepositPeriod } from "../../utils/deployLoyaltyUtils";
import {
  ERC20RewardCondition,
  EscrowState,
  LoyaltyState,
  RewardType,
} from "../../constants/contractEnums";
import keccak256 from "keccak256";
import {
  calculateRootHash,
  getAppendProof,
  getUpdateProof,
} from "../../utils/merkleUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;

let relayer: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;

let programOne: any;
let escrowOne: any;
let programTwo: any;
let escrowTwo: any;

let testToken: any;
let testTokenTwo: any;

const treeAddresses: string[] = [];
let initialMerkleRoot: string = "";

//tests experimentation/changes to Loyalty ERC20 Escrow's handling of units

describe("LoyaltyProgram", async () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];
    creatorTwo = accounts[2];

    relayer = accounts[5];
    userOne = accounts[10];
    userTwo = accounts[11];

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

    //deploy a second test token to be used for ERC20 escrow rewards, with a different...
    //...decimal value of 6, differing from the commonly used 18.
    //tokens for CoffeeToken are represented by 1/1,000,000th of a COFE token.
    //so in order to send 200 tokens, specify value as 200,000,000
    testTokenTwo = await hre.ethers.deployContract("CoffeeToken");
    const testTokenTwoDecimals = await testTokenTwo.decimals.call();
    expect(testTokenTwoDecimals).equal(6, "Incorrect decimals");

    const transferTwoAmount = hre.ethers.utils.parseUnits(
      "200000000",
      testTokenTwoDecimals
    );
    await testTokenTwo.transfer(creatorTwo.address, transferTwoAmount);

    const creatorTwoInitialBal = await testTokenTwo.balanceOf(
      creatorTwo.address
    );
    const creatorTwoInitialBalEther = hre.ethers.utils.formatUnits(
      creatorTwoInitialBal,
      testTokenTwoDecimals
    );
    expect(creatorTwoInitialBalEther).equal(
      "200000000.0",
      "Incorrect starting bal"
    );

    //deploy a second loyalty program with ERC20 escrow rewqards
    const {
      loyaltyContract: loyaltyContractTwo,
      escrowContract: escrowContractTwo,
    } = await deployProgramAndSetUpUntilDepositPeriod(
      "0_03",
      RewardType.ERC20,
      true,
      creatorTwo,
      testTokenTwo.address,
      initialMerkleRoot
    );

    programTwo = loyaltyContractTwo;
    escrowTwo = escrowContractTwo;

    expect(programTwo.address).to.not.be.undefined;
    expect(escrowTwo.address).to.not.be.undefined;
  });
  it("tests new state variables added to LoyaltyERC20Escrow and ensures they were set properly with their addition to constructor", async () => {
    const rewardTokenAddress = await escrowOne.rewardTokenAddress.call();
    const testTokenDecimals = await testToken.decimals();

    expect(rewardTokenAddress).equal(testToken.address, "Incorrect");
    expect(testTokenDecimals).equal(18, "Incorrect");
  }),
    it("tests depositing of ERC20 tokens into escrow after changes to depositBudget", async () => {
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
  it("tests depositing of ERC20 tokens into escrow and managing ERC20 tokens that dont have standard 18 decimals", async () => {
    //for escrow 2, its reward contract, 1 token represents 1/1,000,000th of a token
    //so to transfer 100, specify the value as 100,000,000
    //because its decimals differ from standard 18 and is set to 6.

    const depositAmountTwo = hre.ethers.utils.parseUnits("100000000", 6);
    await testTokenTwo
      .connect(creatorTwo)
      .increaseAllowance(escrowTwo.address, depositAmountTwo);
    await escrowTwo
      .connect(creatorTwo)
      .depositBudget(depositAmountTwo, depositKeyBytes32);

    const escrowBalTwo = await escrowTwo.escrowBalance.call();
    const escrowBalTwoFormatted = hre.ethers.utils.formatUnits(escrowBalTwo, 6);
    expect(escrowBalTwoFormatted).equal("100000000.0");
  });
  it("ensures contract state balances are correct and ensures correct handling of amounts", async () => {
    //ensure escrow balance for both programs is correct
    const escrowOneBal = await escrowOne.lookupEscrowBalance();
    const escrowTwoBal = await escrowTwo.lookupEscrowBalance();

    const escrowOneBalWeiToEth = hre.ethers.utils.formatUnits(
      escrowOneBal,
      "ether"
    );
    const escrowTwoBalWeiToContractDecimals = hre.ethers.utils.formatUnits(
      escrowTwoBal,
      6
    );

    expect(escrowOneBalWeiToEth).equal(
      "0.6",
      "Incorrect escrow 1 bal after deposit"
    );
    expect(escrowTwoBalWeiToContractDecimals).equal(
      "100000000.0",
      "Incorrect escrow bal 2 after deposit"
    );
  });
  it("ensures amounts/payout amounts are handled correctly in escrow settings for a rewards contract with non-standard decimals", async () => {
    //move time forward so deposit periods are over
    await moveTime(THREE_DAYS_MS);

    //set escrow settings for program two
    //reward tokens for all 5 of the second program's objectives.
    //1 token for each objective
    const payoutAmounts = Array(5).fill(
      hre.ethers.utils.parseUnits("1000000", 6)
    );

    await escrowTwo
      .connect(creatorTwo)
      .setEscrowSettingsAdvanced(
        ERC20RewardCondition.RewardPerObjective,
        payoutAmounts
      );

    //ensure amounts were handled correctly for each objective
    const statePayoutAmounts = [];
    for (let i = 0; i < 5; i++) {
      const amount = await escrowTwo
        .connect(creatorTwo)
        .getPayoutAmountFromIndex(i);
      statePayoutAmounts.push(amount);
    }
    const correctPayoutShape = Array(5).fill("1000000.0");
    const formattedStatePayoutAmounts = statePayoutAmounts.map((amount) =>
      hre.ethers.utils.formatUnits(amount, 6)
    );
    expect(formattedStatePayoutAmounts).deep.equal(correctPayoutShape);
  });
  it("ensures amounts/payout amounts are handled correctly in escrow settings for a rewards contract of standard 18 decimals w/ sending smaller values", async () => {
    //reward tokens for all 5 of the first program's objectives.
    //reward 0.0002 tokens for each objective
    const payoutAmounts = Array(5).fill(
      hre.ethers.utils.parseUnits("0.0002", "ether")
    );

    await escrowOne
      .connect(creatorOne)
      .setEscrowSettingsAdvanced(
        ERC20RewardCondition.RewardPerObjective,
        payoutAmounts
      );

    const statePayoutAmounts = [];

    for (let i = 0; i < 5; i++) {
      const amount = await escrowOne
        .connect(creatorOne)
        .getPayoutAmountFromIndex(i);
      statePayoutAmounts.push(amount);
    }

    const correctPayoutShape = Array(5).fill("0.0002");
    const formattedStatePayoutAmounts = statePayoutAmounts.map((amount) =>
      hre.ethers.utils.formatUnits(amount, "ether")
    );

    expect(formattedStatePayoutAmounts).deep.equal(correctPayoutShape);
  });
  it("ensures proper user balance behavior still happens when a rewards contract has standard decimals", async () => {
    //set program to active
    await programOne.connect(creatorOne).setLoyaltyProgramActive();

    const programOneState = await programOne.state();
    const escrowOneState = await escrowOne.escrowState();

    expect(programOneState).equal(LoyaltyState.Active, "Incorrect");
    expect(escrowOneState).equal(EscrowState.InIssuance, "Incorrect");

    //complete 2 objectives as userOne for programOne
    //use merkle root flow for now altho may be temporary
    const objectiveIndexZero = 0;
    const timestamp = await time.latest();
    const message = `${objectiveIndexZero}${timestamp}`;
    const messageHash = keccak256(message);
    const signature = await relayer.signMessage(
      hre.ethers.utils.arrayify(messageHash)
    );

    const appendProof = getAppendProof(treeAddresses);
    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(
        0,
        userOne.address,
        appendProof,
        messageHash,
        signature
      );

    treeAddresses.push(userOne.address);
    calculateRootHash(treeAddresses);

    const contractMerkleIndex = await programOne.getMerkleIndex(
      userOne.address
    );
    const userOneMerkleIndex = contractMerkleIndex.toNumber();
    const userOneProof = getUpdateProof(treeAddresses, userOneMerkleIndex);
    const objectiveIndexOne = 1;

    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(
        objectiveIndexOne,
        userOne.address,
        userOneProof,
        hre.ethers.constants.HashZero,
        "0x"
      );

    //0.0002 tokens are rewarded per objective in programOne
    //ensure escrow balance decreased from rewarding both objectives.
    //original deposit was 0.6 and 2 objectives were completed for 0.0002 tokens each
    const escrowBalance = await escrowOne.lookupEscrowBalance();
    const formattedEscrowBal = hre.ethers.utils.formatUnits(
      escrowBalance,
      "ether"
    );
    expect(formattedEscrowBal).equal("0.5996", "Incorrect escrow balance");

    //ensure user balance increased from rewarding both objectives.
    //user balance should now be 0.0004 tokens, 0.0002 for each objective completed
    const userBalance = await escrowOne
      .connect(creatorOne)
      .lookupUserBalance(userOne.address);
    const formattedUserBal = hre.ethers.utils.formatUnits(userBalance, "ether");

    expect(formattedUserBal).equal("0.0004", "Incorrect user balance");

    //withdraw tokens as userOne, ensure handling is still correct
    const initialUserWalletBalance = await testToken.balanceOf(userOne.address);
    expect(initialUserWalletBalance.toNumber()).equal(0, "Incorrect");

    //first, withdraw with userWithdraw() and withdraw only 0.0001.
    //ensure user balance in contract decreased and wallet balanace increased
    const withdrawAmountOne = hre.ethers.utils.parseUnits("0.0001", "ether");
    await escrowOne.connect(userOne).userWithdraw(withdrawAmountOne);

    const userContractBalOne = await escrowOne
      .connect(creatorOne)
      .lookupUserBalance(userOne.address);
    const formattedUserContractBal = hre.ethers.utils.formatUnits(
      userContractBalOne,
      "ether"
    );

    expect(formattedUserContractBal).equal(
      "0.0003",
      "Incorrect contract bal after 1st withdraw"
    );

    //withdraw remaining balance as userOne with userWithdrawAll()
    await escrowOne.connect(userOne).userWithdrawAll();

    const finalUserOneContractBal = await escrowOne
      .connect(creatorOne)
      .lookupUserBalance(userOne.address);

    expect(finalUserOneContractBal.toNumber()).equal(
      0,
      "Should have no remaining bal"
    );

    //ensure userOne's wallet balance is correct
    const finalUserWalletBal = await testToken.balanceOf(userOne.address);
    const formattedFinalUserWalletBal = hre.ethers.utils.formatUnits(
      finalUserWalletBal,
      "ether"
    );

    expect(formattedFinalUserWalletBal).equal(
      "0.0004",
      "Incorrect user one wallet bal"
    );
  });
  it("ensures proper user balance behavior still happens when a rewards contract does not have standard decimals", async () => {
    await programTwo.connect(creatorTwo).setLoyaltyProgramActive();

    const programTwoState = await programTwo.state();
    const escrowTwoState = await escrowTwo.escrowState();

    expect(programTwoState).equal(LoyaltyState.Active, "Incorrect");
    expect(escrowTwoState).equal(EscrowState.InIssuance, "Incorrect");

    //complete 2 objectives as userTwo for programTwo
    //use merkle root flow for now altho may be temporary

    const objectiveIndexZero = 0;
    const timestamp = await time.latest();
    const message = `${objectiveIndexZero}${timestamp}`;
    const messageHash = keccak256(message);
    const signature = await relayer.signMessage(
      hre.ethers.utils.arrayify(messageHash)
    );

    const appendProof = getAppendProof(treeAddresses);
    await programTwo
      .connect(relayer)
      .completeUserAuthorityObjective(
        0,
        userTwo.address,
        appendProof,
        messageHash,
        signature
      );

    treeAddresses.push(userTwo.address);
    calculateRootHash(treeAddresses);

    const contractMerkleIndex = await programTwo.getMerkleIndex(
      userTwo.address
    );
    const userTwoMerkleIndex = contractMerkleIndex.toNumber();
    const userTwoProof = getUpdateProof(treeAddresses, userTwoMerkleIndex);
    const objectiveIndexOne = 1;

    await programTwo
      .connect(relayer)
      .completeUserAuthorityObjective(
        objectiveIndexOne,
        userTwo.address,
        userTwoProof,
        hre.ethers.constants.HashZero,
        "0x"
      );

    //1 token (represented as 1000000) rewarded per objective in programOne
    //ensure escrow balance decreased from rewarding both objectives.
    //original deposit was 100 (100000000) and 2 objectives were completed for 1 tokens each
    const escrowBalance = await escrowTwo.lookupEscrowBalance();
    const formattedEscrowBal = hre.ethers.utils.formatUnits(escrowBalance, 6);

    expect(formattedEscrowBal).equal("98000000.0", "Incorrect");

    //withdraw tokens as userTwo, ensure handling is still correct
    const initialUserWalletBalance = await testTokenTwo.balanceOf(
      userTwo.address
    );
    expect(initialUserWalletBalance.toNumber()).equal(0, "Incorrect");

    //first, withdraw with userWithdraw() and withdraw only 1 token
    //ensure user balance is contract decreased and wallet balance increased
    const withdrawAmountOne = hre.ethers.utils.parseUnits("1000000", 6);
    await escrowTwo.connect(userTwo).userWithdraw(withdrawAmountOne);

    const userContractBalOne = await escrowTwo
      .connect(creatorTwo)
      .lookupUserBalance(userTwo.address);
    const formattedUserContractBal = hre.ethers.utils.formatUnits(
      userContractBalOne,
      6
    );

    expect(formattedUserContractBal).equal(
      "1000000.0",
      "Incorrect contract bal after 1st withdraw "
    );

    //withdraw remaining balance with userWtihdrawAll();
    await escrowTwo.connect(userTwo).userWithdrawAll();

    const finalUserTwoContractBal = await escrowTwo
      .connect(creatorTwo)
      .lookupUserBalance(userTwo.address);

    expect(finalUserTwoContractBal.toNumber()).equal(
      0,
      "Should have no remaining bal"
    );

    //ensure userTwo's wallet balance is correct
    const finalUserWalletBal = await testTokenTwo.balanceOf(userTwo.address);
    const formattedFinalUserWalletBal = hre.ethers.utils.formatUnits(
      finalUserWalletBal,
      6
    );

    expect(formattedFinalUserWalletBal).equal(
      "2000000.0",
      "Incorrect user two wallet bal"
    );
  });
});
