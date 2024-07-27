import hre, { network } from "hardhat";
import { RewardType } from "../constants/contractEnums";

const { formatBytes32String } = hre.ethers.utils;

const objectives = [
  {
    title: "jb one",
    authority: "USER",
    reward: 400,
  },
  {
    title: "jb two",
    authority: "USER",
    reward: 400,
  },
  {
    title: "jb three",
    authority: "USER",
    reward: 1000,
  },
  {
    title: "jb four",
    authority: "USER",
    reward: 2000,
  },
  { title: "two five", authority: "CREATOR", reward: 4000 },
];

const tiers = [
  { name: "jb1", rewardsRequired: 400 },
  { name: "jb2", rewardsRequired: 4400 },
  { name: "jb3", rewardsRequired: 7000 },
  { name: "jb four", rewardsRequired: 7800 },
];

const targetObjectivesBytes32 = objectives.map((obj) =>
  formatBytes32String(obj.title.trim().slice(0, 30))
);
const authoritiesBytes32 = objectives.map((obj) =>
  formatBytes32String(obj.authority)
);
const objectivesRewards: number[] = objectives.map((obj) => obj.reward);
const tierSortingEnabled = tiers && tiers.length > 0;
const tierNamesBytes32 = tiers.map((tier) =>
  formatBytes32String(tier.name.trim().slice(0, 30))
);
const tierRewardsRequired: number[] = tiers.map((tier) => tier.rewardsRequired);

const constructorArgs = [
  "July B",
  targetObjectivesBytes32,
  authoritiesBytes32,
  objectivesRewards,
  RewardType.ERC20,
  1725210000,
  true,
  tierSortingEnabled ? tierNamesBytes32 : [],
  tierSortingEnabled ? tierRewardsRequired : [],
];

const verifyContract = async (
  network: string,
  address: string,
  constructorArgs: any[]
): Promise<any> => {
  console.log("C", constructorArgs);
  await hre.run("verify:verify", {
    address,
    constructorArgs,
  });
};

verifyContract(
  "polygonAmoy",
  "0x11986F56a28906026397Ab472117230888368757",
  constructorArgs
).catch((error) => {
  console.error("VERIFY ERROR***", error);
  process.exitCode = 1;
});
