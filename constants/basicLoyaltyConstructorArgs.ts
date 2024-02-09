import hre from "hardhat";

export const programName = "My Company Rewards";
const targetObjectives = [
  "Invite 4 friends",
  "Use a discount code",
  "Buy items from shop",
  "Buy $60 from shop",
  "Follow all of our socials",
];
export const targetObjectivesBytes32 = targetObjectives.map((obj) =>
  hre.ethers.utils.formatBytes32String(obj)
);
export const rewards = [400, 400, 1000, 2000, 4000];
export const authoritiesBytes32 = [
  "USER",
  "USER",
  "USER",
  "USER",
  "CREATOR",
].map((a) => hre.ethers.utils.formatBytes32String(a));
const tierNames = ["Bronze", "Silver", "Gold", "Diamond"];
export const tierNamesBytes32 = tierNames.map((tier) =>
  hre.ethers.utils.formatBytes32String(tier)
);
export const tierRewardsRequired = [400, 4400, 7000, 7800];
