// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../LoyaltyProgram.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface ERC721Partial {
    function transferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) external;
    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) external;
}

contract LoyaltyERC721Escrow is IERC721Receiver, Ownable {
    enum EscrowState {
        Idle,
        DepositPeriod,
        AwaitingEscrowSettings,
        InIssuance,
        Completed,
        Frozen,
        Canceled
    }

    enum RewardOrder {
        NotSet,
        Ascending,
        Descending,
        Random
    }

    enum RewardCondition {
        NotSet,
        ObjectiveCompleted,
        TierReached,
        PointsTotal
    }

    enum UserTokenStatus {
        Locked,
        Unlocked,
        Paid
    }

    struct UserAccount {
        uint256[] rewardedTokenBalance;
        bool didReachGoal;
    }

    event ERC721TokenReceived(
        address collectionAddress,
        address from,
        uint256 tokenId,
        uint256 receivedAt
    );
    event SortTokenQueue(
        address creator,
        uint256[] tokensArr,
        RewardOrder rewardOrder,
        uint256 requestedAt
    );
    event TokenQueueReceived(uint256[] sortedTokenQueue, uint256 receivedAt);
    event ERC721EscrowSettingsChanged(
        address indexed creator,
        RewardCondition rewardCondition,
        RewardOrder rewardOrder,
        uint256 updatedAt
    );
    event TokenRewarded(
        address indexed user,
        uint256 token,
        uint256 rewardedAt
    );
    event UserWithdraw(
        address indexed user,
        uint256 token,
        uint256 withdrawnAt
    );
    event CreatoWithdraw(address creator, uint256 token, uint256 withdrawnAt);
    event FrozenStateChange(address team, bool frozen, uint256 updatedAt);

    string public constant VERSION = "0.03";
    address public constant TEAM_ADDRESS =
        0x262dE7a263d23BeA5544b7a0BF08F2c00BFABE7b;
    uint256 public constant MAX_DEPOSITORS = 2;

    LoyaltyProgram public loyaltyProgram;
    address public loyaltyProgramAddress;
    address public creator;
    uint256 public loyaltyProgramEndsAt;
    uint256 public depositStartDate;
    uint256 public depositEndDate;
    uint256 public maxTokensAllowed = 51;

    RewardOrder rewardOrder;
    RewardCondition rewardCondition;
    uint256 public rewardGoal;

    uint256 public totalTokensAmount;
    uint256 public totalTokensRewarded;
    uint256[] public tokenIds;
    string public collectionName;
    string public collectionSymbol;
    address public collectionAddress;
    bool public allFundsPaid;

    mapping(uint256 => bool) tokenExists;
    mapping(uint256 => bool) isTokenRewarded;

    mapping(address => bool) isApprovedSender;
    mapping(address => bool) isCollectionLoyaltyProgramApproved;
    mapping(bytes32 => bool) private validDepositKeys;
    mapping(address => UserAccount) userAccount;
    uint256[] private tokenQueue;

    bool public areEscrowSettingsSet;
    bool public isDepositKeySet;
    bool public inIssuance;
    bool public completed;
    bool public allFundsLocked;
    bool public canceled;

    error OnlyCreatorCanCall();
    error OnlyTeamCanCall();
    error OnlyLoyaltyProgramCanCall();
    error OnlyTeamOrCreatorCanCall();

    error DepositsAreLocked();
    error FundsAreLocked();
    error DepositPeriodMustBeAtLeastOneHour();
    error DepositEndDateExceedsProgramEnd();
    error DepositPeriodMustBeFinished();
    error ExceededMaxTokensAllowed();
    error TokenQueueLengthMismatch();
    error IncorrectRewardType();
    error IncorrectRewardOrder();
    error NotInIssuance();
    error RewardOrderNotSet();
    error NoTokensToWithdraw();
    error LoyaltyProgramMustBeCompleted();
    error ExceededMaxDepositors();
    error IncorrectDepositKey();

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
        isApprovedSender[creator] = true;
        isApprovedSender[address(this)] = true;
        isCollectionLoyaltyProgramApproved[_rewardTokenAddress] = true;
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

        if (
            depositStartDate <= block.timestamp &&
            depositEndDate >= block.timestamp &&
            isDepositKeySet
        ) {
            return EscrowState.DepositPeriod;
        }

        if (
            block.timestamp > depositEndDate &&
            !areEscrowSettingsSet &&
            isDepositKeySet
        ) {
            return EscrowState.AwaitingEscrowSettings;
        }
        if (
            inIssuance &&
            loyaltyProgram.state() == LoyaltyProgram.LoyaltyState.Active
        ) return EscrowState.InIssuance;

        if (
            loyaltyProgram.state() == LoyaltyProgram.LoyaltyState.Completed ||
            allFundsPaid
        ) return EscrowState.Completed;

        return EscrowState.Idle;
    }

    function onERC721Received(
        address _operator,
        address _from,
        uint256 _tokenId,
        bytes memory _data
    ) external override returns (bytes4) {
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

        if (escrowState() != EscrowState.DepositPeriod)
            revert DepositsAreLocked();

        parseTokensAddToEscrow(_msgSender(), _tokenId);

        emit ERC721TokenReceived(
            _msgSender(),
            _from,
            _tokenId,
            block.timestamp
        );

        return IERC721Receiver.onERC721Received.selector;
    }

    function parseTokensAddToEscrow(
        address _contractAddress,
        uint256 _tokenId
    ) private {
        if (totalTokensAmount > maxTokensAllowed)
            revert ExceededMaxTokensAllowed();

        if (!tokenExists[_tokenId]) {
            if (tokenIds.length == 0) {
                (
                    string memory name,
                    string memory symbol
                ) = getTokenNameAndSymbol(_contractAddress);
                collectionName = name;
                collectionSymbol = symbol;
                collectionAddress = _contractAddress;
            }
            tokenExists[_tokenId] = true;
            totalTokensAmount++;
            tokenIds.push(_tokenId);
        }
    }

    function batchTransfer(
        ERC721Partial _rewardsContract,
        uint256[] calldata _tokenIds,
        bytes memory _depositKey
    ) external {
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            _rewardsContract.transferFrom(
                msg.sender,
                address(this),
                _tokenIds[i],
                _depositKey
            );
        }
    }

    function safeBatchTransfer(
        ERC721Partial _rewardsContract,
        uint256[] calldata _tokenIds,
        bytes memory _depositKey
    ) external {
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            _rewardsContract.safeTransferFrom(
                msg.sender,
                address(this),
                _tokenIds[i],
                _depositKey
            );
        }
    }

    function handleRewardsUnlock(
        address _user,
        uint256 _rewardGoal,
        uint256 _rewardGoalTier
    ) external {
        if (msg.sender != loyaltyProgramAddress)
            revert OnlyLoyaltyProgramCanCall();
        if (escrowState() != EscrowState.InIssuance) revert NotInIssuance();

        bool alreadyRewarded = userAccount[_user].didReachGoal;

        if (rewardCondition == RewardCondition.ObjectiveCompleted) {
            if (
                _rewardGoal > 0 && rewardGoal == _rewardGoal && !alreadyRewarded
            ) {
                userAccount[_user].didReachGoal = true;
                distributeRewardByRewardOrder(_user);
            }
        } else if (rewardCondition == RewardCondition.TierReached) {
            if (
                _rewardGoalTier > 0 &&
                _rewardGoalTier >= rewardGoal &&
                !alreadyRewarded
            ) {
                userAccount[_user].didReachGoal = true;
                distributeRewardByRewardOrder(_user);
            }
        } else {
            (uint256 rewardsEarned, ) = loyaltyProgram.getUserProgression(
                _user
            );

            if (rewardsEarned >= rewardGoal && !alreadyRewarded) {
                userAccount[_user].didReachGoal = true;
                distributeRewardByRewardOrder(_user);
            }
        }
    }

    function distributeRewardByRewardOrder(address _user) private {
        if (rewardOrder == RewardOrder.NotSet) revert RewardOrderNotSet();
        if (
            tokenQueue.length == 0 ||
            tokenQueue.length != tokenIds.length - totalTokensRewarded
        ) {
            revert TokenQueueLengthMismatch();
        }
        uint256 rewardedToken = tokenQueue[tokenQueue.length - 1];
        if (!isTokenRewarded[rewardedToken]) {
            isTokenRewarded[rewardedToken] = true;
            totalTokensRewarded++;

            UserAccount storage user = userAccount[_user];
            user.rewardedTokenBalance.push(rewardedToken);

            tokenQueue.pop();

            emit TokenRewarded(_user, rewardedToken, block.timestamp);
        } else revert TokenQueueLengthMismatch();
    }

    function userWithdrawAll() external {
        UserAccount storage user = userAccount[msg.sender];
        uint256[] memory userBalance = user.rewardedTokenBalance;

        if (userBalance.length == 0) revert NoTokensToWithdraw();
        if (escrowState() == EscrowState.Frozen || !user.didReachGoal)
            revert FundsAreLocked();

        IERC721 collection = IERC721(collectionAddress);

        for (uint256 i = 0; i < userBalance.length; i++) {
            collection.transferFrom(address(this), msg.sender, userBalance[i]);
            emit UserWithdraw(msg.sender, userBalance[i], block.timestamp);
        }
        delete userAccount[msg.sender].rewardedTokenBalance;
    }

    function creatorWithdrawAll() external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (escrowState() != EscrowState.Completed)
            revert LoyaltyProgramMustBeCompleted();
        if (tokenQueue.length == 0) revert NoTokensToWithdraw();

        IERC721 collection = IERC721(collectionAddress);
        for (uint256 i = 0; i < tokenQueue.length; i++) {
            collection.transferFrom(address(this), msg.sender, tokenQueue[i]);
            delete tokenQueue[i];
            emit CreatoWithdraw(msg.sender, tokenQueue[i], block.timestamp);
        }
    }

    function setEscrowSettings(
        RewardOrder _rewardOrder,
        RewardCondition _rewardCondition,
        uint256 _rewardGoal
    ) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        (
            bool tiersAreActive,
            uint256 tierCount,
            ,
            LoyaltyProgram.RewardType rewardType,
            LoyaltyProgram.Objective[] memory objectives
        ) = loyaltyProgram.getLoyaltyProgramSettings();

        if (rewardType != LoyaltyProgram.RewardType.ERC721) {
            revert IncorrectRewardType();
        }
        if (_rewardOrder == RewardOrder.NotSet) revert IncorrectRewardOrder();

        if (escrowState() != EscrowState.AwaitingEscrowSettings) {
            revert DepositPeriodMustBeFinished();
        }

        if (_rewardCondition == RewardCondition.ObjectiveCompleted) {
            require(
                _rewardGoal > 0 && _rewardGoal < objectives.length,
                "Goal must be set to a valid objective index"
            );
            rewardGoal = _rewardGoal;
        } else if (_rewardCondition == RewardCondition.TierReached) {
            require(
                tiersAreActive,
                "Tiers must be added to use tier as reward goal"
            );
            require(
                _rewardGoal > 0 && _rewardGoal < tierCount,
                "Goal must be set to a valid tier index"
            );
            rewardGoal = _rewardGoal;
        } else {
            uint256 totalPointsPossible = loyaltyProgram.totalPointsPossible();
            require(
                _rewardGoal > 0 && _rewardGoal <= totalPointsPossible,
                "Must set an attainable points total"
            );
            rewardGoal = _rewardGoal;
        }

        rewardOrder = _rewardOrder;
        rewardCondition = _rewardCondition;
        areEscrowSettingsSet = true;
        sortTokenQueue(msg.sender, _rewardOrder);

        emit ERC721EscrowSettingsChanged(
            msg.sender,
            _rewardCondition,
            _rewardOrder,
            block.timestamp
        );
    }

    function sortTokenQueue(address _sender, RewardOrder _rewardOrder) private {
        emit SortTokenQueue(_sender, tokenIds, _rewardOrder, block.timestamp);
    }

    function receiveTokenQueue(
        uint256[] memory _sortedTokenQueue,
        bytes32 _depositKey
    ) external {
        if (msg.sender != TEAM_ADDRESS && msg.sender != creator)
            revert OnlyTeamOrCreatorCanCall();
        if (_sortedTokenQueue.length != tokenIds.length)
            revert TokenQueueLengthMismatch();
        if (!validDepositKeys[_depositKey]) revert IncorrectDepositKey();

        tokenQueue = _sortedTokenQueue;
        inIssuance = true;

        emit TokenQueueReceived(_sortedTokenQueue, block.timestamp);
    }

    function getTokenNameAndSymbol(
        address _tokenAddress
    ) private view returns (string memory, string memory) {
        IERC721Metadata token = IERC721Metadata(_tokenAddress);
        return (token.name(), token.symbol());
    }

    function getTokenIds() public view returns (uint256[] memory) {
        return tokenIds;
    }

    function getBasicEscrowInfo()
        public
        view
        returns (
            uint256 totalTokens,
            string memory name,
            string memory symbol,
            address collection
        )
    {
        return (
            totalTokensAmount,
            collectionName,
            collectionSymbol,
            collectionAddress
        );
    }

    function lookupTokenQueue() external view returns (uint256[] memory) {
        if (msg.sender != TEAM_ADDRESS && msg.sender != creator) {
            revert OnlyTeamOrCreatorCanCall();
        }
        return tokenQueue;
    }

    function getUserAccount(
        address _user
    ) external view returns (uint256[] memory tokenBalance) {
        if (msg.sender != TEAM_ADDRESS && msg.sender != creator)
            revert OnlyTeamOrCreatorCanCall();
        return (userAccount[_user].rewardedTokenBalance);
    }

    function isCollectionApproved(
        address _collectionAddress
    ) public view returns (bool) {
        return isCollectionLoyaltyProgramApproved[_collectionAddress];
    }

    function isSenderApproved(address _sender) public view returns (bool) {
        return isApprovedSender[_sender];
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
        depositStartDate = block.timestamp;
        depositEndDate = _depositEndDate;
        isDepositKeySet = true;
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
