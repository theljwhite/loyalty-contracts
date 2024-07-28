// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../LoyaltyProgram.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract LoyaltyERC20Escrow {
    using SafeERC20 for IERC20;

    enum EscrowState {
        Idle,
        AwaitingEscrowSettings,
        InIssuance,
        Completed,
        Frozen,
        Canceled
    }

    enum RewardCondition {
        NotSet,
        AllObjectivesComplete,
        SingleObjective,
        AllTiersComplete,
        SingleTier,
        PointsTotal,
        RewardPerObjective,
        RewardPerTier
    }

    event ERC20Deposit(
        address sender,
        address token,
        uint256 amount,
        uint256 depositedAt
    );
    event ERC20Rewarded(address user, uint256 amount, uint256 rewardedAt);
    event ERC20UserWithdraw(address user, uint256 amount, uint256 withdrawnAt);
    event ERC20CreatorWithdraw(
        address creator,
        uint256 amount,
        uint256 withdrawnAt
    );
    event FrozenStateChange(address team, bool frozen, uint256 updatedAt);

    string public constant VERSION = "0.03";
    address public constant TEAM_ADDRESS =
        0xe63DC839fA2a6A418Af4B417cD45e257dD76f516;
    uint256 public PAYOUT_BUFFER = 4;
    uint256 public MAX_DEPOSITORS = 2;

    LoyaltyProgram public loyaltyProgram;
    address public loyaltyProgramAddress;
    address public creator;
    uint256 public loyaltyProgramEndsAt;

    IERC20 rewardToken;
    address public rewardTokenAddress;

    mapping(address => bool) isApprovedSender;
    mapping(address => bool) isApprovedToken;
    mapping(bytes32 => bool) validDepositKeys;

    uint256 public escrowBalance;
    uint256 private depositStartDate;
    uint256 private depositEndDate;
    bool private isDepositKeySet;
    bool public allFundsLocked;

    RewardCondition rewardCondition;
    uint256 public rewardGoal;
    uint256 public payoutAmount;
    mapping(address => uint256) userBalance;
    mapping(address => mapping(uint256 => bool)) rewardGoalRewarded;
    mapping(uint256 => uint256) payoutIndexToAmount;

    bool public canceled;
    bool public areEscrowSettingsSet;

    error OnlyCreatorCanCall();
    error OnlyTeamCanCall();
    error OnlyLoyaltyProgramCanCall();
    error CannotDeposit();
    error NotInIssuance();

    error DepositPeriodMustBeAtLeastOneHour();
    error DepositEndDateExceedsProgramEnd();
    error DepositPeriodNotActive();
    error DepositPeriodMustBeFinished();
    error CannotBeEmptyAmount();
    error InsuffEscrowBal();

    error IncorrectRewardCondition();
    error MustSetValidRewardCondition();
    error MustSetValidRewardGoal();

    error MustUseValidObjectiveIndex();
    error MustUseValidTierIndex();
    error ObjectivesAndPayoutLengthMismatch();
    error TiersAndPayoutLengthMismatch();
    error TierIndex0CannotPayout();
    error TiersMustBeActive();
    error FundsAreLocked();
    error InsufficientFunds();
    error MustWithdrawPositiveAmount();
    error ProgramNotCompleted();
    error ExceededMaxDepositors();

    constructor(
        address _loyaltyProgramAddress,
        address _creator,
        uint256 _programEndsAt,
        address _rewardTokenAddress,
        address[] memory _approvedDepositors
    ) {
        loyaltyProgram = LoyaltyProgram(_loyaltyProgramAddress);
        loyaltyProgramAddress = _loyaltyProgramAddress;
        creator = _creator;
        loyaltyProgramEndsAt = _programEndsAt;

        if (_approvedDepositors.length > MAX_DEPOSITORS) {
            revert ExceededMaxDepositors();
        }

        for (uint256 i = 0; i < _approvedDepositors.length; i++) {
            isApprovedSender[_approvedDepositors[i]] = true;
        }
        isApprovedToken[_rewardTokenAddress] = true;
        isApprovedSender[_creator] = true;

        rewardToken = IERC20(_rewardTokenAddress);
        rewardTokenAddress = _rewardTokenAddress;
    }

    function version() public pure returns (string memory) {
        return VERSION;
    }

    function escrowState() public view returns (EscrowState) {
        if (
            canceled ||
            loyaltyProgram.state() == LoyaltyProgram.LoyaltyState.Canceled
        ) {
            return EscrowState.Canceled;
        }
        if (allFundsLocked) return EscrowState.Frozen;

        if (!areEscrowSettingsSet) return EscrowState.AwaitingEscrowSettings;

        if (
            areEscrowSettingsSet &&
            loyaltyProgram.state() == LoyaltyProgram.LoyaltyState.Active
        ) return EscrowState.InIssuance;

        if (loyaltyProgram.state() == LoyaltyProgram.LoyaltyState.Completed)
            return EscrowState.Completed;

        return EscrowState.Idle;
    }

    function depositBudget(
        uint256 _amount,
        bytes memory _key
    ) external returns (uint256) {
        if (!isSenderApproved(msg.sender)) revert CannotDeposit();
        if (
            escrowState() != EscrowState.AwaitingEscrowSettings &&
            escrowState() != EscrowState.InIssuance &&
            escrowState() != EscrowState.Idle
        ) {
            revert DepositPeriodNotActive();
        }
        if (_amount == 0) revert CannotBeEmptyAmount();

        bytes32 depositKey;

        assembly {
            depositKey := mload(add(_key, 32))
        }

        if (!validDepositKeys[depositKey]) revert CannotDeposit();

        rewardToken.safeIncreaseAllowance(address(this), _amount);
        rewardToken.safeTransferFrom(msg.sender, address(this), _amount);

        escrowBalance += _amount;

        emit ERC20Deposit(
            msg.sender,
            rewardTokenAddress,
            _amount,
            block.timestamp
        );

        return rewardToken.balanceOf(msg.sender);
    }

    function handleRewardsUnlock(
        address _user,
        uint256 _objIndex,
        uint256 _tierIndex,
        uint256[] memory _passedTiers
    ) external {
        if (msg.sender != loyaltyProgramAddress)
            revert OnlyLoyaltyProgramCanCall();
        if (escrowState() != EscrowState.InIssuance) revert NotInIssuance();
        if (rewardCondition == RewardCondition.NotSet)
            revert IncorrectRewardCondition();

        if (
            rewardCondition == RewardCondition.RewardPerTier ||
            rewardCondition == RewardCondition.SingleTier ||
            rewardCondition == RewardCondition.AllTiersComplete
        ) {
            processTierRewards(_user, _tierIndex, _passedTiers);
        } else if (
            rewardCondition == RewardCondition.AllObjectivesComplete ||
            rewardCondition == RewardCondition.PointsTotal
        ) {
            processUserProgressionRewards(_user);
        } else {
            processObjectiveRewards(_user, _objIndex);
        }
    }

    function processTierRewards(
        address _user,
        uint256 _tierIndex,
        uint256[] memory _passedTiers
    ) private {
        if (msg.sender != loyaltyProgramAddress)
            revert OnlyLoyaltyProgramCanCall();
        if (escrowState() != EscrowState.InIssuance) revert NotInIssuance();

        if (rewardCondition == RewardCondition.RewardPerTier) {
            for (uint256 i = 0; i < _passedTiers.length; i++) {
                uint256 tierIndex = _passedTiers[i];
                bool alreadyRewardedTier = rewardGoalRewarded[_user][tierIndex];
                uint256 amount = payoutIndexToAmount[tierIndex];
                if (
                    !alreadyRewardedTier &&
                    tierIndex != 0 &&
                    escrowBalance >= amount
                ) {
                    rewardGoalRewarded[_user][tierIndex] = true;
                    userBalance[_user] += amount;
                    escrowBalance -= amount;
                    emit ERC20Rewarded(_user, amount, block.timestamp);
                }
            }
        } else if (rewardCondition == RewardCondition.SingleTier) {
            bool tierAlreadyRewarded = rewardGoalRewarded[_user][rewardGoal];
            if (
                _tierIndex >= rewardGoal &&
                !tierAlreadyRewarded &&
                escrowBalance >= payoutAmount
            ) {
                rewardGoalRewarded[_user][rewardGoal] = true;
                userBalance[_user] += payoutAmount;
                escrowBalance -= payoutAmount;
                emit ERC20Rewarded(_user, payoutAmount, block.timestamp);
            }
        } else {
            bool tierAlreadyRewarded = rewardGoalRewarded[_user][rewardGoal];
            if (
                _tierIndex == rewardGoal &&
                !tierAlreadyRewarded &&
                escrowBalance >= payoutAmount
            ) {
                rewardGoalRewarded[_user][rewardGoal] = true;
                userBalance[_user] += payoutAmount;
                escrowBalance -= payoutAmount;
                emit ERC20Rewarded(_user, payoutAmount, block.timestamp);
            }
        }
    }

    function processUserProgressionRewards(address _user) private {
        bool userAlreadyRewarded = rewardGoalRewarded[_user][rewardGoal];
        bool escrowHasFunds = escrowBalance >= payoutAmount;
        if (rewardCondition == RewardCondition.AllObjectivesComplete) {
            uint256 objectivesCompleteCount = loyaltyProgram
                .getUserObjectivesCompleteCount(_user);
            if (
                objectivesCompleteCount == rewardGoal &&
                !userAlreadyRewarded &&
                escrowHasFunds
            ) {
                rewardGoalRewarded[_user][rewardGoal] = true;
                userBalance[_user] += payoutAmount;
                escrowBalance -= payoutAmount;
                emit ERC20Rewarded(_user, payoutAmount, block.timestamp);
            }
        } else if (rewardCondition == RewardCondition.PointsTotal) {
            (uint256 rewardsEarned, ) = loyaltyProgram.getUserProgression(
                _user
            );
            if (
                rewardsEarned >= rewardGoal &&
                !userAlreadyRewarded &&
                escrowHasFunds
            ) {
                rewardGoalRewarded[_user][rewardGoal] = true;
                userBalance[_user] += payoutAmount;
                escrowBalance -= payoutAmount;
                emit ERC20Rewarded(_user, payoutAmount, block.timestamp);
            }
        }
    }

    function processObjectiveRewards(address _user, uint256 _objIndex) private {
        if (rewardCondition == RewardCondition.RewardPerObjective) {
            bool objAlreadyRewarded = rewardGoalRewarded[_user][_objIndex];
            uint256 amount = payoutIndexToAmount[_objIndex];
            if (!objAlreadyRewarded && escrowBalance >= amount) {
                rewardGoalRewarded[_user][_objIndex] = true;
                userBalance[_user] += amount;
                escrowBalance -= amount;
                emit ERC20Rewarded(_user, amount, block.timestamp);
            }
        } else if (rewardCondition == RewardCondition.SingleObjective) {
            bool alreadyRewarded = rewardGoalRewarded[_user][rewardGoal];
            if (
                _objIndex == rewardGoal &&
                !alreadyRewarded &&
                escrowBalance >= payoutAmount
            ) {
                rewardGoalRewarded[_user][_objIndex] = true;
                userBalance[_user] += payoutAmount;
                escrowBalance -= payoutAmount;
                emit ERC20Rewarded(_user, payoutAmount, block.timestamp);
            }
        }
    }

    function setEscrowSettingsBasic(
        RewardCondition _rewardCondition,
        uint256 _rewardGoal,
        uint256 _rewardAmount
    ) external {
        if (_rewardAmount == 0) revert CannotBeEmptyAmount();

        runSetEscrowSettingsChecks(_rewardCondition);

        if (
            _rewardCondition == RewardCondition.RewardPerObjective &&
            _rewardCondition == RewardCondition.RewardPerTier
        ) {
            revert MustSetValidRewardCondition();
        }

        if (escrowBalance < _rewardAmount * PAYOUT_BUFFER)
            revert InsuffEscrowBal();

        if (_rewardCondition == RewardCondition.AllObjectivesComplete) {
            rewardGoal = loyaltyProgram.getObjectives().length;
            payoutAmount = _rewardAmount;
        } else if (_rewardCondition == RewardCondition.AllTiersComplete) {
            rewardGoal = loyaltyProgram.tierCount() - 1;
            payoutAmount = _rewardAmount;
        } else if (_rewardCondition == RewardCondition.SingleObjective) {
            uint256 objectivesLength = loyaltyProgram.getObjectives().length;
            if (_rewardGoal == 0 || _rewardGoal >= objectivesLength) {
                revert MustUseValidObjectiveIndex();
            }
            rewardGoal = _rewardGoal;
            payoutAmount = _rewardAmount;
        } else if (_rewardCondition == RewardCondition.SingleTier) {
            if (_rewardGoal == 0 || _rewardGoal >= loyaltyProgram.tierCount()) {
                revert MustUseValidTierIndex();
            }
            rewardGoal = _rewardGoal;
            payoutAmount = _rewardAmount;
        } else {
            if (
                _rewardGoal == 0 ||
                _rewardGoal > loyaltyProgram.totalPointsPossible()
            ) {
                revert MustSetValidRewardGoal();
            }
            rewardGoal = _rewardGoal;
            payoutAmount = _rewardAmount;
        }

        areEscrowSettingsSet = true;
        rewardCondition = _rewardCondition;
    }

    function setEscrowSettingsAdvanced(
        RewardCondition _rewardCondition,
        uint256[] calldata _payouts
    ) external {
        runSetEscrowSettingsChecks(_rewardCondition);

        if (
            _rewardCondition != RewardCondition.RewardPerObjective &&
            _rewardCondition != RewardCondition.RewardPerTier
        ) {
            revert MustSetValidRewardCondition();
        }
        verifyTokenBalance(_payouts);

        if (_rewardCondition == RewardCondition.RewardPerObjective) {
            uint256 objectivesLength = loyaltyProgram.getObjectives().length;
            if (objectivesLength != _payouts.length) {
                revert ObjectivesAndPayoutLengthMismatch();
            }
            for (uint256 i = 0; i < objectivesLength; i++) {
                payoutIndexToAmount[i] = _payouts[i];
            }
            rewardCondition = RewardCondition.RewardPerObjective;
        } else {
            uint256 tierCount = loyaltyProgram.tierCount();
            if (tierCount == 0) revert TiersMustBeActive();
            if (tierCount != _payouts.length)
                revert TiersAndPayoutLengthMismatch();
            if (_payouts[0] != 0) revert TierIndex0CannotPayout();
            for (uint256 i = 0; i < tierCount; i++) {
                payoutIndexToAmount[i] = _payouts[i];
            }
            rewardCondition = RewardCondition.RewardPerTier;
        }
        areEscrowSettingsSet = true;
    }

    function verifyTokenBalance(uint256[] calldata _payouts) private view {
        uint256 totalPayouts = 0;
        for (uint256 i = 0; i < _payouts.length; i++) {
            totalPayouts += _payouts[i];
        }
        if (escrowBalance < totalPayouts * PAYOUT_BUFFER)
            revert InsuffEscrowBal();
    }

    function runSetEscrowSettingsChecks(
        RewardCondition _rewardCondition
    ) private view {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (escrowState() != EscrowState.AwaitingEscrowSettings)
            revert DepositPeriodMustBeFinished();
        if (_rewardCondition == RewardCondition.NotSet)
            revert MustSetValidRewardCondition();
    }

    function userWithdrawAll() external returns (uint256) {
        if (escrowState() == EscrowState.Frozen) revert FundsAreLocked();

        uint256 balance = userBalance[msg.sender];
        if (balance == 0) revert InsufficientFunds();

        rewardToken.safeTransfer(msg.sender, balance);
        userBalance[msg.sender] = 0;

        emit ERC20UserWithdraw(msg.sender, balance, block.timestamp);
        return rewardToken.balanceOf(msg.sender);
    }

    function userWithdraw(uint256 _amount) external returns (uint256) {
        if (escrowState() == EscrowState.Frozen) revert FundsAreLocked();
        if (_amount == 0) revert MustWithdrawPositiveAmount();

        uint256 balance = userBalance[msg.sender];
        if (balance == 0 || _amount > balance) revert InsufficientFunds();

        rewardToken.safeTransfer(msg.sender, _amount);
        userBalance[msg.sender] -= _amount;

        emit ERC20UserWithdraw(msg.sender, _amount, block.timestamp);
        return rewardToken.balanceOf(msg.sender);
    }

    function creatorWithdrawAll() external returns (uint256) {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (escrowBalance == 0) revert InsufficientFunds();
        if (escrowState() == EscrowState.Frozen) revert FundsAreLocked();
        if (
            escrowState() != EscrowState.Completed &&
            escrowState() != EscrowState.Canceled
        ) revert ProgramNotCompleted();

        uint256 amount = escrowBalance;
        rewardToken.safeTransfer(msg.sender, amount);
        escrowBalance = 0;

        emit ERC20CreatorWithdraw(msg.sender, amount, block.timestamp);
        return rewardToken.balanceOf(msg.sender);
    }

    function creatorWithdraw(uint256 _amount) external returns (uint256) {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (escrowBalance == 0 || _amount == 0) revert InsufficientFunds();
        if (escrowState() == EscrowState.Frozen) revert FundsAreLocked();
        if (
            escrowState() != EscrowState.Completed &&
            escrowState() != EscrowState.Canceled
        ) revert ProgramNotCompleted();

        rewardToken.safeTransfer(msg.sender, _amount);
        escrowBalance -= _amount;

        emit ERC20CreatorWithdraw(msg.sender, _amount, block.timestamp);
        return rewardToken.balanceOf(msg.sender);
    }

    function isTokenApproved(address _token) public view returns (bool) {
        return isApprovedToken[_token];
    }

    function isSenderApproved(address _sender) public view returns (bool) {
        return isApprovedSender[_sender];
    }

    function setDepositKey(bytes32 key) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (escrowState() != EscrowState.AwaitingEscrowSettings) {
            revert();
        }
        validDepositKeys[key] = true;
        isDepositKeySet = true;
    }

    function emergencyFreeze(bool _isFrozen) external {
        if (msg.sender != TEAM_ADDRESS && msg.sender != creator)
            revert OnlyTeamCanCall();
        allFundsLocked = _isFrozen;
        emit FrozenStateChange(msg.sender, _isFrozen, block.timestamp);
    }

    function cancelProgramEscrow() external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        canceled = true;
    }

    function lookupUserBalance(address _user) external view returns (uint256) {
        require(
            msg.sender == creator || msg.sender == TEAM_ADDRESS,
            "Must be creator or team"
        );
        return userBalance[_user];
    }

    function lookupEscrowBalance() external view returns (uint256) {
        return escrowBalance;
    }

    //TEMP: temp for testing
    function getPayoutAmountFromIndex(
        uint256 _payoutIndex
    ) public view returns (uint256) {
        return payoutIndexToAmount[_payoutIndex];
    }
}
