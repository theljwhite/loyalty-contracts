import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
  ERC721RewardOrder,
  ERC721RewardCondition,
} from "../../constants/contractEnums";
import {
  ONE_MONTH_SECONDS,
  THREE_DAYS_MS,
  TWO_DAYS_MS,
} from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  handleTestERC721DeployMintAndTransfer,
  handleTransferTestERC721ToEscrow,
  transferERC721,
} from "../../utils/deployLoyaltyUtils";

type CreatorContracts = {
  loyaltyAddress: string;
  escrowAddress: string;
  loyalty: any;
  escrow: any;
};

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;
let creatorThree: SignerWithAddress;
let creatorFour: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;
let userFour: SignerWithAddress;

const contracts: CreatorContracts[] = [];
let loyaltyCreators: SignerWithAddress[] = [];

let testCollectionDeployer: SignerWithAddress;
let testCollection: any;

describe("LoyaltyProgram", () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    testCollectionDeployer = accounts[0];
    creatorOne = accounts[1];
    creatorTwo = accounts[2];
    creatorThree = accounts[3];
    creatorFour = accounts[4];

    userOne = accounts[10];
    userTwo = accounts[11];
    userThree = accounts[12];
    userFour = accounts[13];

    loyaltyCreators = [creatorOne, creatorTwo, creatorThree, creatorFour];

    //deploy test ERC721 contract and mint tokens
    const { balance: creatorOneERC721Balance, testERC721Contract } =
      await handleTestERC721DeployMintAndTransfer(200, creatorOne);
    testCollection = testERC721Contract;

    expect(creatorOneERC721Balance.toNumber()).equal(200, "Incorrect balance");

    //deploy 4 loyalty programs with ERC721 escrow and do set up until ready for deposits.
    //these programs will be used to test different RewardConditions (again, theyre already tested for version 0.01);
    const useTiers = true;
    for (const loyaltyCreator of loyaltyCreators) {
      const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
        await deployProgramAndSetUpUntilDepositPeriod(
          "0_02",
          RewardType.ERC721,
          useTiers,
          loyaltyCreator,
          testERC721Contract.address
        );
      contracts.push({
        loyaltyAddress: loyaltyAddress,
        escrowAddress: escrowAddress ?? "",
        escrow: escrowContract,
        loyalty: loyaltyContract,
      });
    }

    //ensure initial state is correct for each contract
    const loyaltyStates: LoyaltyState[] = [];
    const escrowStates: EscrowState[] = [];

    for (const contract of contracts) {
      const loyaltyState = await contract.loyalty.state();
      const escrowState = await contract.escrow.escrowState();
      loyaltyStates.push(loyaltyState);
      escrowStates.push(escrowState);
    }

    expect(loyaltyStates).deep.equal(
      Array(loyaltyStates.length).fill(LoyaltyState.Idle),
      "Incorrect - states should be idle"
    );
    expect(escrowStates).deep.equal(
      Array(escrowStates.length).fill(EscrowState.DepositPeriod),
      "Incorrect - states should be in deposit period"
    );

    //transfer tokens to the other creators from creatorOne to be used for rewards depositing.
    //transfer 50 tokens to the other 3 creators so that each creator owns 50 tokens.
    //starting transfers at tokenId 50.
    const { receiverBalance: creatorTwoBalance } = await transferERC721(
      50,
      100,
      creatorOne,
      creatorTwo,
      testCollection
    );
    const { receiverBalance: creatorThreeBalance } = await transferERC721(
      100,
      150,
      creatorOne,
      creatorThree,
      testCollection
    );
    const {
      senderBalance: finalCreatorOneBal,
      receiverBalance: creatorFourBalance,
    } = await transferERC721(150, 200, creatorOne, creatorFour, testCollection);

    const balsToNumber = [
      creatorTwoBalance,
      creatorThreeBalance,
      creatorFourBalance,
      finalCreatorOneBal,
    ].map((bal) => bal.toNumber());

    expect(balsToNumber).deep.equal(
      Array(balsToNumber.length).fill(50),
      "Incorrect balances"
    );
  });
  it("deposits test ERC721 tokens into ERC721 escrow contracts and sets up escrow settings for further testing", async () => {
    //deposit tokens into each escrow contract instance to further test the different rewardConditions.
    for (let i = 0; i < contracts.length; i++) {
      const tokenIdStart = i * 50;
      const tokenIdEnd = tokenIdStart + 50;

      await handleTransferTestERC721ToEscrow(
        tokenIdStart,
        tokenIdEnd,
        testCollection,
        contracts[i].escrowAddress,
        loyaltyCreators[i]
      );
    }

    //ensure that state vars in contract were updated after deposits
    const eachEscrowTotalTokensState: number[] = [];
    const tokenIdsStateReturn: Array<number[]> = [];

    for (let i = 0; i < contracts.length; i++) {
      const { totalTokens } = await contracts[i].escrow.getBasicEscrowInfo();
      const tokenIdsState = await contracts[i].escrow
        .connect(loyaltyCreators[i])
        .getEscrowTokenIds();

      eachEscrowTotalTokensState.push(totalTokens.toNumber());
      tokenIdsStateReturn.push(tokenIdsState);
    }
    const tokenIdsStateToNum = tokenIdsStateReturn.map((tokenIds: any[]) =>
      tokenIds.map((tkn: any) => tkn.toNumber())
    );

    const correctTokenIdsOne = [...Array(50).keys()];
    const correctTokenIdsTwo = Array.from({ length: 50 }, (_, i) => i + 50);
    const correctTokenIdsThree = Array.from({ length: 50 }, (_, i) => i + 100);
    const correctTokenIdsFour = Array.from({ length: 50 }, (_, i) => i + 150);

    expect(eachEscrowTotalTokensState).deep.equal(
      [50, 50, 50, 50],
      "Incorrect token amounts"
    );
    expect(tokenIdsStateToNum).deep.equal(
      [
        correctTokenIdsOne,
        correctTokenIdsTwo,
        correctTokenIdsThree,
        correctTokenIdsFour,
      ],
      "Incorrect token id arrays"
    );

    //move time forward so that deposit periods are ended for each escrow contract
    await moveTime(THREE_DAYS_MS);

    //ensure states have changed now that deposit period is over (to AwaitingEscrowSettings)
    const escrowStatesAfterDep: EscrowState[] = [];
    for (let i = 0; i < contracts.length; i++) {
      const escrowStateAfterDeposit = await contracts[i].escrow.escrowState();
      escrowStatesAfterDep.push(escrowStateAfterDeposit);
    }

    expect(escrowStatesAfterDep).deep.equal(
      Array(escrowStatesAfterDep.length).fill(
        EscrowState.AwaitingEscrowSettings
      ),
      "Incorrect - all states should be AwaitingEscrowSettings"
    );

    //customize/set escrow settings to test different rewardConditions.
    //first program will use Random rewardOrder and PointsTotal rewardCondition.
    //the others will use Ascending rewardOrder paired with the 3 different rewardConditions.
    //rewardOrders will be tested in a different file (theyre already tested with 0.01 contracts)

    const pointsRewardGoal = 7000;
    const indexRewardGoal = 2; //objective index 2 or tier index 2 dependent on rewardCondition
    const setSettingsReceipts = [];
    const setSettingsOne = await contracts[0].escrow
      .connect(creatorOne)
      .setEscrowSettings(
        ERC721RewardOrder.Random,
        ERC721RewardCondition.PointsTotal,
        pointsRewardGoal
      );

    for (let i = 1; i < contracts.length; i++) {
      const setSettings = await contracts[i].escrow
        .connect(loyaltyCreators[i])
        .setEscrowSettings(ERC721RewardOrder.Ascending, i, indexRewardGoal);
    }

    //sort token queues emitted from setEscrowSettings calls.
    //return the token queues back to the contracts.
    //after it is returned, contracts are InIssuance and ready to test objective completion.

    //...TODO: 2/10 - unfinished
  });
});
