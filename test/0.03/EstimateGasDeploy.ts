import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { estimateGasDeploy } from "../../utils/deployLoyaltyUtils";
import { RewardType } from "../../constants/contractEnums";

let creator: SignerWithAddress;
let accounts: SignerWithAddress[] = [];

let testERC20Token: any;
let testERC721Collection: any;
let testERC1155Collection: any;
let loyaltyAddressActor: SignerWithAddress;

//all of these are done with 5 objectives, 4 tiers when applicable.
//needs tests done with 10 objectives, 8 tiers, etc.
//and tests with increased max objectives, 20, etc.

describe("LoyaltyProgram Gas Estimates", () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    creator = accounts[1];
    loyaltyAddressActor = accounts[2];

    testERC20Token = await hre.ethers.deployContract("AdajToken");
    testERC721Collection = await hre.ethers.deployContract(
      "TestERC721Contract",
      ["TestCollection", "TEST", testERC20Token.address]
    );
    testERC1155Collection = await hre.ethers.deployContract(
      "TestERC1155Collection"
    );
  });
  it("estimates gas for loyalty program deployment with tiers and with ERC20 escrow deployment on ETH mainnet", async () => {
    const estimates = await estimateGasDeploy(
      "0_03",
      RewardType.ERC20,
      true,
      creator,
      loyaltyAddressActor.address,
      testERC20Token.address
    );
    const loyaltyGas = estimates?.loyaltyGasEth;
    const escrowGas = estimates?.escrowGasEth;
    const combinedCost = parseFloat(loyaltyGas) + parseFloat(escrowGas);

    //loyalty deploy cost in Ether: 0.004284935629995812 ETH around $13 on 4/4/2024
    //escrow deploy cost in Ether: 0.004860004059451376 ETH around $15 on 4/4/2024

    expect(parseFloat(loyaltyGas)).to.be.lessThan(0.005);
    expect(parseFloat(escrowGas)).to.be.lessThan(0.005);
    expect(combinedCost).to.be.lessThan(0.01);
  });
  it("estimates gas for loyalty program deployment with tiers and with ERC721 escrow deployment on ETH mainnet", async () => {
    const estimates = await estimateGasDeploy(
      "0_03",
      RewardType.ERC721,
      true,
      creator,
      loyaltyAddressActor.address,
      testERC721Collection.address
    );
    const loyaltyGas = estimates?.loyaltyGasEth;
    const escrowGas = estimates?.escrowGasEth;
    const combinedCost = parseFloat(loyaltyGas) + parseFloat(escrowGas);

    //loyalty deploy cost in Ether: 0.004093719363827604 ETH around $13 on 4/4/2024
    ////escrow deploy cost in Ether: 004569821732431494 ETH around $15 on 4/4/2024

    expect(parseFloat(loyaltyGas)).to.be.lessThan(0.005);
    expect(parseFloat(escrowGas)).to.be.lessThan(0.005);
    expect(combinedCost).to.be.lessThan(0.01);
  });
  it("estimates gas for loyalty program deployment with tiers and with ERC1155 escrow deployment on ETH mainnet", async () => {
    const estimates = await estimateGasDeploy(
      "0_03",
      RewardType.ERC1155,
      true,
      creator,
      loyaltyAddressActor.address,
      testERC1155Collection.address
    );
    const loyaltyGas = estimates?.loyaltyGasEth;
    const escrowGas = estimates?.escrowGasEth;
    const combinedCost = parseFloat(loyaltyGas) + parseFloat(escrowGas);

    //loyalty deploy cost in Ether: 0.003903208821186884 ETH around $12 on 4/4/2024
    //escrow deploy cost in Ether: 0.00529444412982969 ETH around $17 on 4/4/2045

    expect(parseFloat(loyaltyGas)).to.be.lessThan(0.005);
    expect(parseFloat(escrowGas)).to.be.lessThan(0.005);
    expect(combinedCost).to.be.lessThan(0.01);

    //test fails for ERC1155 escrow as of 4/4, prob cause of contract size.
    //would like to get it under 0.005.

    //as of 4/4 got estimate down to 0.005158181362465406 ETH just by consolidating funcs
    //can also shorten or get rid of require statements and throw reverts.
  });
  it("estimates gas for loyalty program deployment with tiers and with no escrow contract", async () => {
    const estimates = await estimateGasDeploy(
      "0_03",
      RewardType.Points,
      true,
      creator,
      loyaltyAddressActor.address
    );
    const loyaltyGas = estimates?.loyaltyGasEth;

    //loyalty deploy cost in Ether: 0.003871102225080508 ETH around $12 on 4/4/2024
    expect(parseFloat(loyaltyGas)).to.be.lessThan(0.005);
  });
  it("estimates gas for loyalty program deployment without tiers and with no escrow contract", async () => {
    const estimates = await estimateGasDeploy(
      "0_03",
      RewardType.Points,
      false,
      creator,
      loyaltyAddressActor.address
    );
    const loyaltyGas = estimates?.loyaltyGasEth;

    //loyalty deploy cost in Ether: 0.003461647991680307 ETH around $11 on 4/4/2024
    expect(parseFloat(loyaltyGas)).to.be.lessThan(0.004);
  });
});
