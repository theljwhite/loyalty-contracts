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
import { simulateOffChainSortTokens } from "../../utils/sortTokens";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";

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
    const setSettingsOneReceipt = await setSettingsOne.wait();
    setSettingsReceipts.push(setSettingsOneReceipt);

    for (let i = 1; i < contracts.length; i++) {
      const setSettings = await contracts[i].escrow
        .connect(loyaltyCreators[i])
        .setEscrowSettings(ERC721RewardOrder.Ascending, i, indexRewardGoal);
      const receipt = await setSettings.wait();
      setSettingsReceipts.push(receipt);
    }

    //sort token queues emitted from setEscrowSettings calls.
    //return the token queues back to the contracts.
    //after they are returned, contracts are InIssuance and ready to test objective completion.
    type SortTokenQueueArgs = {
      creator: string;
      tokensArr: number[];
      rewardOrder: ERC721RewardOrder;
    };
    const sortTokenQueueEventArgs: SortTokenQueueArgs[] = [];

    for (let i = 0; i < setSettingsReceipts.length; i++) {
      const [sortTokenQueueEvent] = setSettingsReceipts[i].events.filter(
        (e: any) => e.event === "SortTokenQueue"
      );
      const { creator, tokensArr, rewardOrder } = sortTokenQueueEvent.args;
      const formattedTokensArr = tokensArr.map((tkn: any) => tkn.toNumber());
      sortTokenQueueEventArgs.push({
        creator,
        tokensArr: formattedTokensArr,
        rewardOrder,
      });
    }

    //simulate off-chain sort based on emitted SortTokenQueue events arguments
    const sortedTokensByRewardOrder: Array<number[]> = [];
    for (let i = 0; i < sortTokenQueueEventArgs.length; i++) {
      const sortedTokens = simulateOffChainSortTokens(
        sortTokenQueueEventArgs[i].tokensArr,
        sortTokenQueueEventArgs[i].rewardOrder
      );
      sortedTokensByRewardOrder.push(sortedTokens);
    }

    //return the sorted token id arrays back to the respective contracts and set loyalty programs active.
    //ensure state for each is now InIssuance (ready for users to complete objectives and be rewarded).
    const escrowStatesAfterQueue: EscrowState[] = [];
    const loyaltyStatesAfterQueue: LoyaltyState[] = [];
    for (let i = 0; i < contracts.length; i++) {
      await contracts[i].escrow
        .connect(loyaltyCreators[i])
        .receiveTokenQueue(sortedTokensByRewardOrder[i], depositKeyBytes32);
      await contracts[i].loyalty
        .connect(loyaltyCreators[i])
        .setLoyaltyProgramActive();
      const escrowState = await contracts[i].escrow.escrowState();
      const loyaltyState = await contracts[i].loyalty.state();

      escrowStatesAfterQueue.push(escrowState);
      loyaltyStatesAfterQueue.push(loyaltyState);
    }

    expect(escrowStatesAfterQueue).deep.equal(
      Array(contracts.length).fill(EscrowState.InIssuance),
      "Incorrect - all escrow contracts should be InIssuance"
    );
    expect(loyaltyStatesAfterQueue).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Active),
      "Incorrect - loyalty states should be active"
    );
    //contracts are now InIssuance and ready for further testing.
  });
  it("ensures that 0.02 loyalty/escrow correctly processes Random rewardOrder with PointsTotal RewardCondition as users complete objectives", async () => {
    //loyalty program one has a Random rewardOrder and PointsTotal rewardCondition.
    //7000 was set as the PointsTotal reward goal.
    //so when a user reaches 7000 points, they should be rewarded a random token id.

    //complete first three objectives. 7000 is not reached yet so no tokens should be rewarded.
    const loyaltyOne = contracts[0].loyalty;
    const escrowOne = contracts[0].escrow;
    const firstObjectivesToComplete = [0, 1, 2];

    for (let i = 0; i < firstObjectivesToComplete.length; i++) {
      const objectiveIndex = i;
      await loyaltyOne
        .connect(userOne)
        .completeUserAuthorityObjective(objectiveIndex);
    }

    //completing first three objectives will bring points total to 1800.
    //ensure user records are correct, and ensure no tokens rewarded yet.
    const userCompleteObjsOne = await loyaltyOne.getUserCompletedObjectives(
      userOne.address
    );
    const userProgOne = await loyaltyOne.getUserProgression(userOne.address);

    expect(userCompleteObjsOne).deep.equal(
      [true, true, true, false, false],
      "Incorrect objectives complete"
    );
    expect(userProgOne.rewardsEarned.toNumber()).equal(
      1800,
      "Incorrect points"
    );
    expect(userProgOne.currentTier.toNumber()).equal(1, "Incorrect tier");

    const userEscrowBalOne = await escrowOne
      .connect(creatorOne)
      .getUserAccount(userOne.address);
    expect(userEscrowBalOne.length).equal(
      0,
      "Incorrect - no tkns should be rewarded to user one"
    );

    //complete the remaining two objectives.
    //this will bring points total to 7800 which passes 7000 rewardGoal.
    //this should reward a token (in random order) to user one's escrow account.
    //Objective index 4 is CREATOR authority which means it must be marked completed by contract creator.
    const objectiveIndexThree = 3;
    const objectiveIndexFour = 4;

    await loyaltyOne
      .connect(userOne)
      .completeUserAuthorityObjective(objectiveIndexThree);

    await loyaltyOne
      .connect(creatorOne)
      .completeCreatorAuthorityObjective(objectiveIndexFour, userOne.address);

    //ensure points total, etc is correct.
    //ensure that a token in random order is rewarded.
    const userFinalCompletions = await loyaltyOne.getUserCompletedObjectives(
      userOne.address
    );
    const userProgFinal = await loyaltyOne.getUserProgression(userOne.address);

    expect(userFinalCompletions).deep.equal(Array(5).fill(true));
    expect(userProgFinal.currentTier.toNumber()).equal(4, "Incorrect tier");
    expect(userProgFinal.rewardsEarned.toNumber()).equal(
      7800,
      "Incorrect points"
    );

    const userEscrowFinalBal = await escrowOne
      .connect(creatorOne)
      .getUserAccount(userOne.address);

    expect(userEscrowFinalBal.length).equal(
      1,
      "Incorrect - one token should have been rewarded"
    );

    //TODO 2/11 - to be continued (unfinished tests)
  });
});
