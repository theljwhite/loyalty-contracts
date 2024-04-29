// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./utils/LoyaltySorting.sol";
import "./utils/LoyaltySecurity.sol";
import "./interfaces/ILoyaltyERC1155Escrow.sol";
import "./interfaces/ILoyaltyERC721Escrow.sol";
import "./interfaces/ILoyaltyERC20Escrow.sol";

abstract contract LoyaltyProgram is LoyaltySorting, LoyaltySecurity {
    enum RewardType {
        Points,
        ERC20,
        ERC721,
        ERC1155
    }

    enum LoyaltyState {
        Idle,
        AwaitingEscrowSetup,
        Active,
        Completed,
        Canceled
    }

    enum ObjectiveAuthority {
        NotSet,
        User,
        Owner
    }

    struct Objective {
        bytes32 name;
        uint256 reward;
        bytes32 authority;
    }

    struct Tier {
        bytes32 name;
        uint256 rewardsRequired;
    }

    struct User {
        uint256 objectivesCompletedCount;
        mapping(uint256 => bool) completedObjectives;
        uint256 rewardsEarned;
        uint256 currentTier;
    }

    event LoyaltyProgramCreated(
        string name,
        address creator,
        RewardType rewardType
    );
    event LoyaltyProgramActive(address indexed sender, uint256 updatedAt);
    event ObjectiveCompleted(
        address indexed user,
        uint256 objectiveIndex,
        uint256 completedAt,
        bytes32 authority
    );
    event PointsUpdate(
        address indexed user,
        uint256 total,
        uint256 amount,
        uint256 updatedAt
    );

    string public constant VERSION = "0.03";
    address public constant TEAM_ADDRESS =
        0xe63DC839fA2a6A418Af4B417cD45e257dD76f516;

    bytes32 constant USER_AUTHORITY = "USER";
    bytes32 constant CREATOR_AUTHORITY = "CREATOR";
    uint256 public constant MAX_OBJECTIVES_LENGTH = 10;
    uint256 public constant MAX_TIERS_LENGTH = 8;

    string public name;
    address public creator;
    bool public isActive;
    bool public tiersAreActive;
    uint256 public tierCount;
    uint256 public totalPointsPossible;
    uint256 public programEndsAt;
    RewardType public rewardType;
    bool public canceled;

    Objective[] objectives;
    mapping(uint256 => Tier) tiers;
    mapping(address => User) users;

    uint256 public greatestPointsGiven;
    mapping(address => uint256) userToPointsGiven;

    ILoyaltyERC1155Escrow erc1155EscrowContract;
    ILoyaltyERC721Escrow erc721EscrowContract;
    ILoyaltyERC20Escrow erc20EscrowContract;

    address public constant amoyRelay =
        0x7219173e0a99580b7A0733c788D56E6e4A8e1C16;
    address public constant sepoliaRelay =
        0x55042894942F391726f35A0FE3b5c2829320fdd3;
    address public constant testRelayDelete =
        0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;

    mapping(address => bool) isRelayer;

    error EmptyProgramName();
    error EmptyObjectives();
    error ConstructorArrMismatch();
    error MaxObjExceeded();
    error MaxTierExceeded();
    error ProgramDurationTooShort();

    error ProgramMustBeActive();
    error ObjectiveAlreadyCompleted(uint256 objectiveIndex, address user);

    error InvalidObjective();

    error OnlyCreatorCanCall();
    error TierRewardsMustBeInAscendingOrder();
    error TierNameAndRewardMismatch();

    error UserCanNotBeZeroAddress();
    error OnlyUserOrRelay();
    error OnlyCreatorOrRelay();

    constructor(
        string memory _name,
        bytes32[] memory _targetObjectives,
        bytes32[] memory _authorities,
        uint256[] memory _rewards,
        RewardType _rewardType,
        uint256 _programEndsAt,
        bool _tiersSortingActive,
        bytes32[] memory _tierNames,
        uint256[] memory _tierRewardsRequired
    ) {
        if (bytes(_name).length == 0) revert EmptyProgramName();
        if (_targetObjectives.length == 0) revert EmptyObjectives();
        if (
            _targetObjectives.length != _rewards.length ||
            _rewards.length != _authorities.length
        ) {
            revert ConstructorArrMismatch();
        }
        if (_targetObjectives.length > MAX_OBJECTIVES_LENGTH)
            revert MaxObjExceeded();

        uint256 minimumProgramDuration = 1 days;
        if (_programEndsAt < block.timestamp + minimumProgramDuration) {
            revert ProgramDurationTooShort();
        }

        name = _name;
        creator = msg.sender;
        isActive = false;
        tiersAreActive = false;
        rewardType = _rewardType;
        programEndsAt = _programEndsAt;
        rewardType = _rewardType;

        isRelayer[amoyRelay] = true;
        isRelayer[sepoliaRelay] = true;
        isRelayer[testRelayDelete] = true;

        for (uint256 i = 0; i < _targetObjectives.length; i++) {
            objectives.push(
                Objective({
                    name: _targetObjectives[i],
                    reward: _rewards[i],
                    authority: _authorities[i]
                })
            );
            totalPointsPossible += _rewards[i];
        }

        if (
            _tiersSortingActive &&
            _tierNames.length > 0 &&
            _tierRewardsRequired.length > 0
        ) {
            addTiers(_tierNames, _tierRewardsRequired);
        }

        emit LoyaltyProgramCreated(_name, msg.sender, _rewardType);
    }

    function version() public pure returns (string memory) {
        return VERSION;
    }

    function state() public view returns (LoyaltyState) {
        if (canceled) {
            return LoyaltyState.Canceled;
        }

        if (block.timestamp >= programEndsAt) {
            return LoyaltyState.Completed;
        }

        if (programEndsAt > block.timestamp && isActive) {
            return LoyaltyState.Active;
        }

        return LoyaltyState.Idle;
    }

    function addTiers(
        bytes32[] memory _tierNames,
        uint256[] memory _tierRewardsRequired
    ) private {
        if (_tierNames.length != _tierRewardsRequired.length)
            revert TierNameAndRewardMismatch();

        if (_tierNames.length > MAX_TIERS_LENGTH) revert MaxTierExceeded();

        if (!areTiersAscendingNoDuplicates(_tierRewardsRequired))
            revert TierRewardsMustBeInAscendingOrder();

        if (_tierRewardsRequired[0] == 0) {
            for (uint256 i = 0; i < _tierRewardsRequired.length; i++) {
                tiers[i] = Tier({
                    name: _tierNames[i],
                    rewardsRequired: _tierRewardsRequired[i]
                });
            }
            tierCount += _tierRewardsRequired.length;
        } else {
            tiers[0] = Tier({
                name: bytes32("Default tier"),
                rewardsRequired: 0
            });
            for (uint256 i = 0; i < _tierRewardsRequired.length; i++) {
                tiers[i + 1] = Tier({
                    name: _tierNames[i],
                    rewardsRequired: _tierRewardsRequired[i]
                });
            }
            tierCount += _tierRewardsRequired.length + 1;
        }
        tiersAreActive = true;
    }

    function completeUserAuthorityObjective(
        uint256 _objectiveIndex,
        address _user,
        bytes32 _messageHash,
        bytes memory _signature
    ) external {
        if (msg.sender != _user && !isRelayer[msg.sender]) {
            revert OnlyUserOrRelay();
        }

        if (_user == address(0)) revert UserCanNotBeZeroAddress();

        if (!isActive) revert ProgramMustBeActive();

        if (!isSignatureVerified(_messageHash, _signature, msg.sender)) {
            revert();
        }

        Objective memory objective = objectives[_objectiveIndex];

        if (_objectiveIndex >= objectives.length) {
            revert InvalidObjective();
        }

        bool alreadyCompletedObjective = users[_user].completedObjectives[
            _objectiveIndex
        ];

        if (alreadyCompletedObjective) {
            revert ObjectiveAlreadyCompleted(_objectiveIndex, _user);
        }

        users[_user].completedObjectives[_objectiveIndex] = true;
        users[_user].rewardsEarned += objective.reward;
        users[_user].objectivesCompletedCount++;

        handleEscrowRewards(_user, _objectiveIndex);

        emit ObjectiveCompleted(
            _user,
            _objectiveIndex,
            block.timestamp,
            objective.authority
        );
    }

    function completeCreatorAuthorityObjective(
        uint256 _objectiveIndex,
        address _user,
        bytes32 _messageHash,
        bytes memory _signature
    ) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();

        if (_user == address(0)) revert UserCanNotBeZeroAddress();

        if (!isActive) revert ProgramMustBeActive();

        if (!isSignatureVerified(_messageHash, _signature, msg.sender)) {
            revert();
        }

        Objective memory objective = objectives[_objectiveIndex];

        if (_objectiveIndex >= objectives.length) {
            revert InvalidObjective();
        }

        bool alreadyCompletedObjective = users[_user].completedObjectives[
            _objectiveIndex
        ];

        if (alreadyCompletedObjective) {
            revert ObjectiveAlreadyCompleted(_objectiveIndex, _user);
        }

        users[_user].completedObjectives[_objectiveIndex] = true;
        users[_user].rewardsEarned += objective.reward;
        users[_user].objectivesCompletedCount++;

        handleEscrowRewards(_user, _objectiveIndex);

        emit ObjectiveCompleted(
            _user,
            _objectiveIndex,
            block.timestamp,
            objective.authority
        );
    }

    function givePointsToUser(
        address _user,
        uint256 _points,
        bytes32 _messageHash,
        bytes memory _signature
    ) external {
        if (msg.sender != creator && !isRelayer[msg.sender]) {
            revert OnlyCreatorOrRelay();
        }
        if (_user == address(0)) revert UserCanNotBeZeroAddress();
        if (!isActive) revert ProgramMustBeActive();

        if (_points == 0 || _points > totalPointsPossible) revert();

        if (!isSignatureVerified(_messageHash, _signature, msg.sender)) {
            revert();
        }

        uint256 pointsGivenCopy = greatestPointsGiven;
        userToPointsGiven[_user] += _points;

        if (userToPointsGiven[_user] > greatestPointsGiven) {
            greatestPointsGiven = userToPointsGiven[_user];
            totalPointsPossible += greatestPointsGiven - pointsGivenCopy;
        }

        users[_user].rewardsEarned += _points;

        handleEscrowRewards(_user, 0);

        emit PointsUpdate(
            _user,
            users[_user].rewardsEarned,
            _points,
            block.timestamp
        );
    }

    function deductPointsFromUser(
        address _user,
        uint256 _points,
        bytes32 _messageHash,
        bytes memory _signature
    ) external {
        if (msg.sender != creator && !isRelayer[msg.sender]) {
            revert OnlyCreatorOrRelay();
        }
        if (_user == address(0)) revert UserCanNotBeZeroAddress();
        if (!isActive) revert ProgramMustBeActive();

        if (_points == 0 || _points > users[_user].rewardsEarned) {
            revert();
        }

        if (!isSignatureVerified(_messageHash, _signature, msg.sender)) {
            revert();
        }

        users[_user].rewardsEarned -= _points;

        updateUserTierProgress(_user, 0);
        emit PointsUpdate(
            _user,
            users[_user].rewardsEarned,
            _points,
            block.timestamp
        );
    }

    function handleEscrowRewards(
        address _user,
        uint256 _objectiveIndex
    ) private {
        if (tiersAreActive) {
            updateUserTierProgress(_user, _objectiveIndex);
        }

        if (rewardType == RewardType.ERC20 && !tiersAreActive) {
            erc20EscrowContract.handleRewardsUnlock(
                _user,
                _objectiveIndex,
                0,
                new uint256[](0)
            );
        }

        if (rewardType == RewardType.ERC721 && !tiersAreActive) {
            erc721EscrowContract.handleRewardsUnlock(_user, _objectiveIndex, 0);
        }

        if (rewardType == RewardType.ERC1155 && !tiersAreActive) {
            erc1155EscrowContract.handleRewardsUnlock(
                _user,
                _objectiveIndex,
                0,
                new uint256[](0)
            );
        }
    }

    function updateUserTierProgress(
        address _user,
        uint256 _objectiveIndex
    ) private {
        uint256 userRewards = users[_user].rewardsEarned;
        uint256 currentTier = 0;
        uint256 passedTierCount = 0;

        for (uint256 i = 0; i < tierCount; i++) {
            if (userRewards >= tiers[i].rewardsRequired) {
                currentTier = i;
                passedTierCount++;
            }
        }

        if (rewardType == RewardType.ERC721) {
            erc721EscrowContract.handleRewardsUnlock(
                _user,
                _objectiveIndex,
                currentTier
            );
        }

        if (
            rewardType == RewardType.ERC1155 || rewardType == RewardType.ERC20
        ) {
            uint256[] memory passedTiers = new uint256[](passedTierCount);
            uint256 index = 0;
            for (uint256 i = 0; i < tierCount; i++) {
                if (userRewards >= tiers[i].rewardsRequired) {
                    passedTiers[index] = i;
                    index++;
                }
            }

            if (rewardType == RewardType.ERC1155) {
                erc1155EscrowContract.handleRewardsUnlock(
                    _user,
                    _objectiveIndex,
                    currentTier,
                    passedTiers
                );
            }
            if (rewardType == RewardType.ERC20) {
                erc20EscrowContract.handleRewardsUnlock(
                    _user,
                    _objectiveIndex,
                    currentTier,
                    passedTiers
                );
            }
        }
        users[_user].currentTier = currentTier;
    }

    function getObjectives() external view returns (Objective[] memory) {
        return objectives;
    }

    function getUserProgression(
        address _user
    ) external view returns (uint256 rewardsEarned, uint256 currentTier) {
        return (users[_user].rewardsEarned, users[_user].currentTier);
    }

    function getUserObjectivesCompleteCount(
        address _user
    ) external view returns (uint256) {
        return users[_user].objectivesCompletedCount;
    }

    function getUserCompletedObjectives(
        address _userAddress
    ) external view returns (bool[] memory) {
        bool[] memory completionStatus = new bool[](objectives.length);

        for (uint256 i = 0; i < objectives.length; i++) {
            completionStatus[i] = users[_userAddress].completedObjectives[i];
        }
        return completionStatus;
    }

    function getBasicLoyaltyProgramDetails()
        public
        view
        returns (string memory, address, bool, uint256)
    {
        return (name, creator, isActive, programEndsAt);
    }

    function getLoyaltyProgramSettings()
        public
        view
        returns (bool, uint256, uint256, RewardType, Objective[] memory)
    {
        return (
            tiersAreActive,
            tierCount,
            totalPointsPossible,
            rewardType,
            objectives
        );
    }

    function setEscrowContract(
        address _contract,
        RewardType _rewardType
    ) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (_rewardType == RewardType.ERC20) {
            erc20EscrowContract = ILoyaltyERC20Escrow(_contract);
        } else if (_rewardType == RewardType.ERC721) {
            erc721EscrowContract = ILoyaltyERC721Escrow(_contract);
        } else if (_rewardType == RewardType.ERC1155) {
            erc1155EscrowContract = ILoyaltyERC1155Escrow(_contract);
        }
    }

    function setLoyaltyProgramActive() external {
        if (msg.sender != creator) {
            revert OnlyCreatorOrRelay();
        }

        isActive = true;
        emit LoyaltyProgramActive(msg.sender, block.timestamp);
    }

    function setRelayer(address _relayer) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        isRelayer[_relayer] = true;
    }
}
