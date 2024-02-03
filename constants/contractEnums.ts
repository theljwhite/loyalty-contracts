export enum RewardType {
  Points,
  ERC20,
  ERC721,
  ERC1155,
}

export enum LoyaltyState {
  Idle,
  AwaitingEscrowSetup,
  Active,
  Completed,
  Canceled,
}

export enum EscrowState {
  Idle,
  AwaitingEscrowApprovals,
  DepositPeriod,
  AwaitingEscrowSettings,
  InIssuance,
  Completed,
  Frozen,
  Canceled,
}
