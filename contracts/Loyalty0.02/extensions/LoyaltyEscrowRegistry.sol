// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../LoyaltyProgram.sol";
import "../modules/LoyaltyERC20Escrow.sol";
import "../modules/LoyaltyERC721Escrow.sol";
import "../modules/LoyaltyERC1155Escrow.sol";

abstract contract LoyaltyEscrowRegistry is LoyaltyProgram {
  event LoyaltyERC20EscrowModuleSet(
    LoyaltyERC20Escrow oldERC20Module,
    LoyaltyERC20Escrow newERC20Module
  );

  event LoyaltyERC721EscrowModuleSet(
    LoyaltyERC721Escrow oldERC721Module,
    LoyaltyERC721Escrow newERC721Module
  );

  event LoyaltyERC1155EscrowModuleSet(
    LoyaltyERC1155Escrow oldERC115Module,
    LoyaltyERC1155Escrow newERC115Module
  );

  LoyaltyERC20Escrow public loyaltyERC20EscrowModule;
  LoyaltyERC721Escrow public loyaltyERC721EscrowModule;
  LoyaltyERC1155Escrow public loyaltyERC1155EscrowModule;

  error OnlyLoyaltyCreatorCanSetEscrowModule();

  function setERC20EscrowModule(LoyaltyERC20Escrow _loyaltyERC20EscrowModule)
    public
  {
    if (msg.sender != creator) revert OnlyLoyaltyCreatorCanSetEscrowModule();

    LoyaltyERC20Escrow oldERC20Module = loyaltyERC20EscrowModule;
    loyaltyERC20EscrowModule = _loyaltyERC20EscrowModule;

    emit LoyaltyERC20EscrowModuleSet(oldERC20Module, _loyaltyERC20EscrowModule);
  }

  function setERC721EscrowModule(LoyaltyERC721Escrow _loyaltyERC721EscrowModule)
    public
  {
    if (msg.sender != creator) revert OnlyLoyaltyCreatorCanSetEscrowModule();
    LoyaltyERC721Escrow oldERC721Module = loyaltyERC721EscrowModule;
    loyaltyERC721EscrowModule = _loyaltyERC721EscrowModule;

    emit LoyaltyERC721EscrowModuleSet(
      oldERC721Module,
      _loyaltyERC721EscrowModule
    );
  }

  function setERC1155EscrowModule(
    LoyaltyERC1155Escrow _loyaltyERC1155EscrowModule
  ) public {
    if (msg.sender != creator) revert OnlyLoyaltyCreatorCanSetEscrowModule();

    LoyaltyERC1155Escrow oldERC1155Module = loyaltyERC1155EscrowModule;
    loyaltyERC1155EscrowModule = _loyaltyERC1155EscrowModule;

    emit LoyaltyERC1155EscrowModuleSet(
      oldERC1155Module,
      _loyaltyERC1155EscrowModule
    );
  }
}
