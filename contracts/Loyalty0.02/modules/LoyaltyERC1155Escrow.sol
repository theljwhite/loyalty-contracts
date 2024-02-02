// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../LoyaltyProgram.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LoyaltyERC1155Escrow is ERC1155Holder, Ownable {
    enum EscrowState {
        Idle,
        AwaitingEscrowApprovals,
        DepositPeriod,
        AwaitingEscrowSettings,
        InIssuance,
        Completed,
        Frozen,
        Canceled
    }

    enum RewardCondition {
        NotSet,
        EachObjective,
        SingleObjective,
        EachTier,
        SingleTier,
        PointsTotal
    }

    struct UserAccount {
        bool allFundsLocked;
        bool allFundsPaid;
        UserTokenBalance[] rewardedTokenBalances;
        mapping(uint256 => bool) rewardGoalRewarded;
    }

    struct UserTokenBalance {
        uint256 tokenId;
        uint256 amount;
    }

    struct Escrow {
        uint256 totalTokenIds;
        uint256 rewardGoal;
        address collectionAddress;
        RewardCondition rewardCondition;
        Token[] tokens;
        bool allFundsPaid;
    }

    struct EscrowPayoutDetails {
        uint256 tokenId;
        uint256 amount;
    }

    struct Token {
        uint256 id;
        uint256 value;
    }

    event ERC1155TokenReceived(
        address indexed collection,
        address indexed sender,
        uint256 tokenId,
        uint256 receivedAt
    );
    event ERC1155BatchReceived(
        address indexed collection,
        address indexed sender,
        uint256[] tokenIds,
        uint256 receivedAt
    );
    event ERC1155EscrowSettingsChanged(
        address indexed creator,
        RewardCondition rewardCondition,
        uint256 updatedAt
    );
    event ERC1155SenderApproved(
        address sender,
        address approvedBy,
        uint256 approvedAt
    );
    event ERC1155CollectionApproved(
        address collection,
        address approvedBy,
        uint256 approvedAt
    );
    event ERC1155Rewarded(
        address user,
        uint256 token,
        uint256 amount,
        uint256 rewardedAt
    );
    event CreatorWithdrawAll(
        address creator,
        uint256[] tokenIds,
        uint256[] amounts,
        uint256 withdrawnAt
    );
    event UserWithdrawAll(
        address user,
        uint256[] tokenIds,
        uint256[] amounts,
        uint256 withdrawnAt
    );
    event CreatorWithdraw(
        address creator,
        uint256 tokenId,
        uint256 amount,
        uint256 withdrawnAt
    );
    event FrozenStateChange(address team, bool frozen, uint256 updatedAt);

    LoyaltyProgram public loyaltyProgram;
    address public loyaltyProgramAddress;
    address public constant TEAM_ADDRESS =
        0x262dE7a263d23BeA5544b7a0BF08F2c00BFABE7b;
    address public creator;
    uint256 public constant PAYOUT_BUFFER = 4;
    uint256 public maxTokenIdsAllowed = 5;

    uint256 private escrowApprovalsCount;
    uint256 loyaltyProgramEndsAt;
    uint256 depositStartDate;
    uint256 depositEndDate;
    bool public isAwaitingEscrowApprovals;
    bool public isAwaitingEscrowSettings;
    bool public isAwaitingDeposit;
    bool public areEscrowSettingsSet;
    bool public inIssuance;
    bool public completed;
    bool public allFundsLocked;
    bool public canceled;

    mapping(address => bool) isApprovedSender;
    mapping(address => bool) isCollectionLoyaltyProgramApproved;
    mapping(bytes32 => bool) private validDepositKeys;

    mapping(address => UserAccount) userAccount;
    Escrow public escrow;
    mapping(uint256 => uint256) tokenBalances;
    mapping(uint256 => EscrowPayoutDetails) payoutIndexToPayouts;

    error OnlyTeamCanCall();
    error OnlyCreatorCanCall();

    error ExceededMaxTokenIdsAmount();
    error OnlyLoyaltyProgramCanCall();

    error LoyaltyProgramMustBeIdle();
    error LoyaltyProgramMustBeCompleted();
    error IncorrectRewardType();
    error IncorrectRewardCondition();
    error DepositsAreLocked();
    error DepositPeriodMustBeAtLeastOneHour();
    error DepositPeriodMustBeFinished();
    error DepositEndDateExceedsProgramEnd();

    error TokenIdsAndPayoutsLengthMismatch();
    error TokenIdsAndValuesLengthMismatch();

    error TiersMustBeActiveToUseTiersRewardCondition();
    error MustUseEachObjectiveOrEachTierRewardCondition();
    error MustUseSingleObjectiveSingleTierOrPointsTotal();

    error PayoutCannotBeZero();
    error InsufficientBalanceForATokenId();

    error NotInIssuance();
    error AllRewardsPaid();
    error NoTokensToWithdraw();
    error FundsAreLocked();

    constructor(
        address _loyaltyProgramAddress,
        address _creator,
        uint256 _programEndsAt
    ) {
        creator = _creator;
        loyaltyProgram = LoyaltyProgram(_loyaltyProgramAddress);
        loyaltyProgramAddress = _loyaltyProgramAddress;
        isAwaitingEscrowApprovals = true;
        loyaltyProgramEndsAt = _programEndsAt;
    }

    function version() public pure returns (string memory) {
        return "0.01";
    }

    function escrowState() public view returns (EscrowState) {
        if (
            canceled ||
            loyaltyProgram.state() == LoyaltyProgram.LoyaltyState.Canceled
        ) {
            return EscrowState.Canceled;
        }
        if (allFundsLocked) return EscrowState.Frozen;

        if (isAwaitingEscrowApprovals && escrowApprovalsCount < 3)
            return EscrowState.AwaitingEscrowApprovals;

        if (
            escrowApprovalsCount == 3 &&
            depositStartDate <= block.timestamp &&
            depositEndDate >= block.timestamp
        ) {
            return EscrowState.DepositPeriod;
        }
        if (
            escrowApprovalsCount == 3 &&
            block.timestamp > depositEndDate &&
            !areEscrowSettingsSet
        ) {
            return EscrowState.AwaitingEscrowSettings;
        }
        if (
            inIssuance &&
            loyaltyProgram.state() == LoyaltyProgram.LoyaltyState.Active
        ) {
            return EscrowState.InIssuance;
        }

        if (
            loyaltyProgram.state() == LoyaltyProgram.LoyaltyState.Completed ||
            escrow.allFundsPaid
        ) {
            return EscrowState.Completed;
        }

        return EscrowState.Idle;
    }

    function onERC1155Received(
        address _operator,
        address _from,
        uint256 _tokenId,
        uint256 _value,
        bytes memory _data
    ) public virtual override returns (bytes4) {
        require(
            isSenderApproved(_from) && isSenderApproved(_operator),
            "Not an approved sender"
        );
        require(
            isCollectionApproved(_msgSender()),
            "Collection not approved for this loyalty program"
        );
        require(_data.length >= 32, "Invalid data length");

        bytes32 depositKey;

        assembly {
            depositKey := mload(add(_data, 32))
        }
        require(validDepositKeys[depositKey], "Invalid deposit key");

        if (escrowState() != EscrowState.DepositPeriod) {
            revert DepositsAreLocked();
        }

        uint256[] memory tokenIds = new uint256[](1);
        uint256[] memory values = new uint256[](1);

        for (uint256 i = 0; i < 1; i++) {
            tokenIds[i] = _tokenId;
            values[i] = _value;
        }
        parseTokensAddToEscrow(_msgSender(), tokenIds, values);

        emit ERC1155TokenReceived(
            _msgSender(),
            _from,
            _tokenId,
            block.timestamp
        );
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address _operator,
        address _from,
        uint256[] memory _tokenIds,
        uint256[] memory _values,
        bytes memory _data
    ) public virtual override returns (bytes4) {
        require(
            isSenderApproved(_from) && isSenderApproved(_operator),
            "Not an approved sender"
        );
        require(
            isCollectionApproved(_msgSender()),
            "Collection not approved for this loyalty program"
        );
        require(_data.length >= 32, "Invalid data length");

        bytes32 depositKey;

        assembly {
            depositKey := mload(add(_data, 32))
        }
        require(validDepositKeys[depositKey], "Invalid deposit key");

        if (escrowState() != EscrowState.DepositPeriod) {
            revert DepositsAreLocked();
        }
        parseTokensAddToEscrow(_msgSender(), _tokenIds, _values);

        emit ERC1155BatchReceived(
            _msgSender(),
            _from,
            _tokenIds,
            block.timestamp
        );

        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function parseTokensAddToEscrow(
        address _collectionAddress,
        uint256[] memory _tokenIds,
        uint256[] memory _values
    ) private {
        if (_tokenIds.length != _values.length) {
            revert TokenIdsAndValuesLengthMismatch();
        }

        if (
            escrow.totalTokenIds > maxTokenIdsAllowed ||
            _tokenIds.length > maxTokenIdsAllowed
        ) {
            revert ExceededMaxTokenIdsAmount();
        }

        if (escrow.totalTokenIds == 0) {
            escrow.collectionAddress = _collectionAddress;
        }

        for (uint256 i = 0; i < _tokenIds.length; i++) {
            if (tokenBalances[_tokenIds[i]] != 0) {
                for (uint256 j = 0; j < escrow.tokens.length; j++) {
                    if (escrow.tokens[j].id == _tokenIds[i]) {
                        escrow.tokens[j].value += _values[i];
                        break;
                    }
                }
            } else {
                escrow.tokens.push(
                    Token({id: _tokenIds[i], value: _values[i]})
                );
                escrow.totalTokenIds++;
            }
            tokenBalances[_tokenIds[i]] += _values[i];
        }
    }

    function handleRewardsUnlock(address _user, uint256 _rewardGoal) external {
        if (msg.sender != loyaltyProgramAddress)
            revert OnlyLoyaltyProgramCanCall();
        if (escrowState() != EscrowState.InIssuance) revert NotInIssuance();
        if (
            escrow.rewardCondition != RewardCondition.EachObjective &&
            escrow.rewardCondition != RewardCondition.SingleObjective &&
            escrow.rewardCondition != RewardCondition.PointsTotal
        ) {
            revert IncorrectRewardCondition();
        }

        if (
            escrow.rewardCondition == RewardCondition.SingleObjective ||
            escrow.rewardCondition == RewardCondition.EachObjective
        ) {
            unlockRewardsByObjective(_user, _rewardGoal);
        } else {
            unlockRewardsByPointsTotal(_user);
        }
    }

    function handleTierRewardsUnlock(
        address _user,
        uint256 _tierIndex,
        uint256[] memory _passedTiers
    ) external {
        if (msg.sender != loyaltyProgramAddress)
            revert OnlyLoyaltyProgramCanCall();
        if (escrowState() != EscrowState.InIssuance) revert NotInIssuance();
        if (
            escrow.rewardCondition != RewardCondition.EachTier &&
            escrow.rewardCondition != RewardCondition.SingleTier
        ) {
            revert IncorrectRewardCondition();
        }
        unlockRewardsByTier(_user, _tierIndex, _passedTiers);
    }

    function unlockRewardsByObjective(
        address _user,
        uint256 _objIndex
    ) private {
        UserAccount storage user = userAccount[_user];
        bool rewardAlreadyRewarded = user.rewardGoalRewarded[_objIndex];
        EscrowPayoutDetails storage payout = payoutIndexToPayouts[_objIndex];

        if (
            tokenBalances[payout.tokenId] >= payout.amount &&
            !rewardAlreadyRewarded
        ) {
            if (payout.amount > 0) {
                user.rewardGoalRewarded[_objIndex] = true;
                user.rewardedTokenBalances.push(
                    UserTokenBalance({
                        tokenId: payout.tokenId,
                        amount: payout.amount
                    })
                );
                tokenBalances[payout.tokenId] -= payout.amount;
            }
        }
    }

    function unlockRewardsByTier(
        address _user,
        uint256 _tierIndex,
        uint256[] memory _passedTiers
    ) private {
        UserAccount storage user = userAccount[_user];
        if (escrow.rewardCondition == RewardCondition.EachTier) {
            for (uint256 i = 0; i < _passedTiers.length; i++) {
                uint256 tierIndex = _passedTiers[i];
                bool alreadyRewardedTier = user.rewardGoalRewarded[tierIndex];

                if (!alreadyRewardedTier && tierIndex != 0) {
                    EscrowPayoutDetails storage payout = payoutIndexToPayouts[
                        tierIndex
                    ];

                    if (
                        payout.amount > 0 &&
                        tokenBalances[payout.tokenId] >= payout.amount
                    ) {
                        user.rewardGoalRewarded[tierIndex] = true;
                        user.rewardedTokenBalances.push(
                            UserTokenBalance({
                                tokenId: payout.tokenId,
                                amount: payout.amount
                            })
                        );
                        tokenBalances[payout.tokenId] -= payout.amount;
                        emit ERC1155Rewarded(
                            _user,
                            payout.tokenId,
                            payout.amount,
                            block.timestamp
                        );
                    } else {
                        revert AllRewardsPaid();
                    }
                }
            }
        } else if (escrow.rewardCondition == RewardCondition.SingleTier) {
            bool alreadyRewardedTier = user.rewardGoalRewarded[
                escrow.rewardGoal
            ];
            EscrowPayoutDetails storage payout = payoutIndexToPayouts[
                escrow.rewardGoal
            ];
            if (
                !alreadyRewardedTier &&
                tokenBalances[payout.tokenId] >= payout.amount
            ) {
                if (payout.amount > 0 && _tierIndex >= escrow.rewardGoal) {
                    user.rewardGoalRewarded[escrow.rewardGoal] = true;
                    user.rewardedTokenBalances.push(
                        UserTokenBalance({
                            tokenId: payout.tokenId,
                            amount: payout.amount
                        })
                    );
                    tokenBalances[payout.tokenId] -= payout.amount;
                    emit ERC1155Rewarded(
                        _user,
                        payout.tokenId,
                        payout.amount,
                        block.timestamp
                    );
                }
            } else {
                revert AllRewardsPaid();
            }
        }
    }

    function unlockRewardsByPointsTotal(address _user) private {
        (uint256 rewardsEarned, ) = loyaltyProgram.getUserProgression(_user);

        UserAccount storage user = userAccount[_user];
        bool rewardAlreadyRewarded = user.rewardGoalRewarded[escrow.rewardGoal];

        if (rewardsEarned >= escrow.rewardGoal && !rewardAlreadyRewarded) {
            EscrowPayoutDetails storage payout = payoutIndexToPayouts[
                escrow.rewardGoal
            ];

            if (tokenBalances[payout.tokenId] >= payout.amount) {
                user.rewardGoalRewarded[escrow.rewardGoal] = true;
                user.rewardedTokenBalances.push(
                    UserTokenBalance({
                        tokenId: payout.tokenId,
                        amount: payout.amount
                    })
                );
                tokenBalances[payout.tokenId] -= payout.amount;
                emit ERC1155Rewarded(
                    _user,
                    payout.tokenId,
                    payout.amount,
                    block.timestamp
                );
            } else {
                revert AllRewardsPaid();
            }
        }
    }

    function userWithdrawAll() external {
        UserAccount storage user = userAccount[msg.sender];
        UserTokenBalance[] storage userBalance = user.rewardedTokenBalances;
        if (user.allFundsPaid || userBalance.length == 0)
            revert NoTokensToWithdraw();

        if (user.allFundsLocked || escrowState() == EscrowState.Frozen)
            revert FundsAreLocked();

        uint256[] memory rewardedTokenIds = new uint256[](escrow.tokens.length);
        uint256[] memory rewardedTokenAmounts = new uint256[](
            escrow.tokens.length
        );

        for (uint256 i = 0; i < userBalance.length; i++) {
            if (userBalance[i].amount > 0) {
                rewardedTokenIds[i] = userBalance[i].tokenId;
                rewardedTokenAmounts[i] = userBalance[i].amount;
            }
        }

        ERC1155 collection = ERC1155(escrow.collectionAddress);
        collection.safeBatchTransferFrom(
            address(this),
            msg.sender,
            rewardedTokenIds,
            rewardedTokenAmounts,
            bytes("")
        );
        user.allFundsPaid = true;
        delete user.rewardedTokenBalances;

        emit UserWithdrawAll(
            msg.sender,
            rewardedTokenIds,
            rewardedTokenAmounts,
            block.timestamp
        );
    }

    function creatorWithdrawAllBalance() external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (escrowState() != EscrowState.Completed)
            revert LoyaltyProgramMustBeCompleted();
        if (escrow.totalTokenIds == 0 || escrow.allFundsPaid)
            revert NoTokensToWithdraw();

        uint256[] memory tokenAmounts = new uint256[](escrow.tokens.length);
        uint256[] memory tokenIds = new uint256[](escrow.tokens.length);

        for (uint256 i = 0; i < escrow.tokens.length; i++) {
            uint256 tokenBalance = tokenBalances[escrow.tokens[i].id];
            uint256 tokenId = escrow.tokens[i].id;
            if (tokenBalance > 0) {
                tokenIds[i] = tokenId;
                tokenAmounts[i] = tokenBalance;
                tokenBalances[tokenId] -= tokenBalances[tokenId];
            }
        }

        ERC1155 collection = ERC1155(escrow.collectionAddress);
        collection.safeBatchTransferFrom(
            address(this),
            msg.sender,
            tokenIds,
            tokenAmounts,
            bytes("")
        );

        emit CreatorWithdrawAll(
            msg.sender,
            tokenIds,
            tokenAmounts,
            block.timestamp
        );

        delete escrow.tokens;
        escrow.allFundsPaid = true;
        escrow.totalTokenIds = 0;
    }

    function creatorWithdrawToken(uint256 _tokenId, uint256 _amount) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (escrowState() != EscrowState.Completed)
            revert LoyaltyProgramMustBeCompleted();

        uint256 withdrawAmount = tokenBalances[_tokenId];

        if (
            escrow.totalTokenIds == 0 ||
            escrow.allFundsPaid ||
            _amount == 0 ||
            withdrawAmount == 0
        ) {
            revert NoTokensToWithdraw();
        }

        ERC1155 collection = ERC1155(escrow.collectionAddress);
        collection.safeTransferFrom(
            address(this),
            msg.sender,
            _tokenId,
            withdrawAmount,
            bytes("")
        );

        tokenBalances[_tokenId] -= withdrawAmount;

        emit CreatorWithdraw(
            msg.sender,
            _tokenId,
            withdrawAmount,
            block.timestamp
        );
    }

    function setEscrowSettingsBasic(
        RewardCondition _condition,
        uint256 _tokenId,
        uint256 _payout,
        uint256 _rewardGoal
    ) external {
        runSetEscrowSettingsChecksBasic(_condition, _payout, _tokenId);
        (
            bool tiersAreActive,
            uint256 tierCount,
            uint256 totalPointsPossible,
            LoyaltyProgram.RewardType rewardType,
            LoyaltyProgram.Objective[] memory objectives
        ) = loyaltyProgram.getLoyaltyProgramSettings();

        if (rewardType != LoyaltyProgram.RewardType.ERC1155) {
            revert IncorrectRewardType();
        }

        if (escrowState() != EscrowState.AwaitingEscrowSettings) {
            revert DepositPeriodMustBeFinished();
        }

        if (_condition == RewardCondition.SingleObjective) {
            require(
                _rewardGoal < objectives.length,
                "Must choose a valid objective index as reward goal"
            );

            assignPayoutIndexToPayoutRewardGoal(_tokenId, _payout, _rewardGoal);
        } else if (_condition == RewardCondition.SingleTier) {
            if (!tiersAreActive)
                revert TiersMustBeActiveToUseTiersRewardCondition();
            require(
                _rewardGoal < tierCount && _rewardGoal > 0 && tierCount > 0,
                "Must choose a valid tier index as reward goal"
            );
            assignPayoutIndexToPayoutRewardGoal(_tokenId, _payout, _rewardGoal);
        } else if (_condition == RewardCondition.PointsTotal) {
            require(
                _rewardGoal <= totalPointsPossible && _rewardGoal > 0,
                "Must set a reachable points goal"
            );
            assignPayoutIndexToPayoutRewardGoal(_tokenId, _payout, _rewardGoal);
        }
        escrow.rewardGoal = _rewardGoal;
        escrow.rewardCondition = _condition;
        inIssuance = true;
        areEscrowSettingsSet = true;
        emit ERC1155EscrowSettingsChanged(
            msg.sender,
            _condition,
            block.timestamp
        );
    }

    function setEscrowSettingsAdvanced(
        RewardCondition _condition,
        uint256[] calldata _tokenIds,
        uint256[] calldata _payouts
    ) external {
        runSetEscrowSettingsChecksAdvanced(_condition, _tokenIds, _payouts);
        (
            bool tiersAreActive,
            uint256 tierCount,
            ,
            LoyaltyProgram.RewardType rewardType,
            LoyaltyProgram.Objective[] memory objectives
        ) = loyaltyProgram.getLoyaltyProgramSettings();

        if (rewardType != LoyaltyProgram.RewardType.ERC1155) {
            revert IncorrectRewardType();
        }

        if (escrowState() != EscrowState.AwaitingEscrowSettings) {
            revert DepositPeriodMustBeFinished();
        }

        verifyTokenBalances(_tokenIds, _payouts);

        if (_condition == RewardCondition.EachObjective) {
            require(objectives.length == _tokenIds.length, "Mismatch");
            assignPayoutIndexToPayout(_tokenIds, _payouts);
            escrow.rewardCondition = RewardCondition.EachObjective;
        } else if (_condition == RewardCondition.EachTier) {
            if (!tiersAreActive)
                revert TiersMustBeActiveToUseTiersRewardCondition();
            require(tierCount == _tokenIds.length, "Mismatch");
            require(
                _tokenIds[0] == 0 && _payouts[0] == 0,
                "First index cannot payout"
            );
            assignPayoutIndexToPayout(_tokenIds, _payouts);
            escrow.rewardCondition = RewardCondition.EachTier;
        }
        inIssuance = true;
        areEscrowSettingsSet = true;
        emit ERC1155EscrowSettingsChanged(
            msg.sender,
            _condition,
            block.timestamp
        );
    }

    function runSetEscrowSettingsChecksBasic(
        RewardCondition _condition,
        uint256 _payout,
        uint256 _tokenId
    ) private view {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (loyaltyProgram.state() != LoyaltyProgram.LoyaltyState.Idle) {
            revert LoyaltyProgramMustBeIdle();
        }
        if (
            _condition != RewardCondition.SingleObjective &&
            _condition != RewardCondition.SingleTier &&
            _condition != RewardCondition.PointsTotal
        ) {
            revert MustUseSingleObjectiveSingleTierOrPointsTotal();
        }
        if (_payout == 0) revert PayoutCannotBeZero();
        if (tokenBalances[_tokenId] < _payout * PAYOUT_BUFFER) {
            revert InsufficientBalanceForATokenId();
        }
    }

    function runSetEscrowSettingsChecksAdvanced(
        RewardCondition _condition,
        uint256[] calldata _payouts,
        uint256[] calldata _tokenIds
    ) private view {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (loyaltyProgram.state() != LoyaltyProgram.LoyaltyState.Idle) {
            revert LoyaltyProgramMustBeIdle();
        }
        if (
            _condition != RewardCondition.EachObjective &&
            _condition != RewardCondition.EachTier
        ) {
            revert MustUseEachObjectiveOrEachTierRewardCondition();
        }
        if (_tokenIds.length != _payouts.length || _tokenIds.length == 0) {
            revert TokenIdsAndPayoutsLengthMismatch();
        }
    }

    function verifyTokenBalances(
        uint256[] memory _tokenIds,
        uint256[] memory _payouts
    ) private view {
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            if (tokenBalances[_tokenIds[i]] < _payouts[i] * PAYOUT_BUFFER) {
                revert InsufficientBalanceForATokenId();
            }
        }
    }

    function assignPayoutIndexToPayout(
        uint256[] calldata _tokenIds,
        uint256[] calldata _payouts
    ) private {
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            payoutIndexToPayouts[i] = EscrowPayoutDetails({
                tokenId: _tokenIds[i],
                amount: _payouts[i]
            });
        }
    }

    function assignPayoutIndexToPayoutRewardGoal(
        uint256 _tokenId,
        uint256 _payout,
        uint256 _rewardGoal
    ) private {
        payoutIndexToPayouts[_rewardGoal] = EscrowPayoutDetails({
            tokenId: _tokenId,
            amount: _payout
        });
    }

    function isCollectionApproved(
        address _collectionAddress
    ) public view returns (bool) {
        return isCollectionLoyaltyProgramApproved[_collectionAddress];
    }

    function isSenderApproved(address _sender) public view returns (bool) {
        return isApprovedSender[_sender];
    }

    function getLoyaltyProgram() public view returns (LoyaltyProgram) {
        return loyaltyProgram;
    }

    function getEscrowTokenDetails()
        public
        view
        returns (
            uint256 totalTokenIds,
            address collectionAddress,
            Token[] memory tokens
        )
    {
        return (escrow.totalTokenIds, escrow.collectionAddress, escrow.tokens);
    }

    function getEscrowTokenBalance(
        uint256 _tokenId
    ) public view returns (uint256) {
        return tokenBalances[_tokenId];
    }

    function getEscrowRewardDetails()
        public
        view
        returns (uint256 rewardGoal, RewardCondition rewardCondition)
    {
        return (escrow.rewardGoal, escrow.rewardCondition);
    }

    function getPayoutInfo(
        uint256 _rewardGoal
    ) public view returns (uint256 tokenId, uint256 payoutAmount) {
        return (
            payoutIndexToPayouts[_rewardGoal].tokenId,
            payoutIndexToPayouts[_rewardGoal].amount
        );
    }

    function getUserRewards(
        address _user
    ) public view returns (UserTokenBalance[] memory) {
        return userAccount[_user].rewardedTokenBalances;
    }

    function approveCollection(
        address _collectionAddress,
        bool _isApproved
    ) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        isCollectionLoyaltyProgramApproved[_collectionAddress] = _isApproved;

        if (_isApproved) escrowApprovalsCount++;

        if (escrowApprovalsCount == 3) {
            isAwaitingEscrowApprovals = false;
        }

        emit ERC1155CollectionApproved(
            _collectionAddress,
            msg.sender,
            block.timestamp
        );
    }

    function approveSender(address _sender, bool _isApproved) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        isApprovedSender[_sender] = _isApproved;
        escrowApprovalsCount++;

        if (escrowApprovalsCount == 3) {
            isAwaitingEscrowApprovals = false;
        }

        emit ERC1155SenderApproved(_sender, msg.sender, block.timestamp);
    }

    function setDepositKey(bytes32 key, uint256 _depositEndDate) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();

        uint256 minimumDepositPeriod = 1 hours;
        uint256 depositToProgramEndBuffer = 4 hours;
        if (_depositEndDate <= block.timestamp + minimumDepositPeriod) {
            revert DepositPeriodMustBeAtLeastOneHour();
        }

        if (
            _depositEndDate >= loyaltyProgramEndsAt + depositToProgramEndBuffer
        ) {
            revert DepositEndDateExceedsProgramEnd();
        }

        validDepositKeys[key] = true;
        escrowApprovalsCount++;
        depositStartDate = block.timestamp;
        depositEndDate = _depositEndDate;

        if (escrowApprovalsCount == 3) {
            isAwaitingEscrowApprovals = false;
        }
    }

    function emergencyFreeze(bool _isFrozen) external {
        if (msg.sender != TEAM_ADDRESS) revert OnlyTeamCanCall();
        allFundsLocked = _isFrozen;
        emit FrozenStateChange(msg.sender, _isFrozen, block.timestamp);
    }

    function cancelProgramEscrow() external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        canceled = true;
    }
}
