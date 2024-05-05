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

//tests addition of "dynamic merkle tree" to Loyalty, LoyaltyProgram, with LoyaltySecurity etc.
//tests deploy with added constructor args for merkle root,
//also tests progression funcs with merkle verification (objectives, giving points, etc);

//for this to work nodes will have to be stored off-chain sadly,
//in order for proofs to work but for experimentation purposes I continue.
//prob isnt that scalable though haha.
//tests need to be ran for only requiring a signature without merkle, may b more practical

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
    initialMerkleRoot = calculateRootHash(treeAddresses);

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
    //signature required any time appending to on chain merkle
    const objectiveIndexZero = 0;
    const timestamp = await time.latest();
    const message = `${objectiveIndexZero}${timestamp}`;
    const messageHash = keccak256(message);
    const signature = await relayer.signMessage(
      hre.ethers.utils.arrayify(messageHash)
    );

    //get proof off-chain
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

    //ensure that after first iteration, merkle tree in contract updated.
    const newOnChainRoot = await programOne.merkleRoot.call();
    const treeLengthOne = await programOne.merkleLength.call();

    treeAddresses.push(userOne.address);
    const newOffChainRoot = calculateRootHash(treeAddresses);

    expect(newOnChainRoot).to.not.equal(
      initialMerkleRoot,
      "Incorrect - root didnt update"
    );
    expect(newOnChainRoot).equal(
      newOffChainRoot,
      "Incorrect - roots dont match"
    );
    expect(treeLengthOne.toNumber()).equal(1, "Incorrect - did not update");

    const contractMerkleIndex = await programOne.getMerkleIndex(
      userOne.address
    );
    const userOneMerkleIndex = contractMerkleIndex.toNumber();
    expect(userOneMerkleIndex).equal(1, "Incorrect - merkle didnt append");

    const badProof = getUpdateProof([userThree.address], 0);
    expect(badProof).to.be.empty;

    //on second iteration (contract has already seen _user address),
    //proof is needed now to bypass signature verification (if i keep this flow w the merkle).
    //so complete second objective with merkle proof and no signature, ensure behavior is correct.
    const userOneProof = getUpdateProof(treeAddresses, userOneMerkleIndex);
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
    //for first iteration for userTwo, signature will be required again
    const objectiveIndexZero = 0;
    const timestamp = await time.latest();
    const message = `${objectiveIndexZero}${timestamp}`;
    const messageHash = keccak256(message);
    const signature = await relayer.signMessage(
      hre.ethers.utils.arrayify(messageHash)
    );
    const userTwoProof = getAppendProof(treeAddresses);

    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(
        0,
        userTwo.address,
        userTwoProof,
        messageHash,
        signature
      );

    treeAddresses.push(userTwo.address);

    //ensure off-chain and on-chain merkle roots match after 2nd address added
    const newOffChainRoot = calculateRootHash(treeAddresses);
    const newOnChainRoot = await programOne.merkleRoot.call();

    expect(newOnChainRoot).equal(
      newOffChainRoot,
      "Incorrect - roots dont match"
    );

    //complete another objective for user 2, ensure correctness for entire flow
    const userTwoUpdateProof = getUpdateProof(treeAddresses, 1);

    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(
        1,
        userTwo.address,
        userTwoUpdateProof,
        hre.ethers.constants.HashZero,
        "0x"
      );

    //ensure loyalty data updated as normal
    const prog = await getERC20UserProgress(
      programOne,
      escrowOne,
      userTwo,
      creatorOne
    );
    expect(prog.points).equal(800, "Incorrect");
  });
  it("estimates gas for completing an objective with first iteration signature verification added", async () => {
    const objectiveIndexThree = 3;
    const timestamp = await time.latest();
    const message = `${objectiveIndexThree}${timestamp}`;
    const messageHash = keccak256(message);
    const signature = await relayer.signMessage(
      hre.ethers.utils.arrayify(messageHash)
    );
    const userThreeAppendProof = getAppendProof(treeAddresses);

    const gasPrice = await hre.ethers.provider.getGasPrice();
    const txWithSignature = await programOne
      .connect(relayer)
      .estimateGas.completeUserAuthorityObjective(
        objectiveIndexThree,
        userThree.address,
        userThreeAppendProof,
        messageHash,
        signature
      );
    const cost = gasPrice.mul(txWithSignature);
    const costInEth = parseFloat(hre.ethers.utils.formatUnits(cost, "ether"));

    expect(costInEth).to.be.lessThan(0.0003);

    //actually send the tx through instead of estimating gas
    await programOne
      .connect(relayer)
      .completeUserAuthorityObjective(
        objectiveIndexThree,
        userThree.address,
        userThreeAppendProof,
        messageHash,
        signature
      );

    //ensure off-chain and on-chain merkle roots match after 3rd address added
    treeAddresses.push(userThree.address);
    const newOffChainRoot = calculateRootHash(treeAddresses);
    const newOnChainRoot = await programOne.merkleRoot.call();

    expect(newOnChainRoot).equal(
      newOffChainRoot,
      "Incorrect - roots dont match"
    );
  }),
    it("estimates gas for completing an objective with second iteration merkle proof verification added", async () => {
      //estimate gas for when a signature isnt needed but merkle proof is needed

      const userThreeUpdateProof = getUpdateProof(treeAddresses, 2);
      const gasPrice = await hre.ethers.provider.getGasPrice();
      const txWithoutSignature = await programOne
        .connect(relayer)
        .estimateGas.completeUserAuthorityObjective(
          0,
          userThree.address,
          userThreeUpdateProof,
          hre.ethers.constants.HashZero,
          "0x"
        );

      const cost = gasPrice.mul(txWithoutSignature);
      const costInEth = hre.ethers.utils.formatUnits(cost, "ether");

      expect(parseFloat(costInEth)).to.be.lessThan(0.0003);
    });
  //...etc
});
