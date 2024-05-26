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
import { calculateRootHash } from "../../utils/merkleUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

let relayer: SignerWithAddress;

let users: SignerWithAddress[] = [];

let programOne: any;
let escrowOne: any;

let testToken: any;

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

    //set program to active
    await programOne.connect(creatorOne).setLoyaltyProgramActive();

    //ensure contracts are ready to issue rewards
    const programState = await programOne.state();
    const escrowState = await escrowOne.escrowState();

    expect(programState).equal(LoyaltyState.Active);
    expect(escrowState).equal(EscrowState.InIssuance);
  });
  it("completes objectives/gives points to a variety of users and ensures events are still functioning properly", async () => {
    //complete objective index 0 for each of the 17 user accounts.
    //for simplicity, merkle root experimentative flow is commented out.
    //and also signature verification is disabled, since those arent important for the scope of this test
    for (const user of users) {
      await programOne
        .connect(relayer)
        .completeUserAuthorityObjective(0, user.address);
    }

    //retrieve events emitted for each objective completion
    const firstEvents = await hre.ethers.provider.getLogs({
      fromBlock: "0",
      toBlock: "latest",
      address: programOne.address,
    });
    //...TODO continue
  });
});
