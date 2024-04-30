import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ONE_MONTH_SECONDS, THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import {
  createMerkleTree,
  deployProgramAndSetUpUntilDepositPeriod,
  estimateGasDeploy,
} from "../../utils/deployLoyaltyUtils";
import {
  ERC20RewardCondition,
  EscrowState,
  LoyaltyState,
  RewardType,
} from "../../constants/contractEnums";

//tests addition of merkle tree to Loyalty, LoyaltyProgram, with LoyaltySecurity etc.
//tests deploy with added constructor args for merkle root,
//also tests progression funcs with merkle verification (objectives, giving points, etc);

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

let relayer: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;

let programOne: any;
let escrowOne: any;
let testToken: any;

let initialMerkleRoot: string = "";

describe("LoyaltyProgram", () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];
    relayer = accounts[5];
    userOne = accounts[10];
    userTwo = accounts[11];

    //deploy test ERC20 token to be used for ERC20 escrow rewards
    testToken = await hre.ethers.deployContract("AdajToken");
    await testToken.transfer(creatorOne.address, 1_000_000);
  });

  it("ensures loyalty program contracts still deploys successfully after adding merkleRoot as constructor arg in Loyalty/LoyaltyProgram", async () => {
    //create initial merkle root from creator address
    initialMerkleRoot = createMerkleTree(creatorOne.address);

    //deploy loyalty program contract with escrow contract.
    //ensure that deploy is okay with newly added constructor arg.
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
  it("ensures that new merkleRoot state variable and merkleLength state variable were correctly updated after contract deployment", async () => {
    const merkleRootState = await programOne.merkleRoot.call();
    const merkleRootLengthState = await programOne.merkleLength.call();

    expect(merkleRootState).equal(
      initialMerkleRoot,
      "Incorrect merkleRoot state var"
    );
    expect(merkleRootLengthState.toNumber()).equal(
      0,
      "Incorrect initial length"
    );
  });
  it("estimates gas for LP contract with ERC20 escrow deploy with new LoyaltySecurity.sol, Merkle functionality being added", async () => {
    const estimates = await estimateGasDeploy(
      "0_03",
      RewardType.ERC20,
      true,
      creatorOne,
      programOne.address,
      testToken.address,
      initialMerkleRoot
    );
    const loyaltyGas = parseFloat(estimates?.loyaltyGasEth);
    const escrowGas = parseFloat(estimates?.escrowGasEth);
    const combinedCost = loyaltyGas + escrowGas;

    expect(loyaltyGas).to.be.lessThan(0.005); //0.00372366735902979 ETH
    expect(escrowGas).to.be.lessThan(0.005); //0.003746936996194952 ETH
    expect(combinedCost).to.be.lessThan(0.01); //0.007470604355224742 ETH
  });
  it("deposits test tokens, sets escrow settings, etc, so that progression funcs can be tested with merkle protection", async () => {
    const depositAmount = 500;

    await testToken
      .connect(creatorOne)
      .increaseAllowance(escrowOne.address, depositAmount);
    await escrowOne
      .connect(creatorOne)
      .depositBudget(depositAmount, testToken.address);

    //end the deposit period
    await moveTime(THREE_DAYS_MS);

    //set escrow settings
    const rewardAmount = 4;
    const rewardGoal = 2;

    await escrowOne
      .connect(creatorOne)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.SingleTier,
        rewardGoal,
        rewardAmount
      );

    //set program to active
    await programOne.connect(creatorOne).setLoyaltyProgramActive();

    //ensure contract states correct
    const loyaltyState = await programOne.connect(creatorOne).state();
    const escrowState = await escrowOne.connect(creatorOne).escrowState();
    expect(loyaltyState).equal(LoyaltyState.Active);
    expect(escrowState).equal(EscrowState.InIssuance);
  });

  it("tests merkle interaction, verifying addresses when calling a user progression func (complete objective, give points)", async () => {
    //TODO - finish
    //complete an objective as normal, see if merkle root updates and verifies
  });
});
