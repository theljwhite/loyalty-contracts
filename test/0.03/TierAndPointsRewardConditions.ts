import { expect } from "chai";
import hre from "hardhat";
import { type SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  RewardType,
  LoyaltyState,
  EscrowState,
  ERC20RewardCondition,
  ERC721RewardCondition,
  ERC1155RewardCondition,
  ERC721RewardOrder,
} from "../../constants/contractEnums";
import { THREE_DAYS_MS } from "../../constants/timeAndDate";
import { moveTime } from "../../utils/moveTime";
import {
  deployProgramAndSetUpUntilDepositPeriod,
  handleTestERC721DeployMintAndTransfer,
  handleTransferTestERC721ToEscrow,
  handleTestERC1155TokenTransfer,
  type CreatorContracts,
  checkContractsState,
  transferERC721,
  handleTestERC1155TransferToEscrow,
} from "../../utils/deployLoyaltyUtils";
import {
  getERC20UserProgress,
  getERC1155UserProgress,
} from "../../utils/userProgressTestUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";

//with new givePointsToUser and deductPointsFromUser functions being added,
//this test needs to be done to ensure things dont break when,
//giving / deducting points standalone instead of only completing objectives in the past.

//this tests interaction with these reward conditions:
//ERC20: SingleTier, RewardPerTier (EachTier), AllTiersComplete
//ERC721: TierReached, PointsTotal
//ERC1155: SingleTier, EachTier, PointsTotal
//since these conditions may be affected by adding the 2 new funcs.

let accounts: SignerWithAddress[] = [];
let testContractdeployer: SignerWithAddress;

let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;
let creatorThree: SignerWithAddress;
let creatorFour: SignerWithAddress;
let creatorFive: SignerWithAddress;
let creatorSix: SignerWithAddress;
let creatorSeven: SignerWithAddress;
let creatorEight: SignerWithAddress;
let allCreators: SignerWithAddress[];

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

let contracts: CreatorContracts[] = [];
const onlyERC20Contracts: CreatorContracts[] = [];
const onlyERC721Contracts: CreatorContracts[] = [];
const onlyERC1155Contracts: CreatorContracts[] = [];

let loyaltyCreatorsERC20: SignerWithAddress[] = [];
let loyaltyCreatorsERC721: SignerWithAddress[] = [];
let loyaltyCreatorsERC1155: SignerWithAddress[] = [];

let relayer: SignerWithAddress;
let testERC20Token: any;
let testERC721Collection: any;
let testERC1155Collection: any;

