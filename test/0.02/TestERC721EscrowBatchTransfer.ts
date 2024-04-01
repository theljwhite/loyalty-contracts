import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
  ERC20RewardCondition,
} from "../../constants/contractEnums";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  checkContractsState,
  type CreatorContracts,
  handleTestERC721DeployMintAndTransfer,
} from "../../utils/deployLoyaltyUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";
import { getERC20UserProgress } from "../../utils/userProgressTestUtils";

let accounts: SignerWithAddress[] = [];
let creator: SignerWithAddress;

let loyaltyProgram: any;
let erc721Escrow: any;
let loyaltyProgramAddress: string;
let erc721EscrowAddress: string;
let testERC721Collection: any;

describe("ERC721 Escrow", async () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    creator = accounts[1];

    //deploy test erc721 collection to be used for rewards depositing
    const { balance: creatorERC721InitialBalance, testERC721Contract } =
      await handleTestERC721DeployMintAndTransfer(200, creator);

    testERC721Collection = testERC721Contract;

    expect(creatorERC721InitialBalance.toNumber()).equal(
      200,
      "Incorrect balance"
    );

    //deploy loyalty program and erc721 escrow
    const useTiers = true;
    const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
      await deployProgramAndSetUpUntilDepositPeriod(
        "0_02",
        RewardType.ERC721,
        useTiers,
        creator,
        testERC721Contract.address
      );

    loyaltyProgram = loyaltyContract;
    loyaltyProgramAddress = loyaltyAddress;
    erc721Escrow = escrowContract;
    erc721EscrowAddress = escrowAddress ?? "";
  });

  it("tests if newly implemented batchTransfer and safeBatchTransfer functions added to ERC721 escrow work correctly and that contract still properly receives tokens as an ERC721 receiver", async () => {
    //instead of calling safeTransferFrom directly from the rewards contract (test ERC721 collection)
    //call newly implemented safeBatchTransfer function from ERC721 escrow and ensure that token deposits were...
    //...still received correctly like in other tests.

    const tokenIdsToDeposit = Array.from({ length: 50 }, (_, i) => i);

    //set approval for all first (for escrow to manage tokens)
    await testERC721Collection
      .connect(creator)
      .setApprovalForAll(erc721EscrowAddress, true);

    //deposit token ids 0 through 50 using new safeBatchTransfer method
    await erc721Escrow
      .connect(creator)
      .safeBatchTransfer(
        testERC721Collection.address,
        tokenIdsToDeposit,
        depositKeyBytes32
      );

    //call getEscrowTokenIds and ensure that they were added successfully from new methods
    const escrowTokens = await erc721Escrow.connect(creator).getTokenIds();
    const escrowTokensToNum = escrowTokens.map((tkn: any) => tkn.toNumber());

    expect(escrowTokensToNum).deep.equal(
      tokenIdsToDeposit,
      "Incorrect token ids, they were not added"
    );
  });
});
