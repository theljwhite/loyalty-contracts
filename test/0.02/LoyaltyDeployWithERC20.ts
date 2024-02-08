import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
const { expectEvent, expectRevert } = require("@openzeppelin/test-helpers");
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VERSION_0_02_ERC20_ESCROW,
  VERSION_0_02_LOYALTY_FACTORY,
  VERSION_0_02_LOYALTY_PROGRAM,
} from "../../constants/contractRoutes";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
} from "../../constants/contractEnums";
import { THREE_DAYS_MS, TWO_DAYS_MS } from "../../constants/timeAndDate";

let currentTimeInSeconds: number = 0;
let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;
let depositorOne: SignerWithAddress;
let depositorTwo: SignerWithAddress;

let loyaltyProgramOne: any;
let loyaltyProgramOneAddress: string = "";
let loyaltyProgramOneEndsAt: number = 0;

let erc20EscrowOne: any;
let erc20EscrowOneAddress: string = "";

let testToken: any;

describe("LoyaltyProgram", () => {
  before(async () => {
    currentTimeInSeconds = await time.latest();
    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];
    creatorTwo = accounts[2];
    depositorOne = accounts[3];
    depositorTwo = accounts[4];

    //deploy ERC20 test token to be used as rewards for escrow contract
    testToken = await hre.ethers.deployContract("AdajToken");

    //transfer test ERC20 tokens to creator to be used for rewards depositing

    await testToken.transfer(creatorOne.address, 1_000_000);
  });

  it("ensures that a loyalty program contract can be deployed with tier handling moved directly to its constructor", async () => {
    //in first contract version, tiers required an additional external call to be added.
    //this will ensure that with tier info added directly to contract constructor,
    //that the tiers are added directly with contract deploy
    const loyaltyContractFactory = await hre.ethers.getContractFactory(
      VERSION_0_02_LOYALTY_FACTORY
    );

    //new loyalty program constructor args
    const programName = "My Company Rewards";
    const targetObjectives = [
      "Invite 4 friends",
      "Use a discount code",
      "Buy items from shop",
      "Buy $60 from shop",
      "Follow all of our socials",
    ];
    const targetObjectivesBytes32 = targetObjectives.map((obj) =>
      hre.ethers.utils.formatBytes32String(obj)
    );
    const rewards = [400, 400, 1000, 2000, 4000];
    const authoritiesBytes32 = ["USER", "USER", "USER", "USER", "CREATOR"].map(
      (a) => hre.ethers.utils.formatBytes32String(a)
    );
    const tierNames = ["Bronze", "Silver", "Gold", "Diamond"];
    const tierNamesBytes32 = tierNames.map((tier) =>
      hre.ethers.utils.formatBytes32String(tier)
    );
    const tierRewardsRequired = [400, 4400, 7000, 7800];

    const oneMonthInSeconds = 30 * 24 * 60 * 60;
    const programEndsAtDate = currentTimeInSeconds + oneMonthInSeconds;
    const tierSortingActive = true;

    //deploy loyalty program as creator one address
    const newLoyaltyProgram = await loyaltyContractFactory
      .connect(creatorOne)
      .deploy(
        programName,
        targetObjectivesBytes32,
        authoritiesBytes32,
        rewards,
        RewardType.ERC20,
        programEndsAtDate,
        tierSortingActive,
        tierNamesBytes32,
        tierRewardsRequired
      );
    loyaltyProgramOne = await hre.ethers.getContractAt(
      VERSION_0_02_LOYALTY_PROGRAM,
      newLoyaltyProgram.address
    );
    loyaltyProgramOneAddress = newLoyaltyProgram.address;
    loyaltyProgramOneEndsAt = programEndsAtDate;

    //ensure contract settings and tiers are added to newly deployed program
    const [
      tiersAreActive,
      tierCount,
      totalPointsPossible,
      rewardType,
      objectives,
    ] = await loyaltyProgramOne.getLoyaltyProgramSettings();

    const formattedObjectives = objectives.map((obj: any) => ({
      name: hre.ethers.utils.toUtf8String(obj.name).replace(/\0/g, ""),
      reward: obj.reward.toNumber(),
      authority: hre.ethers.utils
        .toUtf8String(obj.authority)
        .replace(/\0/g, ""),
    }));
    const correctObjectivesShape = [
      { name: "Invite 4 friends", reward: 400, authority: "USER" },
      { name: "Use a discount code", reward: 400, authority: "USER" },
      { name: "Buy items from shop", reward: 1000, authority: "USER" },
      { name: "Buy $60 from shop", reward: 2000, authority: "USER" },
      { name: "Follow all of our socials", reward: 4000, authority: "CREATOR" },
    ];

    expect(tiersAreActive).equal(true, "Incorrect, tiers should be active");
    expect(tierCount.toNumber()).equal(5, "Incorrect tier count");
    expect(totalPointsPossible.toNumber()).equal(
      7800,
      "Incorrect points total"
    );
    expect(rewardType).equal(RewardType.ERC20, "Incorrect reward type");
    expect(formattedObjectives).deep.equal(correctObjectivesShape);

    //ensure that basic information is also correct in loyalty program contract
    const [name, creator, isActive, programEndsAtInContract] =
      await loyaltyProgramOne.getBasicLoyaltyProgramDetails();

    expect(name).equal("My Company Rewards");
    expect(creator).equal(creatorOne.address, "Incorrect creator address");
    expect(isActive).equal(false, "Program should not be active");
    expect(programEndsAtInContract.toNumber()).equal(programEndsAtDate);

    //ensure that loyalty program state is Idle
    const loyaltyState = await loyaltyProgramOne.state();
    expect(loyaltyState).equal(
      LoyaltyState.Idle,
      "Incorrect state after deploy"
    );
  });
  it("ensures that an ERC20 escrow contract can still be deployed and set in corresponding loyalty program contract", async () => {
    //deploy ERC20 escrow contract as creator one
    const erc20EscrowFactory = await hre.ethers.getContractFactory(
      VERSION_0_02_ERC20_ESCROW
    );
    const rewardTokenAddress = testToken.address;
    const approvedDepositors: string[] = [
      creatorOne.address,
      depositorOne.address,
      depositorTwo.address,
    ];

    const erc20EscrowContract = await erc20EscrowFactory
      .connect(creatorOne)
      .deploy(
        loyaltyProgramOneAddress,
        creatorOne.address,
        loyaltyProgramOneEndsAt,
        rewardTokenAddress,
        approvedDepositors
      );
    erc20EscrowOne = await hre.ethers.getContractAt(
      VERSION_0_02_ERC20_ESCROW,
      erc20EscrowContract.address
    );
    erc20EscrowOneAddress = erc20EscrowContract.address;

    //ensure state vars were set in constructor on deployment
    const creator = await erc20EscrowOne.creator.call();
    const loyaltyProgramAddress =
      await erc20EscrowOne.loyaltyProgramAddress.call();
    const programEndsAt = await erc20EscrowOne.loyaltyProgramEndsAt.call();

    expect(creator).equal(creatorOne.address, "Incorrect address");
    expect(loyaltyProgramAddress).equal(
      loyaltyProgramOneAddress,
      "Incorrect lp address"
    );
    expect(programEndsAt.toNumber()).equal(
      loyaltyProgramOneEndsAt,
      "Incorrect lp end date"
    );

    //ensure escrow state is correct
    const escrowState = await erc20EscrowOne.escrowState();
    expect(escrowState).equal(
      EscrowState.Idle,
      "Incorrect initial escrow state"
    );

    //ensure that deployed ERC20 contract can be set in loyalty program contract
    //call function as creatorOne so it doesnt revert
    const setERC20InLoyalty = await loyaltyProgramOne
      .connect(creatorOne)
      .setEscrowContract(erc20EscrowOneAddress, RewardType.ERC20);
    expect(setERC20InLoyalty.hash).not.null;
  });
  it("ensures that a loyalty program without tiers can be deployed after tier handling was added to constructor", async () => {
    const loyaltyContractFactory = await hre.ethers.getContractFactory(
      VERSION_0_02_LOYALTY_FACTORY
    );
    const programName = "My Second Rewards";
    const targetObjectives = [
      "Invite 4 friends",
      "Use a discount code",
      "Buy items from shop",
      "Buy $60 from shop",
      "Follow all of our socials",
    ];
    const targetObjectivesBytes32 = targetObjectives.map((obj) =>
      hre.ethers.utils.formatBytes32String(obj)
    );
    const rewards = [400, 400, 1000, 2000, 4000];
    const authoritiesBytes32 = ["USER", "USER", "USER", "USER", "CREATOR"].map(
      (a) => hre.ethers.utils.formatBytes32String(a)
    );
    const oneMonthInSeconds = 30 * 24 * 60 * 60;
    const programEndsAtDate = currentTimeInSeconds + oneMonthInSeconds;
    const tierSortingActive = false;

    //deploy with empty tier arguments as tiers arent needed for this loyalty program
    //contract should still deploy successfully but with only objectives, no tiers.
    const newLoyaltyProgram = await loyaltyContractFactory
      .connect(creatorTwo)
      .deploy(
        programName,
        targetObjectivesBytes32,
        authoritiesBytes32,
        rewards,
        RewardType.ERC20,
        programEndsAtDate,
        tierSortingActive,
        [],
        []
      );
    const deployedProgram = await hre.ethers.getContractAt(
      VERSION_0_02_LOYALTY_PROGRAM,
      newLoyaltyProgram.address
    );

    //ensure program settings are correct for a program without tiers
    const [
      tiersAreActive,
      tierCount,
      totalPointsPossible,
      rewardType,
      objectives,
    ] = await deployedProgram.getLoyaltyProgramSettings();

    expect(tiersAreActive).equal(false, "Tiers should not be active");
    expect(tierCount.toNumber()).equal(0, "Tier count should be 0");
    expect(totalPointsPossible.toNumber()).equal(7800, "Incorrect points");
    expect(rewardType).equal(RewardType.ERC20, "Incorrect reward type");
    expect(objectives).length(5, "The five objectives should have been added");
  });
  it("ensures escrow state during deposit flow still works correctly after steps were moved to constructor", async () => {
    //in version 0.01 contracts, approveSender and approveToken/approveRewards...
    //...were done with external calls. In 0.02, I have changed it so that this step
    //...can be done directly in the escrow contracts' constructors at deploy time

    //ensure initial state is Idle initially after deployment
    const initialState = await erc20EscrowOne.escrowState();
    expect(initialState).equal(EscrowState.Idle);

    //verify that after constructor changes, that token and depositors (senders) are approved
    const isTokenApproved = await erc20EscrowOne.isTokenApproved(
      testToken.address
    );
    const isSenderApproved1 = await erc20EscrowOne.isSenderApproved(
      creatorOne.address
    );
    const isSenderApproved2 = await erc20EscrowOne.isSenderApproved(
      depositorOne.address
    );
    const isSenderApproved3 = await erc20EscrowOne.isSenderApproved(
      depositorTwo.address
    );

    expect(isTokenApproved).equal(true, "Incorrect");
    expect(isSenderApproved1).equal(true, "Incorrect");
    expect(isSenderApproved2).equal(true, "Incorrect");
    expect(isSenderApproved3).equal(true, "Incorrect");

    //ensure deposit key can be set and that escrow state updates accordingly.
    //deposit period starts when deposit key is set, so escrow state should update
    const sampleDepositKey = "clscttni60000356tqrpthp7b";
    const depositKeyBytes32 =
      hre.ethers.utils.formatBytes32String(sampleDepositKey);
    const datePlusTwoDays = new Date().getTime() + TWO_DAYS_MS;
    const depositEndDate = Math.round(datePlusTwoDays / 1000);

    //call set deposit key as creator one
    await erc20EscrowOne
      .connect(creatorOne)
      .setDepositKey(depositKeyBytes32, depositEndDate);

    //verify that after key is set, state has changed to DepositPeriod
    const stateAfterDepositKeySet = await erc20EscrowOne.escrowState();
    expect(stateAfterDepositKeySet).equal(
      EscrowState.DepositPeriod,
      "Incorrect state"
    );

    //deposit 1000 test ERC20 tokens for further testing
    await testToken
      .connect(creatorOne)
      .increaseAllowance(erc20EscrowOneAddress, 10000);

    await erc20EscrowOne
      .connect(creatorOne)
      .depositBudget(1000, testToken.address);

    //now that tokens have been deposited:
    //move time forward 3+ days so that the deposit period has finished

    //TODO - unfinished

    //customize escrow settings by caling setEscrowSettings
    //for this test, use Reward Per Objective rewardCondition
    //after escrow settings are set, escrow state should still be

    //TODO - unfinished
  });
});
