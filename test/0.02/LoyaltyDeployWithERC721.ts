import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  VERSION_0_02_ERC721_ESCROW,
  VERSION_0_02_LOYALTY_FACTORY,
  VERSION_0_02_LOYALTY_PROGRAM,
} from "../../constants/contractRoutes";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
  ERC721RewardCondition,
} from "../../constants/contractEnums";
import {
  ONE_MONTH_SECONDS,
  THREE_DAYS_MS,
  TWO_DAYS_MS,
} from "../../constants/timeAndDate";
import {
  programName,
  targetObjectivesBytes32,
  authoritiesBytes32,
  rewards,
  tierNamesBytes32,
  tierRewardsRequired,
} from "../../constants/basicLoyaltyConstructorArgs";

let currentTimeInSeconds: number = 0;
let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;
let depositorOne: SignerWithAddress;
let depositorTwo: SignerWithAddress;

let loyaltyProgramOne: any;
let loyaltyProgramOneAddress: string = "";
let loyaltyProgramOneEndsAt: number = 0;

let erc721EscrowOne: any;
let erc721EscrowOneAddress: string = "";

let testCollection: any;

describe("LoyaltyProgram", () => {
  before(async () => {
    currentTimeInSeconds = await time.latest();
    accounts = await hre.ethers.getSigners();
    creatorOne = accounts[1];
    creatorTwo = accounts[2];
    depositorOne = accounts[3];
    depositorTwo = accounts[4];

    //deploy test ERC721 collection to be used as rewards for ERC721 escrow
    const testERC20Token = await hre.ethers.deployContract("AdajToken");
    testCollection = await hre.ethers.deployContract("TestERC721Contract", [
      "TestCollection",
      "TEST",
      testERC20Token.address,
    ]);

    await testERC20Token.transfer(creatorOne.address, 1_000_000);
    await testERC20Token
      .connect(creatorOne)
      .approve(testCollection.address, 5000);
    await testERC20Token
      .connect(creatorOne)
      .increaseAllowance(testCollection.address, 5000);

    //mint test ERC721 tokens to be used as rewards
    await testCollection.setSaleState(true);
    await testCollection.setMaxToMint(1000);
    await testCollection.connect(creatorOne).mintNoodles(200);

    const creatorOneNFTBalance = await testCollection.balanceOf(
      creatorOne.address
    );
    expect(creatorOneNFTBalance.toNumber()).equal(200);
  });

  it("ensures that a loyalty program with ERC721 rewards can still be deployed after tier handling moved directly to constructor", async () => {
    //in first contract version, tiers required an additional external call to be added.
    //this will ensure that with tier info added directly to contract constructor,
    //that the tiers are added directly with contract deploy
    const loyaltyContractFactory = await hre.ethers.getContractFactory(
      VERSION_0_02_LOYALTY_FACTORY
    );

    const threeMonthsFromNow = ONE_MONTH_SECONDS * 3;
    const programEndsAtDate = threeMonthsFromNow + currentTimeInSeconds;
    const tierSortingActive = true;

    //deploy loyalty program as creator one address
    const newLoyaltyProgram = await loyaltyContractFactory
      .connect(creatorOne)
      .deploy(
        programName,
        targetObjectivesBytes32,
        authoritiesBytes32,
        rewards,
        RewardType.ERC721,
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

    //verify loyalty program settings
    const [
      tiersAreActive,
      tierCount,
      totalPointsPossible,
      rewardType,
      objectives,
    ] = await loyaltyProgramOne.getLoyaltyProgramSettings();

    expect(tiersAreActive).equal(true, "Incorrect");
    expect(tierCount.toNumber()).equal(5, "Incorrect"); //default tier is added since first tier rewards required was above 0
    expect(totalPointsPossible.toNumber()).equal(
      7800,
      "Incorrect total points"
    );
    expect(rewardType).equal(RewardType.ERC721, "Incorrect reward type");
    expect(objectives.length).equal(5, "Incorrect length");
  });
  it("ensures that an ERC721 escrow contract can still be deployed and set in corresponding loyalty program contract, since constructor args have changed", async () => {
    const erc721EscrowFactory = await hre.ethers.getContractFactory(
      VERSION_0_02_ERC721_ESCROW
    );
    const rewardTokenAddress = testCollection.address;
    const approvedDepositors: string[] = [
      creatorOne.address,
      depositorOne.address,
      depositorTwo.address,
    ];

    const erc721EscrowContract = await erc721EscrowFactory
      .connect(creatorOne)
      .deploy(
        loyaltyProgramOneAddress,
        creatorOne.address,
        loyaltyProgramOneEndsAt,
        rewardTokenAddress,
        approvedDepositors
      );
    erc721EscrowOne = await hre.ethers.getContractAt(
      VERSION_0_02_ERC721_ESCROW,
      erc721EscrowContract.address
    );
    erc721EscrowOneAddress = erc721EscrowContract.address;

    //ensure state vars are set from constructor
    const creator = await erc721EscrowOne.creator.call();
    const programEndDate = await erc721EscrowOne.loyaltyProgramEndsAt.call();
    const loyaltyAddress = await erc721EscrowOne.loyaltyProgramAddress.call();

    expect(creator).equal(creatorOne.address, "Incorrect");
    expect(programEndDate.toNumber()).equal(
      loyaltyProgramOneEndsAt,
      "Incorrect date"
    );
    expect(loyaltyAddress).equal(loyaltyProgramOneAddress);

    //ensure that initial escrow state and loyalty state are correct
    const initialLoyaltyState = await loyaltyProgramOne.state();
    const initialEscrowState = await erc721EscrowOne.escrowState();

    expect(initialLoyaltyState).equal(LoyaltyState.Idle, "Incorrect state");
    expect(initialEscrowState).equal(EscrowState.Idle, "Incorrect state");

    //ensure that escrow contract can be set in loyalty contract
    const setEscrow = await loyaltyProgramOne
      .connect(creatorOne)
      .setEscrowContract(erc721EscrowOneAddress, RewardType.ERC721);
    expect(setEscrow.hash).not.null;

    //ensure that reward collection and approved depositors are set now that
    //this functionality moved to the escrow contract's constructor.
    const isCreatorSenderApproved = await erc721EscrowOne.isSenderApproved(
      creatorOne.address
    );
    const isSenderApproved1 = await erc721EscrowOne.isSenderApproved(
      depositorOne.address
    );
    const isSenderApproved2 = await erc721EscrowOne.isSenderApproved(
      depositorTwo.address
    );
    const isRewardCollectionApproved =
      await erc721EscrowOne.isCollectionApproved(testCollection.address);

    expect(isCreatorSenderApproved).equal(
      true,
      "Incorrect, creator should be approved"
    );
    expect(isSenderApproved1).equal(
      true,
      "Incorrect - deposit oen should be approved"
    );
    expect(isSenderApproved2).equal(
      true,
      "Incorrect - depositor 2 should be approved"
    );
    expect(isRewardCollectionApproved).equal(
      true,
      "Incorrect - reward collection should be approved"
    );
  });
  it("ensures escrow state during deposit flow still works correctly after steps were moved to constructor", async () => {
    //TODO
  });
});
