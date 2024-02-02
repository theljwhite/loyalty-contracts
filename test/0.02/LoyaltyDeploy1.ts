import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseGwei } from "viem";
const { expectEvent, expectRevert } = require("@openzeppelin/test-helpers");

enum RewardType {
  Points,
  ERC20,
  ERC721,
  ERC1155,
}

const VERSION_0_02_LOYALTY_FACTORY =
  "contracts/Loyalty0.02/Loyalty.sol:Loyalty";
const VERSION_0_02_LOYALTY_PROGRAM =
  "contracts/Loyalty0.02/LoyaltyProgram.sol:LoyaltyProgram";
let currentTimeInSeconds: number = 0;

describe("LoyaltyProgram", () => {
  //in first contract version, tiers required an additional external call to be added.
  //this will ensure that with tier info added directly to contract constructor,
  //that the tiers are added directly with contract deploy
  before(async () => {
    currentTimeInSeconds = await time.latest();
  });

  it("ensures that a loyalty program contract can be deployed with tier handling moved directly to its constructor", async () => {
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

    //deploy loyalty program
    const newLoyaltyProgram = await loyaltyContractFactory.deploy(
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
    const deployedProgram = await hre.ethers.getContractAt(
      VERSION_0_02_LOYALTY_PROGRAM,
      newLoyaltyProgram.address
    );

    //ensure contract information and tiers are added to newly deployed program
    const [
      tiersAreActive,
      tierCount,
      totalPointsPossible,
      rewardType,
      objectives,
    ] = await deployedProgram.getLoyaltyProgramSettings();

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
  });
});
