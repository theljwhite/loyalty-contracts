// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";


contract TestERC721Contract is ERC721Enumerable, AccessControl {
  bytes32 public constant BREEDING_ROLE = bytes32("BREEDING_ROLE");

  uint256 public mintPrice;
  uint256 public maxToMint;
  uint256 public maxMintSupply;
  bool public saleIsActive;
  bool public whitelistSaleIsActive;
  mapping(address => uint256) public whitelistNoodlesAmount;
  IERC20 public paymentsToken;
  string public baseURI;

  event NoodleNamesChanged(uint256 tokenName);
  event PaymentsTokenChanged(IERC20 paymentsToken);
  event BaseURIChanged(string baseURI);
  event SaleStateChanged(bool saleState);
  event WhitelistSaleStateChanged(bool whitelistSaleState);
  event TokenWithdrawn(address token, uint256 amount);

  modifier onlyBreeder() {
    require(hasRole(BREEDING_ROLE, msg.sender), "Not a breeder");
    _;
  }

  modifier onlyOwner() {
    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not an owner");
    _;
  }

  constructor(
    string memory name,
    string memory symbol,
    IERC20 _paymentsToken
  ) ERC721(name, symbol) {
    paymentsToken = _paymentsToken;
    maxMintSupply = 100;
    mintPrice = 100;
    maxToMint = 4;
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
  }

  function setPaymentsToken(IERC20 _paymentsToken) external onlyOwner {
    paymentsToken = _paymentsToken;
    emit PaymentsTokenChanged(paymentsToken);
  }

  function setWhitelistNoodlesAmount(
    address[] calldata users,
    uint256[] calldata noodlesAmount
  ) external onlyOwner {
    require(users.length == noodlesAmount.length, "incorrect arrays");

    for (uint256 i; i < users.length; i++) {
      whitelistNoodlesAmount[users[i]] = noodlesAmount[i];
    }
  }

  function exists(uint256 _tokenId) public view returns (bool) {
    return _exists(_tokenId);
  }

  function setMintPrice(uint256 _price) external onlyOwner {
    mintPrice = _price;
  }

  function setMaxMintSupply(uint256 _maxValue) external onlyOwner {
    require(_maxValue > maxMintSupply, "Invalid new max value");
    maxMintSupply = _maxValue;
  }

  function setMaxToMint(uint256 _maxValue) external onlyOwner {
    maxToMint = _maxValue;
  }

  function _baseURI() internal view override returns (string memory) {
    return baseURI;
  }


  function setBaseURI(string memory _newBaseURI) external onlyOwner {
    baseURI = _newBaseURI;
    emit BaseURIChanged(_newBaseURI);
  }

  function setSaleState(bool _status) external onlyOwner {
    saleIsActive = _status;
    emit SaleStateChanged(_status);
  }

  function setWhitelistSaleState(bool _status) external onlyOwner {
    whitelistSaleIsActive = _status;
    emit WhitelistSaleStateChanged(_status);
  }

  function reserveNoodles(address _to, uint256 _numberOfTokens)
    external
    onlyOwner
  {
    require(_to != address(0), "Invalid address to reserve");
    uint256 supply = totalSupply();

    for (uint256 i; i < _numberOfTokens; i++) {
      _safeMint(_to, supply + i);
      
    }
  }

  function whitelistMintNoodles(uint256 numberOfTokens) external {
    require(whitelistSaleIsActive, "The sale must be active to mint");
    require(
      numberOfTokens <= whitelistNoodlesAmount[msg.sender],
      "You are not allowed to mint this amount"
    );
    require(
      totalSupply() + numberOfTokens <= maxMintSupply,
      "Purchase exceeds max supply"
    );
    paymentsToken.transferFrom(
      msg.sender,
      address(this),
      mintPrice * numberOfTokens
    );

    whitelistNoodlesAmount[msg.sender] -= numberOfTokens;

    for (uint256 i; i < numberOfTokens; i++) {
      uint256 mintIndex = totalSupply();
      _safeMint(msg.sender, mintIndex);
     
    }
  }

  function mintNoodles(uint256 numberOfTokens) external {
    require(saleIsActive, "Sale must be active to mint");
    require(numberOfTokens <= maxToMint, "Invalid amount to mint");
    require(
      totalSupply() + numberOfTokens <= maxMintSupply,
      "Purchase exceeds max supply"
    );
    paymentsToken.transferFrom(
      msg.sender,
      address(this),
      mintPrice * numberOfTokens
    );

    for (uint256 i; i < numberOfTokens; i++) {
      uint256 mintIndex = totalSupply();
      _safeMint(msg.sender, mintIndex);
      
    }
  }

  function createDough(address owner) external onlyBreeder {
    uint256 mintIndex = totalSupply();
    _safeMint(owner, mintIndex);
  }

  function withdrawTokens(address token, uint256 amount) external onlyOwner {
    IERC20(token).transfer(msg.sender, amount);
    emit TokenWithdrawn(msg.sender, amount);
  }

  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 tokenId
  ) internal override(ERC721Enumerable) {
    super._beforeTokenTransfer(from, to, tokenId);
  }

  function supportsInterface(bytes4 interfaceId)
    public
    view
    override(ERC721Enumerable, AccessControl)
    returns (bool)
  {
    return super.supportsInterface(interfaceId);
  }
}
