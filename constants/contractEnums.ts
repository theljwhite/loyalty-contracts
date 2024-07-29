export enum RewardType {
  Points,
  ERC20,
  ERC721,
  ERC1155,
}

export enum LoyaltyState {
  Idle,
  Active,
  Completed,
  Canceled,
}

export enum EscrowState {
  Idle,
  AwaitingEscrowSettings,
  InIssuance,
  Completed,
  Frozen,
  Canceled,
}

export enum ERC721EscrowState {
  Idle,
  DepositPeriod,
  AwaitingEscrowSettings,
  InIssuance,
  Completed,
  Frozen,
  Canceled,
}

export enum ERC20RewardCondition {
  NotSet,
  AllObjectivesComplete,
  SingleObjective,
  AllTiersComplete,
  SingleTier,
  PointsTotal,
  RewardPerObjective,
  RewardPerTier,
}

export enum ERC721RewardCondition {
  NotSet,
  ObjectiveCompleted,
  TierReached,
  PointsTotal,
}

export enum ERC1155RewardCondition {
  NotSet,
  EachObjective,
  SingleObjective,
  EachTier,
  SingleTier,
  PointsTotal,
}

export enum ERC721RewardOrder {
  NotSet,
  Ascending,
  Descending,
  Random,
}
