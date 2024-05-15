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

let relayer: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

let programOne: any;
let escrowOne: any;
let testToken: any;

const treeAddresses: string[] = [];
let initialMerkleRoot: string = "";

//tests experimentation/changes to Loyalty ERC20 Escrow's handling of units

describe("LoyaltyProgram", async () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];
    relayer = accounts[5];
    userOne = accounts[10];
    userTwo = accounts[11];
    userThree = accounts[12];

    //deploy test ERC20 token to be used for ERC20 escrow rewards
    testToken = await hre.ethers.deployContract("AdajToken");
    await testToken.transfer(creatorOne.address, 1_000_000);

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
  });
  it("tests new state variables added to LoyaltyERC20Escrow and ensures they were set properly with their addition to constructor", async () => {
    const rewardTokenAddress = await escrowOne.rewardTokenAddress.call();
    const rewardTokenDecimals = await escrowOne.rewardTokenDecimals.call();

    expect(rewardTokenAddress).equal(testToken.address, "Incorrect");
    expect(rewardTokenDecimals.toNumber()).equal(18, "Incorrect");
  }),
    it("deposits test tokens, sets escrow settings, etc so that units can be tested more", async () => {
      //TODO
    });
});
