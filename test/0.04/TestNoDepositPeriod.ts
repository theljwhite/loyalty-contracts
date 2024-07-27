import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { deployLoyaltyProgram } from "../../utils/deployLoyaltyUtils";
import {
  ERC20RewardCondition,
  EscrowState,
  LoyaltyState,
  RewardType,
} from "../../constants/contractEnums";
import keccak256 from "keccak256";
import { getERC20UserProgress } from "../../utils/userProgressTestUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";

//this tests changes to escrow state/depositing.
//primary changes are to get rid of "deposit period" and allow,
//creators to deposit tokens even while the contact is InIssuance,
//so that they can continue to keep the same program active if they want to and top up on reward tokens

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

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

describe("LoyaltyProgram", async () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];

    relayer = accounts[5];
    userOne = accounts[10];
    userTwo = accounts[11];

    //deploy test ERC20 token to be used for ERC20 escrow rewards
    //transfer amount from minter to creatorOne to deposit as rewards
    testToken = await hre.ethers.deployContract("TestTokenTwo");

    const transferAmount = hre.ethers.utils.parseUnits("2.0", "ether");
    await testToken.transfer(creatorOne.address, transferAmount);

    const creatorOneInitialBal = await testToken.balanceOf(creatorOne.address);
    const creatorInitialBalEther = hre.ethers.utils.formatUnits(
      creatorOneInitialBal,
      "ether"
    );
    expect(creatorInitialBalEther).equal("2.0", "Incorrect starting bal");

    const { loyaltyContract, escrowContract } = await deployLoyaltyProgram(
      "0_03",
      RewardType.ERC20,
      true,
      creatorOne,
      testToken.address
    );

    programOne = loyaltyContract;
    escrowOne = escrowContract;
    expect(programOne.address).to.not.be.undefined;
    expect(escrowOne.address).to.not.be.undefined;

    const lpState = await programOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(lpState).equal(LoyaltyState.Idle);
    expect(escrowState).equal(EscrowState.AwaitingEscrowSettings);
  });

  it("tests new flow/sequence of events with changes made to escrow state related to depositing reward tokens", async () => {
    //set deposit key and ensure state is correct
    await escrowOne.setDepositKey(depositKeyBytes32);

    const escrowState = await escrowOne.escrowState();
    expect(escrowState).equal(EscrowState.AwaitingEscrowSettings);
  });
  it("tests new flow/sequence of events with changes made to escrow state related to depositing reward tokens and then setting escrow settings", async () => {
    //creator should now be able to deposit, required before setting escrow settings
    //with new changes, while the program is active, they should be able to deposit more reward tokens.
    //which is different from previous versions

    //deposit 0.8 tokens initially

    const depositAmount = hre.ethers.utils.parseUnits("0.8", "ether");
    const allowance = hre.ethers.utils.parseUnits("1.8", "ether");

    await testToken
      .connect(creatorOne)
      .increaseAllowance(escrowOne.address, allowance);

    await escrowOne.depositBudget(depositAmount, depositKeyBytes32);

    const contractBal = await escrowOne.escrowBalance();
    const expectedContractBal = hre.ethers.utils.formatUnits(
      contractBal,
      "ether"
    );

    expect(expectedContractBal).equal("0.8", "Incorrect bal after deposit");

    //set escrow settings to reward tokens for each objective completion.
    //ensure that state behaves as intended after changes were made to contracts.

    const payouts = ["0.01", "0.01", "0.01", "0.01", "0.02"];
    const payoutsWei = payouts.map((p) =>
      hre.ethers.utils.parseUnits(p, "ether")
    );

    await escrowOne.setEscrowSettingsAdvanced(
      ERC20RewardCondition.RewardPerObjective,
      payoutsWei
    );

    //check payout indexes with function made for testing
    const payoutIndexToAmount = [];
    for (let i = 0; i < 5; i++) {
      const amount = await escrowOne.getPayoutAmountFromIndex(i);
      payoutIndexToAmount.push(hre.ethers.utils.formatUnits(amount, "ether"));
    }

    // expect(payoutIndexToAmount).deep.equal(payouts);

    //escrow state should have now changed to Idle
    //loyalty state should still be idle too until program is made active

    const escrowState = await escrowOne.escrowState();
    const loyaltyState = await programOne.state();

    expect(escrowState).equal(EscrowState.Idle);
    expect(loyaltyState).equal(LoyaltyState.Idle);

    //deposit more reward tokens now which wouldnt be possible in old version.
    //ensure that nothing breaks.

    const depositTwo = hre.ethers.utils.parseUnits("0.2", "ether");

    await escrowOne.depositBudget(depositTwo, depositKeyBytes32);

    const contractBalTwo = await escrowOne.escrowBalance();
    const expectedContractBalTwo = hre.ethers.utils.formatUnits(
      contractBalTwo,
      "ether"
    );

    expect(expectedContractBalTwo).equal(
      "1.0",
      "Incorrect bal after second deposit"
    );

    const escrowStateFinal = await escrowOne.escrowState();
    const lpStateFinal = await programOne.state();

    expect(escrowStateFinal).equal(EscrowState.Idle);
    expect(lpStateFinal).equal(LoyaltyState.Idle);
  });
  it("tests new flow/sequence of events with changes made to escrow state, making program active and ensure tokens can now be deposited even while escrow is InIssuance", async () => {
    //set loyalty program to active, ensure both lp state and escrow state change

    await programOne.setLoyaltyProgramActive();

    const escrowState = await escrowOne.escrowState();
    const lpState = await programOne.state();

    expect(escrowState).equal(EscrowState.InIssuance, "Incorrect escrow state");
    expect(lpState).equal(LoyaltyState.Active, "Incorrect loyalty state");
  });
  it("tests new flow/sequence of events related to completing objectives, depositing tokens while still InIssuance, etc", async () => {
    //complete some objectives, ensure all balances are correct

    for (let i = 0; i < 3; i++) {
      await programOne
        .connect(relayer)
        .completeUserAuthorityObjective(i, userOne.address);

      await programOne
        .connect(relayer)
        .completeUserAuthorityObjective(i, userTwo.address);
    }

    const u1Bal = await escrowOne.lookupUserBalance(userOne.address);
    const u2Bal = await escrowOne.lookupUserBalance(userTwo.address);
    const escrowBalOne = await escrowOne.escrowBalance();

    expect(hre.ethers.utils.formatEther(u1Bal)).equal("0.03");
    expect(hre.ethers.utils.formatEther(u2Bal)).equal("0.03");
    expect(hre.ethers.utils.formatEther(escrowBalOne)).equal("0.94");

    //ensure user can withdraw and balances are still okay
    await escrowOne.connect(userOne).userWithdrawAll();

    const u1WalletBal = await testToken.balanceOf(userOne.address);
    const escrowBalTwo = await escrowOne.escrowBalance();
    const u1ContractBal = await escrowOne.lookupUserBalance(userOne.address);

    expect(hre.ethers.utils.formatEther(u1WalletBal)).equal("0.03");
    expect(hre.ethers.utils.formatEther(escrowBalTwo)).equal("0.94");
    expect(hre.ethers.utils.formatEther(u1ContractBal)).equal("0.0");

    //deposit more reward tokens while program is InInssuance
    const depositAmount = hre.ethers.utils.parseUnits("0.2", "ether");
    await escrowOne.depositBudget(depositAmount, depositKeyBytes32);

    const escrowBalThree = await escrowOne.escrowBalance();

    expect(hre.ethers.utils.formatEther(escrowBalThree)).equal("1.14");

    //actual balance of escrow contract (combined escrow bal) and user bal stored in contract
    //should be 1.17 - the 0.03 rewarded to user 2 and the escrow balance 1.14
    const escrowContractBal = await testToken.balanceOf(escrowOne.address);
    expect(hre.ethers.utils.formatEther(escrowContractBal)).equal("1.17");
  });
});
