import { expect } from "chai";
import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
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

let users: SignerWithAddress[] = [];
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

describe("LoyaltyProgram", async () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();

    creatorOne = accounts[1];
    relayer = accounts[2];
    users = accounts.slice(3);

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

    const statePayoutAmounts = [];

    //set program to active
    await programOne.connect(creatorOne).setLoyaltyProgramActive();

    //ensure contracts are ready to issue rewards
    const programState = await programOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(programState).equal(LoyaltyState.Active);
    expect(escrowState).equal(EscrowState.InIssuance);
  });
});
