import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import {
  checkContractsState,
  deployProgramAndSetUpUntilDepositPeriod,
} from "../../utils/deployLoyaltyUtils";
import { EscrowState, RewardType } from "../../constants/contractEnums";

//this is to test SafeERC20's safeApprove method during ERC20 escrow depositBudget function.
//right now since it is using safe approve, it is not allowing an additional deposit after a first one.
//due to this reason from next js frontend when depositing:
//ContractFunctionExecutioNError: approve from non-zero to non-zero allowance"

//as of 2/20/2024 safe approve is also deprecated,
//so this file will help me test other safe ways to accomplish this,
//such as safeIncreaseAllowance.

let testToken: any;
let erc20Escrow: any;
let escrowContractAddress: string;

let creator: SignerWithAddress;

describe("ERC20 Escrow", () => {
  before(async () => {
    const accounts = await hre.ethers.getSigners();
    creator = accounts[1];

    //deploy test ERC20 token to be used as rewards depositing for escrow.
    //transfer tokens to creator one to be used for deposits.
    testToken = await hre.ethers.deployContract("AdajToken");
    await testToken.transfer(creator.address, 1_000_000);
    const balance = await testToken.balanceOf(creator.address);
    expect(balance.toNumber()).equal(1_000_000, "Incorrect balance");

    //deploy loyalty program and escrow contract

    const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
      await deployProgramAndSetUpUntilDepositPeriod(
        "0_02",
        RewardType.ERC20,
        true,
        creator,
        testToken.address
      );

    erc20Escrow = escrowContract;
    escrowContractAddress = escrowAddress ?? "";

    //ensure escrow is in deposit period
    const escrowState = await erc20Escrow.escrowState();
    expect(escrowState).equal(EscrowState.DepositPeriod);
  });
  it("ensures that with changes to ERC20 escrow depositBudget, that multiple deposits behave correctly", async () => {
    const firstDepositAmount = 1000;
    const secondDepositAmount = 2000;

    //approve first amount
    await testToken
      .connect(creator)
      .approve(escrowContractAddress, firstDepositAmount);

    //deposit first amount
    await erc20Escrow
      .connect(creator)
      .depositBudget(firstDepositAmount, testToken.address);

    //ensure escrow balance is updated;
    const afterFirstDepEscrowBal = await erc20Escrow.lookupEscrowBalance();
    expect(afterFirstDepEscrowBal.toNumber()).equal(
      firstDepositAmount,
      "Incorrect escrow bal"
    );

    //approve second amount
    await testToken
      .connect(creator)
      .approve(escrowContractAddress, secondDepositAmount);

    //deposit again with a different amount, ensure it works.
    await erc20Escrow
      .connect(creator)
      .depositBudget(secondDepositAmount, testToken.address);

    //ensure escrow balance is updated
    const afterSecondDepEscrowBal = await erc20Escrow.lookupEscrowBalance();
    expect(afterSecondDepEscrowBal.toNumber()).equal(
      3000,
      "Incorrect amount after multiple deposits"
    );
  });
});
