import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  estimateGasDeploy,
} from "../../utils/deployLoyaltyUtils";
import {
  ERC20RewardCondition,
  EscrowState,
  LoyaltyState,
  RewardType,
} from "../../constants/contractEnums";
import keccak256 from "keccak256";
import { getERC20UserProgress } from "../../utils/userProgressTestUtils";
import {
  calculateRootHash,
  getAppendProof,
  getUpdateProof,
} from "../../utils/merkleUtils";

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;

let relayer: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

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
    userThree = accounts[12];

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
      await escrowOne.connect(creatorOne).depositBudget(depositAmountOne);

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
    await escrowTwo.connect(creatorTwo).depositBudget(depositAmountTwo);

    const escrowBalTwo = await escrowTwo.escrowBalance.call();
    const escrowBalTwoFormatted = hre.ethers.utils.formatUnits(escrowBalTwo, 6);
    expect(escrowBalTwoFormatted).equal("100000000.0");
  });
});
