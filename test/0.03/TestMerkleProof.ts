import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
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
import keccak256 from "keccak256";
import { getERC20UserProgress } from "../../utils/userProgressTestUtils";
import {
  calculateRootHash,
  getAppendProof,
  getUpdateProof,
} from "../../utils/merkleUtils";

//tests addition of merkle tree to Loyalty, LoyaltyProgram, with LoyaltySecurity etc.
//tests deploy with added constructor args for merkle root,
//also tests progression funcs with merkle verification (objectives, giving points, etc);

//TODO - for this to work nodes will have to be stored off-chain sadly,
//in order for proofs to work but for experimentation purposes I continue.

//TODO 5-1/5-2 - update this with merkleUtil funcs

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;

let relayer: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

let programOne: any;
let escrowOne: any;
let testToken: any;

let merkleTree: any;
let initialMerkleRoot: string = "";

describe("LoyaltyProgram", () => {
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
  });

  it("ensures loyalty program contracts still deploys successfully after adding merkleRoot as constructor arg in Loyalty/LoyaltyProgram", async () => {
    //create initial merkle root from creator address and user one address.
    //user addresses wont be able to be used for the initial root since theyre,
    //not known at the time. but this is to help verify that merkle state var is updating,
    //for testing purposes.

    const { root, tree } = createMerkleTree([
      creatorOne.address,
      userOne.address,
      userTwo.address,
    ]);

    initialMerkleRoot = root;
    merkleTree = tree;

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
    //if I decide to move forward with this merkle/signature flow,
    //i will have to figure out the best way from backend to detect when an empty array
    //needs to be passed as proof for the first iteration
    //(first time _user address interacts with the contract (through TX relayer or directly)

    //complete objective index 0, pass in an empty bytes32[] as proof since not needed yet.
    //but a signature will now be required for first iteration.
    const objectiveIndexZero = 0;
    const timestamp = await time.latest();
    const message = `${objectiveIndexZero}${timestamp}`;
    const messageHash = keccak256(message);
    const signature = await relayer.signMessage(
      hre.ethers.utils.arrayify(messageHash)
    );

    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(
        0,
        userOne.address,
        [],
        messageHash,
        signature
      );

    //ensure that after first iteration, merkle tree updated.
    const treeLengthOne = await programOne.merkleLength.call();
    expect(treeLengthOne.toNumber()).equal(1, "Incorrect - did not update");

    //root should now not match the original
    const r1 = await programOne.merkleRoot.call();
    expect(r1).to.not.equal(initialMerkleRoot, "Incorrect - root didnt update");

    const userOneMerkleIndex = await programOne.getMerkleIndex(userOne.address);
    expect(userOneMerkleIndex.toNumber()).equal(
      1,
      "Incorrect - merkle didnt append"
    );

    const badProof = merkleTree.getHexProof(keccak256(userThree.address));
    expect(badProof).to.be.empty;

    //on second iteration (_user has already interacted with contract),
    //proof is needed now to bypass signature verification (if i keep this flow w the merkle).
    //so complete second objective with merkle proof and no signature, ensure behavior is correct.
    const userOneProof = merkleTree.getHexProof(
      keccak256(userOne.address.toString())
    );
    const objectiveIndexOne = 1;

    await programOne.connect(relayer).completeUserAuthorityObjective(
      objectiveIndexOne,
      userOne.address,
      userOneProof,
      hre.ethers.constants.HashZero, //pass in hash zero since _messageHash now not needed
      "0x" //pass in empty byte since _signature is now not needed
    );

    //ensure that the contract updated data/user progress as normal.
    const { points, currentTier, userObjsComplete, balance } =
      await getERC20UserProgress(programOne, escrowOne, userOne, creatorOne);

    expect(points).equal(800, "Incorrect points");
    expect(currentTier).equal(1, "Incorrect tier");
    expect(userObjsComplete).deep.equal([true, true, false, false, false]);
    expect(balance).equal(0, "No tokens should be rewarded yet");
  });
  it("tests a different user's interactions and ensures merkle/signature functionality still processes correctly", async () => {
    //TODO
  });
  it("estimates gas for completing an objective with first iteration signature verification added", async () => {
    //TODO
  }),
    it("estimates gas for completing an objective with second iteration merkle proof verification added", async () => {
      //TODO
    });
});
