import { formatEther, parseEther } from "viem";
import hre from "hardhat";

async function main() {
  //TODO - deploy test token contracts here to be used in testing
  //the loyalty contract instances can be deployed from within testing
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