describe("LoyaltyProgram", () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();

    testContractdeployer = accounts[0];
    creatorOne = accounts[1];
    creatorTwo = accounts[2];
    creatorThree = accounts[3];
    creatorFour = accounts[4];
    creatorFive = accounts[12];
    creatorSix = accounts[6];
    creatorSeven = accounts[7];
    creatorEight = accounts[8];

    relayer = accounts[5];
    userOne = accounts[9];
    userTwo = accounts[10];
    userThree = accounts[11];

    loyaltyCreatorsERC20 = [creatorOne, creatorTwo, creatorThree];
    loyaltyCreatorsERC721 = [creatorFour, creatorFive];
    loyaltyCreatorsERC1155 = [creatorSix, creatorSeven, creatorEight];

    allCreators = [
      ...loyaltyCreatorsERC20,
      ...loyaltyCreatorsERC721,
      ...loyaltyCreatorsERC1155,
    ];

    //deploy ERC20 test token to be used as rewards for escrow contracts
    testERC20Token = await hre.ethers.deployContract("AdajToken");

    //transfer test ERC20 tokens to creators to be used for rewards depositing
    const creatorInitialBalances: number[] = [];
    for (let i = 0; i < loyaltyCreatorsERC20.length; i++) {
      await testERC20Token.transfer(loyaltyCreatorsERC20[i].address, 1_000_000);
      const balance = await testERC20Token.balanceOf(
        loyaltyCreatorsERC20[i].address
      );
      creatorInitialBalances.push(balance);
    }
    const creatorInitBalancesToNum = creatorInitialBalances.map((bal: any) =>
      bal.toNumber()
    );
    expect(creatorInitBalancesToNum).deep.equal(
      Array(loyaltyCreatorsERC20.length).fill(1_000_000),
      "Incorrect initial creator balance"
    );

    //deploy 3 programs with 3 ERC20 escrow contracts to test reward conditions
    for (const loyaltyCreator of loyaltyCreatorsERC20) {
      const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
        await deployProgramAndSetUpUntilDepositPeriod(
          "0_03",
          RewardType.ERC20,
          true,
          loyaltyCreator,
          testERC20Token.address
        );
      onlyERC20Contracts.push({
        loyaltyAddress: loyaltyAddress,
        escrowAddress: escrowAddress ?? "",
        escrow: escrowContract,
        loyalty: loyaltyContract,
      });
    }

    //deploy test ERC721 collection, mint, and transfer tokens
    const { testERC721Contract } = await handleTestERC721DeployMintAndTransfer(
      200,
      accounts[0]
    );
    testERC721Collection = testERC721Contract;

    //transfer tokens to ERC721 escrow creators
    const firstTransfer = await transferERC721(
      0,
      50,
      accounts[0],
      loyaltyCreatorsERC721[0],
      testERC721Contract
    );
    const secondTransfer = await transferERC721(
      100,
      150,
      accounts[0],
      loyaltyCreatorsERC721[1],
      testERC721Contract
    );
    expect(firstTransfer.receiverBalance.toNumber()).equal(50, "Incorrect");
    expect(secondTransfer.receiverBalance.toNumber()).equal(50, "Incorrect");

    //deploy 2 programs with 2 ERC721 escrow contracts
    for (const loyaltyCreator of loyaltyCreatorsERC721) {
      const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
        await deployProgramAndSetUpUntilDepositPeriod(
          "0_03",
          RewardType.ERC721,
          true,
          loyaltyCreator,
          testERC721Collection.address
        );
      onlyERC721Contracts.push({
        loyaltyAddress: loyaltyAddress,
        escrowAddress: escrowAddress ?? "",
        escrow: escrowContract,
        loyalty: loyaltyContract,
      });
    }

    //deploy test ERC1155 collection
    testERC1155Collection = await hre.ethers.deployContract(
      "TestERC1155Collection"
    );

    //transfer ERC1155 tokens to creators to be used for rewards depositing
    const amountsOfTokens = Array(5).fill(500);
    for (const loyaltyCreator of loyaltyCreatorsERC1155) {
      await handleTestERC1155TokenTransfer(
        testERC1155Collection,
        loyaltyCreator,
        testContractdeployer,
        amountsOfTokens
      );
    }

    //deploy 3 programs with 3 ERC1155 escrow contracts
    for (const loyaltyCreator of loyaltyCreatorsERC1155) {
      const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
        await deployProgramAndSetUpUntilDepositPeriod(
          "0_03",
          RewardType.ERC1155,
          true,
          loyaltyCreator,
          testERC1155Collection.address
        );
      onlyERC1155Contracts.push({
        loyaltyAddress: loyaltyAddress,
        escrowAddress: escrowAddress ?? "",
        escrow: escrowContract,
        loyalty: loyaltyContract,
      });
    }

    contracts = [
      ...onlyERC20Contracts,
      ...onlyERC721Contracts,
      ...onlyERC1155Contracts,
    ];

    //ensure initial state is correct for every contract.
    //after each have been deployed and set up until deposit period
    const { escrowStates, loyaltyStates } =
      await checkContractsState(contracts);

    expect(loyaltyStates).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Idle),
      "Incorrect - states should be idle"
    );
    expect(escrowStates).deep.equal(
      Array(contracts.length).fill(EscrowState.DepositPeriod),
      "Incorrect - states should be in deposit period"
    );
  });

  it("deposits reward tokens for each contract in order to further test the reward conditions", async () => {
    const erc20AmountsToDeposit = [100, 100, 500];

    //deposit ERC20 tokens into the ERC20 contracts
    for (let i = 0; i < onlyERC20Contracts.length; i++) {
      await testERC20Token
        .connect(loyaltyCreatorsERC20[i])
        .increaseAllowance(
          onlyERC20Contracts[i].escrowAddress,
          erc20AmountsToDeposit[i]
        );
      await onlyERC20Contracts[i].escrow
        .connect(loyaltyCreatorsERC20[i])
        .depositBudget(erc20AmountsToDeposit[i], testERC20Token.address);
    }

    //deposit ERC721 tokens into the ERC721 contracts
    await handleTransferTestERC721ToEscrow(
      0,
      50,
      testERC721Collection,
      onlyERC721Contracts[0].escrowAddress,
      loyaltyCreatorsERC721[0]
    );
    await handleTransferTestERC721ToEscrow(
      100,
      150,
      testERC721Collection,
      onlyERC721Contracts[1].escrowAddress,
      loyaltyCreatorsERC721[1]
    );

    //deposit ERC1155 tokens into the ERC1155 contracts
    const erc1155Amounts = Array(5).fill(1000);
    const tokenIdsToDeposit = [0, 1, 2, 3, 4];
    const amountsToDeposit = [20, 30, 40, 50, 60];
    for (const loyaltyCreator of loyaltyCreatorsERC1155) {
      await handleTestERC1155TokenTransfer(
        testERC1155Collection,
        loyaltyCreator,
        testContractdeployer,
        erc1155Amounts
      );
    }

    for (let i = 0; i < onlyERC1155Contracts.length; i++) {
      await handleTestERC1155TransferToEscrow(
        tokenIdsToDeposit,
        amountsToDeposit,
        testERC1155Collection,
        onlyERC1155Contracts[i].escrowAddress,
        loyaltyCreatorsERC1155[i]
      );
    }

    //move time forward 3+ days so that deposit periods are over for each escrow contract.
    await moveTime(THREE_DAYS_MS);

    //ensure escrow states for all contracts are now AwaitingEscrowSettings
    const {
      escrowStates: escrowStatesAfterDeposit,
      loyaltyStates: loyaltyStatesAfterDeposit,
    } = await checkContractsState(contracts);

    expect(escrowStatesAfterDeposit).deep.equal(
      Array(contracts.length).fill(EscrowState.AwaitingEscrowSettings),
      "Incorrect escrow states"
    );
    expect(loyaltyStatesAfterDeposit).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Idle)
    );
  });

  it("sets escrow settings in order to further test the reward conditions", async () => {
    //set first ERC20 escrow contract to reward all tiers
    const rewardAmountOne = 2;
    await onlyERC20Contracts[0].escrow
      .connect(creatorOne)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.AllTiersComplete,
        0,
        rewardAmountOne
      );

    //set second ERC20 escrow contract to reward a single objective
    const rewardAmountTwo = 4;
    const rewardGoalTierIndex = 2;
    await onlyERC20Contracts[1].escrow
      .connect(creatorTwo)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.SingleTier,
        rewardGoalTierIndex,
        rewardAmountTwo
      );

    const payoutsForTiers = [0, 1, 1, 2, 4]; //corresponding to tier indexes
    await onlyERC20Contracts[2].escrow
      .connect(creatorThree)
      .setEscrowSettingsAdvanced(
        ERC20RewardCondition.RewardPerTier,
        payoutsForTiers
      );

    //set first ERC721 escrow contract to reward a single tier
    const tierRewardGoal = 3;
    await onlyERC721Contracts[0].escrow
      .connect(creatorFour)
      .setEscrowSettings(
        ERC721RewardOrder.Ascending,
        ERC721RewardCondition.TierReached,
        tierRewardGoal
      );

    //set second ERC721 escrow contract to reward a points total
    const pointsRewardGoal = 2500;
    await onlyERC721Contracts[1].escrow
      .connect(creatorFive)
      .setEscrowSettings(
        ERC721RewardOrder.Ascending,
        ERC721RewardCondition.PointsTotal,
        pointsRewardGoal
      );

    //sort ERC721 tokens and return to contract to reward in ascending order for each.
    //since simulating off-chain is already tested, i will hardcode this,
    //in order to further the testing here.
    const erc721EscrowOneSortedTokens = Array.from(
      { length: 50 },
      (_, i) => i + 1
    ).sort((a, b) => b - a);
    const erc721EscrowTwoSortedTokens = Array.from(
      { length: 50 },
      (_, i) => i + 100
    ).sort((a, b) => b - a);

    await onlyERC721Contracts[0].escrow
      .connect(creatorFour)
      .receiveTokenQueue(erc721EscrowOneSortedTokens, depositKeyBytes32);
    await onlyERC721Contracts[1].escrow
      .connect(creatorFive)
      .receiveTokenQueue(erc721EscrowTwoSortedTokens, depositKeyBytes32);

    //set first ERC1155 escrow contract to reward each tier
    const tokenIdsPayout = [0, 1, 2, 3, 4]; //token ids to pay corresponding to tier indexes
    const tokenIdsAmounts = [0, 2, 2, 3, 3];
    await onlyERC1155Contracts[0].escrow
      .connect(creatorSix)
      .setEscrowSettingsAdvanced(
        ERC1155RewardCondition.EachTier,
        tokenIdsPayout,
        tokenIdsAmounts
      );

    //set second ERC1155 escrow contract to reward a points total
    const tokenIdPayoutOne = 2;
    const tokenIdAmountOne = 3;
    const rewardGoalOne = 5000; //representing 5000 total points
    await onlyERC1155Contracts[1].escrow
      .connect(creatorSeven)
      .setEscrowSettingsBasic(
        ERC1155RewardCondition.PointsTotal,
        tokenIdPayoutOne,
        tokenIdAmountOne,
        rewardGoalOne
      );

    //set third ERC1155 escrow contract to reward a single tier
    const tokenIdPayoutTwo = 1;
    const tokenIdAmountTwo = 1;
    const rewardGoalTwo = 3; //representing tier index 3
    await onlyERC1155Contracts[2].escrow
      .connect(creatorEight)
      .setEscrowSettingsBasic(
        ERC1155RewardCondition.SingleTier,
        tokenIdPayoutTwo,
        tokenIdAmountTwo,
        rewardGoalTwo
      );

    //set loyalty programs to active now that escrow settings are set.
    for (let i = 0; i < contracts.length; i++) {
      await contracts[i].loyalty
        .connect(allCreators[i])
        .setLoyaltyProgramActive();
    }

    //ensure that all escrow states are now InIssuance.
    const {
      escrowStates: escrowStatesAfterSettings,
      loyaltyStates: loyaltyStatesAfterSettings,
    } = await checkContractsState(contracts);

    expect(loyaltyStatesAfterSettings).deep.equal(
      Array(contracts.length).fill(LoyaltyState.Active)
    );
    expect(escrowStatesAfterSettings).deep.equal(
      Array(contracts.length).fill(EscrowState.InIssuance)
    );
  });
  it("tests contract behavior with ERC20 AllTiersComplete rewardCondition with addition of give/deduct points functions", async () => {
    //ensure that AllTiersCompletes rewards tokens if points come from givePoints func...
    //...instead of the user completing objectives.

    const firstProgram = onlyERC20Contracts[0];

    await firstProgram.loyalty
      .connect(creatorOne)
      .givePointsToUser(userOne.address, 7000);

    const firstProgress = await getERC20UserProgress(
      firstProgram.loyalty,
      firstProgram.escrow,
      userOne,
      creatorOne
    );
    expect(firstProgress.points).equal(7000, "Incorrect points");
    expect(firstProgress.currentTier).equal(3, "Incorrect tier");
    expect(firstProgress.balance).equal(
      0,
      "Incorrect - should not have been rewarded yet"
    );

    //give enough to points to move into last tier, making all tiers complete.
    await firstProgram.loyalty
      .connect(creatorOne)
      .givePointsToUser(userOne.address, 800);

    const secondProgress = await getERC20UserProgress(
      firstProgram.loyalty,
      firstProgram.escrow,
      userOne,
      creatorOne
    );

    expect(secondProgress.points).equal(7800, "Incorrect points");
    expect(secondProgress.currentTier).equal(
      4,
      "Incorrect, should now be in final tier"
    );
    expect(secondProgress.balance).equal(
      2,
      "Incorrect - 2 tokens should be rewarded"
    );

    //deduct points and ensure that token balance hasnt changed (once rewarded, they are to stay)
    await firstProgram.loyalty
      .connect(relayer)
      .deductPointsFromUser(userOne.address, 7000);
    const thirdProgress = await getERC20UserProgress(
      firstProgram.loyalty,
      firstProgram.escrow,
      userOne,
      creatorOne
    );
    expect(thirdProgress.balance).equal(2, "Should not have changed");
    expect(thirdProgress.currentTier).equal(1, "Should now be in 1st tier");
    expect(thirdProgress.points).equal(800, "Incorrect");

    //complete an objective and give points, which will bring user back to enough points,
    //where they would complete all tiers again. It SHOULD NOT reward tokens again.

    await firstProgram.loyalty
      .connect(creatorOne)
      .completeCreatorAuthorityObjective(4, userOne.address);
    await firstProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userOne.address, 3000);
    const final = await getERC20UserProgress(
      firstProgram.loyalty,
      firstProgram.escrow,
      userOne,
      creatorOne
    );
    expect(final.points).equal(7800, "Incorrect points");
    expect(final.balance).equal(2, "Should not have changed");
    expect(final.currentTier).equal(4, "Incorrect");
  });
  it("tests contract behavior with ERC20 SingleTier rewardCondition with addition of give/deduct points functions", async () => {
    //the tier that should reward is tier index 2 for program 2.
    //it should reward 4 tokens.
    //ensure that instead of completing objectives, that this processes correctly via
    //the new givePoints func.

    const secondProgram = onlyERC20Contracts[1];

    //give user 4000 points. 4400 is needed for tier 2.
    //ensure no tokens are rewarded yet.
    await secondProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userOne.address, 4000);

    const firstProgress = await getERC20UserProgress(
      secondProgram.loyalty,
      secondProgram.escrow,
      userOne,
      creatorTwo
    );

    expect(firstProgress.balance).equal(0, "Incorrect");
    expect(firstProgress.currentTier).equal(1, "Incorrect tier");
    expect(firstProgress.points).equal(4000, "Incorrect points");

    //give 400 more points which should move user into tier 2 and reward 4 tokens.
    await secondProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userOne.address, 400);
    const secondProgress = await getERC20UserProgress(
      secondProgram.loyalty,
      secondProgram.escrow,
      userOne,
      creatorTwo
    );
    expect(secondProgress.balance).equal(4, "Incorrect balance");
    expect(secondProgress.points).equal(4400, "Incorrect points");
    expect(secondProgress.currentTier).equal(2, "Incorrect tier");

    //deduct points then give the points back by completing an obj to satisfy SingleTier again.
    //ensure that no more tokens were rewarded.
    await secondProgram.loyalty
      .connect(relayer)
      .deductPointsFromUser(userOne.address, 4000);
    const thirdProgress = await getERC20UserProgress(
      secondProgram.loyalty,
      secondProgram.escrow,
      userOne,
      creatorTwo
    );
    expect(thirdProgress.points).equal(400, "Incorrect");
    expect(thirdProgress.currentTier).equal(1, "Incorrect tier");

    await secondProgram.loyalty
      .connect(creatorTwo)
      .completeCreatorAuthorityObjective(4, userOne.address);
    const finalProgress = await getERC20UserProgress(
      secondProgram.loyalty,
      secondProgram.escrow,
      userOne,
      creatorTwo
    );

    expect(finalProgress.balance).equal(4, "Incorrect, should still be 4");
    expect(finalProgress.currentTier).equal(2, "Incorrect tier");
    expect(finalProgress.points).equal(4400, "Incorrect points");
    expect(finalProgress.userObjsComplete).deep.equal([
      false,
      false,
      false,
      false,
      true,
    ]);
  });
  it("tests contract behavior with ERC20 RewardPerTier rewardCondition with addition of give/deduct points functions", async () => {
    //program 3 is RewardPerTier rewardCondition.
    //it should reward each tier, but if points are deducted and the tier is reached,
    //for a second time, it SHOULD NOT reward the tokens again.

    //it rewards these amounts of tokens corresponding to the tier index:
    //tier index 0 can not be used to payout, so 0 is passed.
    //[0, 1, 1, 2, 4]

    const thirdProgram = onlyERC20Contracts[2];

    //earn enough points to be moved into tier 3.
    await thirdProgram.loyalty
      .connect(creatorThree)
      .completeCreatorAuthorityObjective(4, userOne.address);
    await thirdProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userOne.address, 3000);

    const firstProgress = await getERC20UserProgress(
      thirdProgram.loyalty,
      thirdProgram.escrow,
      userOne,
      creatorThree
    );
    expect(firstProgress.points).equal(7000, "Incorrect points");
    expect(firstProgress.currentTier).equal(3, "Incorrect tier");
    expect(firstProgress.balance).equal(
      4,
      "Incorrect balance, 4 total tokens should be rewarded"
    );

    //deduct points, then earn them back, and ensure that tokens are not rewarded again
    await thirdProgram.loyalty
      .connect(relayer)
      .deductPointsFromUser(userOne.address, 3000);
    const secondProgress = await getERC20UserProgress(
      thirdProgram.loyalty,
      thirdProgram.escrow,
      userOne,
      creatorThree
    );
    expect(secondProgress.currentTier).equal(1, "Incorrect tier");
    expect(secondProgress.points).equal(4000, "Incorrect points");
    expect(secondProgress.balance).equal(4, "Should not have changed");

    await thirdProgram.loyalty
      .connect(creatorThree)
      .givePointsToUser(userOne.address, 3000);
    const thirdProgress = await getERC20UserProgress(
      thirdProgram.loyalty,
      thirdProgram.escrow,
      userOne,
      creatorThree
    );
    expect(thirdProgress.balance).equal(
      4,
      "Should not have been rewarded again"
    );
    expect(thirdProgress.currentTier).equal(3, "Incorrect tier");
    expect(thirdProgress.points).equal(7000, "Incorrect points");
  });
  it("tests contract behavior with ERC721 TierReached rewardCondition with addition of give/deduct points functions", async () => {
    //program 4 will reward tokens when a single tier is reached.
    //the reward goal tier was set as tier index 3.
    //reaching tier index 3 should reward an ERC721 token in ascending order.
    //after deducting points and then reaching the tier again, it SHOULD NOT,
    //reward tokens again.

    const fourthProgram = onlyERC721Contracts[0];

    //ensure no tokens rewarded when not enough points for tier 3
    await fourthProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userTwo.address, 6000);
    const firstBal = await fourthProgram.escrow
      .connect(creatorFour)
      .getUserAccount(userTwo.address);

    expect(firstBal.length).equal(0, "Incorrect - no token should be rewarded");

    //give enough points to reach tier 3.
    //ensure that a token was rewarded, which should be token id #1.
    await fourthProgram.loyalty
      .connect(creatorFour)
      .givePointsToUser(userTwo.address, 1000);
    const secondBal = await fourthProgram.escrow
      .connect(creatorFour)
      .getUserAccount(userTwo.address);
    const rewardedTokenId = secondBal.map((tkn: any) => tkn.toNumber());

    expect(secondBal.length).equal(1, "Token should have been rewarded");
    expect(rewardedTokenId).deep.equal(
      [1],
      "Incorrect, tokenId 1 should be rewarded"
    );

    //deduct points and then earn points to reach tier 3 again.
    //ensure that previously rewarded tokens werent rewarded again.
    await fourthProgram.loyalty
      .connect(relayer)
      .deductPointsFromUser(userTwo.address, 6000);
    const progOne = await fourthProgram.loyalty.getUserProgression(
      userTwo.address
    );
    expect(progOne.currentTier.toNumber()).equal(1, "Incorrect tier");
    expect(progOne.rewardsEarned.toNumber()).equal(1000, "Incorrect points");

    await fourthProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userTwo.address, 7000);
    const progTwo = await fourthProgram.loyalty.getUserProgression(
      userTwo.address
    );
    const finalBal = await fourthProgram.escrow
      .connect(creatorFour)
      .getUserAccount(userTwo.address);
    const finalRewardedTokenId = finalBal.map((tkn: any) => tkn.toNumber());

    expect(progTwo.currentTier.toNumber()).equal(4, "Incorrect tier");
    expect(progTwo.rewardsEarned.toNumber()).equal(8000, "Incorrect points");
    expect(finalBal.length).equal(1, "Incorrect - should still have 1 token");
    expect(finalRewardedTokenId).deep.equal(
      [1],
      "Incorrect, tokenId 1 should be rewarded"
    );
  });
  it("tests contract behavior with ERC721 PointsTotal rewardCondition with addition of give/deduct points functions", async () => {
    //program give will reward a token in ascending order once points total is met.
    //points total reward goal was set to 2500 points.

    const fifthProgram = onlyERC721Contracts[1];

    //earn points that SHOULD NOT warrant a token.
    //ensure that it was not.
    await fifthProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userTwo.address, 1000);
    const firstBal = await fifthProgram.escrow
      .connect(creatorFive)
      .getUserAccount(userTwo.address);

    expect(firstBal.length).equal(0, "Incorrect, no token should be rewarded");

    //earn enough points to be rewarded a token.
    //then deduct the points and earn them back again.
    //ensure only 1 token was rewarded. it should be token ID 100.
    await fifthProgram.loyalty
      .connect(creatorFive)
      .givePointsToUser(userTwo.address, 3000);
    const secondBal = await fifthProgram.escrow
      .connect(creatorFive)
      .getUserAccount(userTwo.address);
    const rewardedTokenId = secondBal.map((tkn: any) => tkn.toNumber());

    expect(secondBal.length).equal(1, "Incorrect");
    expect(rewardedTokenId).deep.equal(
      [100],
      "Incorrect, ID 100 should be rewarded"
    );

    const progOne = await fifthProgram.loyalty.getUserProgression(
      userTwo.address
    );
    expect(progOne.rewardsEarned.toNumber()).equal(4000, "Incorrect points");

    await fifthProgram.loyalty
      .connect(relayer)
      .deductPointsFromUser(userTwo.address, 4000);
    const progTwo = await fifthProgram.loyalty.getUserProgression(
      userTwo.address
    );

    expect(progTwo.rewardsEarned.toNumber()).equal(0, "Incorrect points");

    await fifthProgram.loyalty
      .connect(creatorFive)
      .givePointsToUser(userTwo.address, 5000);

    const finalProg = await fifthProgram.loyalty.getUserProgression(
      userTwo.address
    );
    const finalBal = await fifthProgram.escrow
      .connect(creatorFive)
      .getUserAccount(userTwo.address);

    expect(finalProg.rewardsEarned.toNumber()).equal(5000, "Incorrect points");
    expect(finalBal.length).equal(1, "Incorrect, should still be 1 token");
  });
  it("tests contract behavior with ERC1155 EachTier rewardCondition with addition of give/deduct points functions", async () => {
    //program six has EachTier (Reward per tier) rewardCondition
    //it was set to reward these token ids and these amounts corresponding to each tier index
    //first tier index (a default one that was added by contract so users dont start in a tier) was added.
    //so the first index cannot be used to reward tokens, so 0's are passed in.
    //token ids: [0, 1, 2, 3, 4];
    //amounts of token ids: [0, 2, 2, 3, 3];

    //ensure that when earning and deducting points via new functions,
    //that tokens are not rewarded again after already being rewarded.

    //earn enough points to move into tier 3.
    //it should reward 2 token id 1's, 2 token id 2's, and 3 token id 3's.
    //ensure tokens were rewarded.
    const sixthProgram = onlyERC1155Contracts[0];
    await sixthProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userThree.address, 7000);

    const firstProg = await getERC1155UserProgress(
      sixthProgram.loyalty,
      sixthProgram.escrow,
      userThree
    );
    const correctFirstBal = [
      { tokenId: 1, amount: 2 },
      { tokenId: 2, amount: 2 },
      { tokenId: 3, amount: 3 },
    ];

    expect(firstProg.balance).deep.equal(correctFirstBal, "Incorrect balance");
    expect(firstProg.points).equal(7000, "Incorrect points");
    expect(firstProg.currentTier).equal(3, "Incorrect tier");

    //now deduct the points and then earn enough to move to tier index 4.
    //ensure that un-earned token is rewarded for tier 4.
    //ensure that for the other tiers, that tokens are not rewarded again.
    await sixthProgram.loyalty
      .connect(creatorSix)
      .deductPointsFromUser(userThree.address, 7000);
    const secondProg = await getERC1155UserProgress(
      sixthProgram.loyalty,
      sixthProgram.escrow,
      userThree
    );
    expect(secondProg.points).equal(0, "Incorrect points");
    expect(secondProg.balance).deep.equal(correctFirstBal, "Incorrect balance");
    expect(secondProg.currentTier).equal(0, "Incorrect tier");

    await sixthProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userThree.address, 7900);
    const finalProg = await getERC1155UserProgress(
      sixthProgram.loyalty,
      sixthProgram.escrow,
      userThree
    );

    const correctFinalBalance = [...correctFirstBal, { tokenId: 4, amount: 3 }];

    expect(finalProg.balance).deep.equal(
      correctFinalBalance,
      "Incorrect final balance"
    );
    expect(finalProg.points).equal(7900, "Incorrect points");
    expect(finalProg.currentTier).equal(4, "Incorrect, should be in last tier");
    expect(finalProg.userObjsComplete).deep.equal(
      Array(5).fill(false),
      "Incorrect, no objs were completed"
    );
  });
  it("tests contract behavior with ERC11155 PointsTotal rewardCondition with addition of give/deduct points functions", async () => {
    //seventh program is PointsTotal rewardCondition.
    //it was set to payout 3 token id #2's when 5000 total points is met by a user.

    //ensure token isnt rewarded when not enough points from new funcs
    const seventhProgram = onlyERC1155Contracts[1];

    await seventhProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userThree.address, 4000);
    const firstProg = await getERC1155UserProgress(
      seventhProgram.loyalty,
      seventhProgram.escrow,
      userThree
    );

    expect(firstProg.balance.length).equal(
      0,
      "Incorrect - no tokens should be rewarded"
    );
    expect(firstProg.points).equal(4000, "Incorrect points");
    expect(firstProg.currentTier).equal(1, "Incorrect tier");

    //now give 1100 points which satisfies the points total and should reward tokens.
    await seventhProgram.loyalty
      .connect(creatorSeven)
      .givePointsToUser(userThree.address, 1100);
    const secondProg = await getERC1155UserProgress(
      seventhProgram.loyalty,
      seventhProgram.escrow,
      userThree
    );
    const correctFirstBalance = [
      {
        tokenId: 2,
        amount: 3,
      },
    ];
    expect(secondProg.balance).deep.equal(
      correctFirstBalance,
      "Incorrect balance"
    );
    expect(secondProg.points).equal(5100, "Incorrect points");
    expect(secondProg.currentTier).equal(2, "Incorrect tier");

    //now deduct points and then earn them back.
    //ensure the points total is not rewarded for again.
    await seventhProgram.loyalty
      .connect(relayer)
      .deductPointsFromUser(userThree.address, 5000);
    const thirdProg = await getERC1155UserProgress(
      seventhProgram.loyalty,
      seventhProgram.escrow,
      userThree
    );

    expect(thirdProg.balance).deep.equal(
      correctFirstBalance,
      "Should not have changed"
    );
    expect(thirdProg.points).equal(100, "Incorrect points");
    expect(thirdProg.currentTier).equal(0, "Incorrect tier");

    await seventhProgram.loyalty
      .connect(creatorSeven)
      .givePointsToUser(userThree.address, 7000);
    const finalProg = await getERC1155UserProgress(
      seventhProgram.loyalty,
      seventhProgram.escrow,
      userThree
    );

    expect(finalProg.balance).deep.equal(
      correctFirstBalance,
      "Should not have changed"
    );
    expect(finalProg.points).equal(7100, "Incorrect points");
    expect(finalProg.currentTier).equal(3, "Incorrect tier");
    expect(finalProg.userObjsComplete).deep.equal(
      Array(5).fill(false),
      "Incorrect, no objs were completed"
    );
  });
  it("tests contract behavior with ERC1155 SingleTier rewardCondition with addition of give/deduct points functions", async () => {
    //the sixth program has SingleTier rewardCondition.
    //it was set to payout 1 token id #1 when tier index 3 is reached (7000 points).
    //when points are deducted and then gained back, it should not re-reward tokens

    //ensure points arent rewarded when not enough points
    const eigthProgram = onlyERC1155Contracts[2];

    await eigthProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userThree.address, 4000);
    const firstProg = await getERC1155UserProgress(
      eigthProgram.loyalty,
      eigthProgram.escrow,
      userThree
    );
    expect(firstProg.balance.length).equal(0, "No tokens should be rewarded");
    expect(firstProg.points).equal(4000, "Incorrect points");
    expect(firstProg.currentTier).equal(1, "Incorrect tier");

    //give enough points to reach tier 3.
    //ensure tokens were rewarded.
    await eigthProgram.loyalty
      .connect(creatorEight)
      .givePointsToUser(userThree.address, 3000);
    const secondProg = await getERC1155UserProgress(
      eigthProgram.loyalty,
      eigthProgram.escrow,
      userThree
    );
    const correctFirstBalance = [
      {
        tokenId: 1,
        amount: 1,
      },
    ];
    expect(secondProg.balance).deep.equal(
      correctFirstBalance,
      "Incorrect, token should be rewarded"
    );
    expect(secondProg.points).equal(7000, "Incorrect points");
    expect(secondProg.currentTier).equal(3, "Incorrect tier");

    //now deduct points and earn them back, ensure tokens are not rewarded again
    await eigthProgram.loyalty
      .connect(relayer)
      .deductPointsFromUser(userThree.address, 4000);
    const thirdProg = await getERC1155UserProgress(
      eigthProgram.loyalty,
      eigthProgram.escrow,
      userThree
    );
    expect(thirdProg.balance).deep.equal(
      correctFirstBalance,
      "Should not have changd"
    );
    expect(thirdProg.points).equal(3000, "Incorrect points");
    expect(thirdProg.currentTier).equal(1, "Incorrect tier");

    await eigthProgram.loyalty
      .connect(creatorEight)
      .completeCreatorAuthorityObjective(4, userThree.address);
    await eigthProgram.loyalty
      .connect(relayer)
      .givePointsToUser(userThree.address, 1000);
    const finalProg = await getERC1155UserProgress(
      eigthProgram.loyalty,
      eigthProgram.escrow,
      userThree
    );

    expect(finalProg.balance).deep.equal(
      correctFirstBalance,
      "Should not have changed"
    );
    expect(finalProg.points).equal(8000, "Incorrect points");
    expect(finalProg.currentTier).equal(4, "Incorrect tier");
    expect(finalProg.userObjsComplete).deep.equal(
      [false, false, false, false, true],
      "Incorrect, 1 obj was completed"
    );
  });
});
