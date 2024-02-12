// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./utils/LoyaltySorting.sol";
import "./interfaces/ILoyaltyERC1155Escrow.sol";
import "./interfaces/ILoyaltyERC721Escrow.sol";
import "./interfaces/ILoyaltyERC20Escrow.sol";

abstract contract LoyaltyProgram is LoyaltySorting {
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
    event LoyaltyTiersAdded(address creator, uint256 updatedAt);
    event LoyaltyProgramModified(address creator, uint256 updatedAt);
    event LoyaltyProgramActive(address indexed sender, uint256 updatedAt);
    event OwnerAuthorityObjectiveCompleted(
        address indexed user,
        uint256 objectiveIndex,
        uint256 completedAt
    );
    event UserAuthorityObjectiveCompleted(
        address indexed user,
        uint256 objectiveIndex,
        uint256 completedAt
    );

    address public constant TEAM_ADDRESS =
        0xe63DC839fA2a6A418Af4B417cD45e257dD76f516;
    bytes32 constant USER_AUTHORITY = "USER";
    bytes32 constant OWNER_AUTHORITY = "OWNER";
    uint256 public maxObjectivesLength = 10;
    uint256 public maxTiersLength = 8;

    string public name;
    address public creator;
    bool public isActive;
    bool public tiersAreActive;
    uint256 public tierCount;
    uint256 public totalPointsPossible;
    uint256 public erc20Budget;
    uint256 public programEndsAt;
    RewardType public rewardType;

    uint256 public programStart;
    bool public canceled;

    Objective[] objectives;
    mapping(uint256 => Tier) tiers;
    mapping(address => User) users;

    address public erc20Escrow;
    address public erc721Escrow;
    address public erc1155Escrow;
    ILoyaltyERC1155Escrow erc1155EscrowContract;
    ILoyaltyERC721Escrow erc721EscrowContract;
    ILoyaltyERC20Escrow erc20EscrowContract;

    error EmptyProgramName();
    error EmptyObjectives();
    error ConstructorArrMismatch();
    error MaxObjExceeded();
    error ProgramDurationTooShort();

    error ObjectiveAlreadyCompleted(uint256 objectiveIndex, address user);
    error LoyaltyProgramMustBeActive();
    error LoyaltyProgramMustNotBeActive();
    error InvalidObjectiveIndex();
    error InvalidObjectiveAuthority();
    error CannotAddObjectivesOnceProgramStarted();
    error OnlyCreatorCanCall();
    error CannotAddTiersOnceProgramStarted();
    error TierRewardsMustBeInAscendingOrder();
    error TierNamesAndRewardArraysMustBeSameLength();
    error OnlyCreatorOrTeamCanSetActive();
    error OnlyCreatorCanMarkOwnerObjectiveAsComplete();
    error UserCanNotBeZeroAddress();
    error OnlyTeamCanCall();

    constructor(
        string memory _name,
        bytes32[] memory _targetObjectives,
        bytes32[] memory _authorities,
        uint256[] memory _rewards,
        RewardType _rewardType,
        uint256 _programEndsAt
    ) {
        if (bytes(_name).length == 0) revert EmptyProgramName();
        if (_targetObjectives.length == 0) revert EmptyObjectives();
        if (
            _targetObjectives.length != _rewards.length ||
            _rewards.length != _authorities.length
        ) {
            revert ConstructorArrMismatch();
        }
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
        emit LoyaltyProgramCreated(_name, msg.sender, _rewardType);
    }

    function version() public pure returns (string memory) {
        return "0.01";
    }

    function state() public view returns (LoyaltyState) {
        if (canceled) {
            return LoyaltyState.Canceled;
        }

        if (programStart >= block.timestamp) {
            return LoyaltyState.Idle;
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
        bytes32[] calldata _tierNames,
        uint256[] calldata _tierRewardsRequired
    ) external {
        if (msg.sender != creator) revert OnlyCreatorCanCall();
        if (state() != LoyaltyState.Idle)
            revert CannotAddTiersOnceProgramStarted();

        if (_tierNames.length != _tierRewardsRequired.length)
            revert TierNamesAndRewardArraysMustBeSameLength();

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
        emit LoyaltyTiersAdded(msg.sender, block.timestamp);
    }

    function completeUserAuthorityObjective(uint256 _objectiveIndex) external {
        Objective memory objective = objectives[_objectiveIndex];

        if (objective.authority != USER_AUTHORITY) {
            revert InvalidObjectiveAuthority();
        }

        bool alreadyCompletedObjective = users[msg.sender].completedObjectives[
            _objectiveIndex
        ];

        if (alreadyCompletedObjective) {
            revert ObjectiveAlreadyCompleted(_objectiveIndex, msg.sender);
        }

        users[msg.sender].completedObjectives[_objectiveIndex] = true;
        users[msg.sender].rewardsEarned += objective.reward;
        users[msg.sender].objectivesCompletedCount++;

        if (tiersAreActive) {
            updateUserTierProgress(msg.sender);
        }

        if (rewardType == RewardType.ERC20 && !tiersAreActive) {
            erc20EscrowContract.handleRewardsUnlock(
                msg.sender,
                _objectiveIndex
            );
        }

        if (rewardType == RewardType.ERC721 && !tiersAreActive) {
            erc721EscrowContract.handleRewardsUnlock(
                msg.sender,
                _objectiveIndex
            );
        }

        if (rewardType == RewardType.ERC1155 && !tiersAreActive) {
            erc1155EscrowContract.handleRewardsUnlock(
                msg.sender,
                _objectiveIndex
            );
        }

        emit UserAuthorityObjectiveCompleted(
            msg.sender,
            _objectiveIndex,
            block.timestamp
        );
    }

    function completeOwnerAuthorityObjective(
        uint256 _objectiveIndex,
        address _user
    ) external {
        if (msg.sender != creator)
            revert OnlyCreatorCanMarkOwnerObjectiveAsComplete();

        if (_user == address(0)) revert UserCanNotBeZeroAddress();

        Objective memory objective = objectives[_objectiveIndex];

        if (objective.authority != OWNER_AUTHORITY) {
            revert InvalidObjectiveAuthority();
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

        if (tiersAreActive) {
            updateUserTierProgress(_user);
        }

        if (rewardType == RewardType.ERC20 && !tiersAreActive) {
            erc20EscrowContract.handleRewardsUnlock(_user, _objectiveIndex);
        }

        if (rewardType == RewardType.ERC721 && !tiersAreActive) {
            erc721EscrowContract.handleRewardsUnlock(_user, _objectiveIndex);
        }

        if (rewardType == RewardType.ERC1155 && !tiersAreActive) {
            erc1155EscrowContract.handleRewardsUnlock(_user, _objectiveIndex);
        }

        emit OwnerAuthorityObjectiveCompleted(
            _user,
            _objectiveIndex,
            block.timestamp
        );
    }

    function updateUserTierProgress(address _user) internal {
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
            erc721EscrowContract.handleRewardsUnlock(msg.sender, currentTier);
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
                erc1155EscrowContract.handleTierRewardsUnlock(
                    _user,
                    currentTier,
                    passedTiers
                );
            }
            if (rewardType == RewardType.ERC20) {
                erc20EscrowContract.handleTierRewardsUnlock(
                    _user,
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
        returns (
            string memory,
            address,
            bool,
            bool,
            uint256,
            uint256,
            RewardType
        )
    {
        return (
            name,
            creator,
            isActive,
            tiersAreActive,
            programStart,
            programEndsAt,
            rewardType
        );
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
        if (msg.sender != TEAM_ADDRESS && msg.sender != creator) {
            revert OnlyCreatorOrTeamCanSetActive();
        }

        isActive = true;
        emit LoyaltyProgramActive(msg.sender, block.timestamp);
    }
}
