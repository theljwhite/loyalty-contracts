import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseGwei } from "viem";

const { expectEvent } = require("@openzeppelin/test-helpers");

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

describe("LoyaltyProgram", () => {
  //in first contract version, tiers required an additional external call to be added.
  //this will ensure that with tier info added directly to contract constructor,
  //that the tiers are added directly with contract deploy
  it("ensures that a loyalty program contract can be deployed with tier handling moved directly to its constructor", async () => {
    const [owner, nonOwner] = await hre.ethers.getSigners();
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
    const authoritiesBytes32 = ["USER", "USER", "USER", "USER", "OWNER"].map(
      (a) => hre.ethers.utils.formatBytes32String(a)
    );
    const tierNames = ["Bronze", "Silver", "Gold", "Diamond"];
    const tierNamesBytes32 = tierNames.map((tier) =>
      hre.ethers.utils.formatBytes32String(tier)
    );
    const tierRewardsRequired = [400, 4400, 7000, 7800];

    const currentTimeInSeconds = await time.latest();
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
    console.log("program", deployedProgram);

    //TODO - unfinished test
  });
});
