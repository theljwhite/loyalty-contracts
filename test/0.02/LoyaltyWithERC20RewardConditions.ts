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
} from "../../utils/deployLoyaltyUtils";
import { depositKeyBytes32 } from "../../constants/basicLoyaltyConstructorArgs";

let accounts: SignerWithAddress[] = [];
let creatorOne: SignerWithAddress;
let creatorTwo: SignerWithAddress;
let creatorThree: SignerWithAddress;
let creatorFour: SignerWithAddress;
let creatorFive: SignerWithAddress;
let creatorSix: SignerWithAddress;
let creatorSeven: SignerWithAddress;

let userOne: SignerWithAddress;
let userTwo: SignerWithAddress;
let userThree: SignerWithAddress;

const contracts: CreatorContracts[] = [];
let loyaltyCreators: SignerWithAddress[] = [];

let testToken: any;
let testTokenDeployer: SignerWithAddress;

describe("LoyaltyProgram", () => {
  before(async () => {
    accounts = await hre.ethers.getSigners();
    testTokenDeployer = accounts[0];

    creatorOne = accounts[1];
    creatorTwo = accounts[2];
    creatorThree = accounts[3];
    creatorFour = accounts[4];
    creatorFive = accounts[5];
    creatorSix = accounts[6];
    creatorSeven = accounts[7];

    userOne = accounts[10];
    userTwo = accounts[11];
    userThree = accounts[12];

    loyaltyCreators = [
      creatorOne,
      creatorTwo,
      creatorThree,
      creatorFour,
      creatorFive,
      creatorSix,
      creatorSeven,
    ];

    //deploy ERC20 test token to be used as rewards for escrow contracts
    testToken = await hre.ethers.deployContract("AdajToken");

    //transfer test ERC20 tokens to all creators to be used for rewards depositing
    const creatorInitialBalances: number[] = [];
    for (let i = 0; i < loyaltyCreators.length; i++) {
      await testToken.transfer(loyaltyCreators[i].address, 1_000_000);
      const balance = await testToken.balanceOf(loyaltyCreators[i].address);
      creatorInitialBalances.push(balance);
    }
    const creatorInitBalancesToNum = creatorInitialBalances.map((bal: any) =>
      bal.toNumber()
    );
    expect(creatorInitBalancesToNum).deep.equal(
      Array(loyaltyCreators.length).fill(1_000_000),
      "Incorrect initial creator balance"
    );

    //deploy 7 loyalty programs, 1 for each creator, to later test each ERC20 rewardCondition.
    const useTiers = true;
    for (const loyaltyCreator of loyaltyCreators) {
      const { loyaltyAddress, escrowAddress, loyaltyContract, escrowContract } =
        await deployProgramAndSetUpUntilDepositPeriod(
          "0_02",
          RewardType.ERC20,
          useTiers,
          loyaltyCreator,
          testToken.address
        );
      contracts.push({
        loyaltyAddress: loyaltyAddress,
        escrowAddress: escrowAddress ?? "",
        escrow: escrowContract,
        loyalty: loyaltyContract,
      });
    }

    //ensure initial state is correct for each contract
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

  it("deposits ERC20 tokens into each escrow contract and sets escrow settings in order to further test ERC20 rewardConditions", async () => {
    //deposit ERC20 tokens into each of the 7 escrow contracts to be used as rewards.
    const tokenAmountsToDeposit = [500, 500, 500, 10_000, 20_000, 200, 1000];

    for (let i = 0; i < contracts.length; i++) {
      await testToken
        .connect(loyaltyCreators[i])
        .increaseAllowance(
          contracts[i].escrowAddress,
          tokenAmountsToDeposit[i]
        );
      await contracts[i].escrow
        .connect(loyaltyCreators[i])
        .depositBudget(tokenAmountsToDeposit[i], testToken.address);
    }

    //move time forward 3+ days so that deposit periods are over for each escrow contract.
    await moveTime(THREE_DAYS_MS);

    //ensure escrow states are now AwaitingEscrowSettings
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

    //set escrow settings in each escrow contract to further test all ERC20 reward conditions.
    //for "basic" reward conditions, setEscrowSettingsBasic function is used.
    //for "advanced" reward conditions, setEscrowSettingsAdvanced function is used.

    //rewardGoal in setEscrowSettingsBasic represents either desired tier index to reward,
    //or desired objective index to reward, or the PointsTotal to reward.
    //it is not needed for AllObjectivesComplete and AllTiersComplete, so can pass in 0.

    //for the "basic" conditions, since they are "one-off" conditions,
    //pass in the rewardAmount (ERC20 token value) for completing the condition.

    const escrowOneRewardAmount = 20;
    await contracts[0].escrow
      .connect(creatorOne)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.AllObjectivesComplete,
        0,
        escrowOneRewardAmount
      );

    const escrowTwoRewardAmount = 20;
    await contracts[1].escrow
      .connect(creatorTwo)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.AllTiersComplete,
        0,
        escrowTwoRewardAmount
      );

    const escrowThreeRewardAmount = 10;
    const escrowThreeRewardGoalObjIndex = 3;
    await contracts[2].escrow
      .connect(creatorThree)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.SingleObjective,
        escrowThreeRewardGoalObjIndex,
        escrowThreeRewardAmount
      );

    const escrowFourRewardAmount = 200;
    const escrowFourRewardGoalTierIndex = 2;
    await contracts[3].escrow
      .connect(creatorFour)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.SingleTier,
        escrowFourRewardGoalTierIndex,
        escrowFourRewardAmount
      );

    const escrowFiveRewardAmount = 1000;
    const escrowFiveRewardGoalPoints = 7000;
    await contracts[4].escrow
      .connect(creatorFive)
      .setEscrowSettingsBasic(
        ERC20RewardCondition.PointsTotal,
        escrowFiveRewardGoalPoints,
        escrowFiveRewardAmount
      );

    //for the "advanced" conditions, RewardPerObjective and RewardPerTier,
    //use setEscrowSettingsAdvanced.
    //payouts array corresponds to tier indexes or objective indexes.
    //it represents the amount of ERC20 to reward per objective or tier completion.

    const escrowSixPayouts = [2, 2, 3, 4, 5]; //corresponding to objective indexes
    await contracts[5].escrow
      .connect(creatorSix)
      .setEscrowSettingsAdvanced(
        ERC20RewardCondition.RewardPerObjective,
        escrowSixPayouts
      );

    //first tier index is not allowed to payout, or contract will revert by design.
    //so pass in 0 as the first index.
    const escrowSevenPayouts = [0, 20, 30, 40, 80]; //corresponding to tier indexes
    await contracts[6].escrow
      .connect(creatorSeven)
      .setEscrowSettingsAdvanced(
        ERC20RewardCondition.RewardPerTier,
        escrowSevenPayouts
      );

    //set loyalty programs to active now that settings are set.
    for (let i = 0; i < contracts.length; i++) {
      await contracts[i].loyalty
        .connect(loyaltyCreators[i])
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
});
