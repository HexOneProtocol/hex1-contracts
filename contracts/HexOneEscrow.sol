// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IHexOneProtocol.sol";
import "./interfaces/IHexOneBootstrap.sol";
import "./interfaces/IHexOneVault.sol";
import "./interfaces/IHexOneEscrow.sol";

contract HexOneEscrow is OwnableUpgradeable, IHexOneEscrow {
    using SafeERC20 for IERC20;

    /// @dev The address of HexOneBootstrap contract.
    address public hexOneBootstrap;

    /// @dev The address of hex token.
    address public hexToken;

    /// @dev The address of $HEX1 token.
    address public hexOneToken;

    /// @dev The address of HexOneProtocol.
    address public hexOneProtocol;

    /// @dev Flag to show hex token already deposited or not.
    bool public collateralDeposited;

    modifier onlyAfterSacrifice {
        require (
            IHexOneBootstrap(hexOneBootstrap).afterSacrificeDuration(), 
            "only after sacrifice"
        );
        _;
    }

    constructor () {
        _disableInitializers();
    }

    function initialize (
        address _hexOneBootstrap,
        address _hexToken,
        address _hexOneToken,
        address _hexOneProtocol
    ) public initializer {
        require (_hexOneBootstrap != address(0), "zero HexOneBootstrap contract address");
        require (_hexToken != address(0), "zero Hex token address");
        require (_hexOneToken != address(0), "zero HexOne token address");
        require (_hexOneProtocol != address(0), "zero HexOneProtocol address");

        hexOneBootstrap = _hexOneBootstrap;
        hexToken = _hexToken;
        hexOneToken = _hexOneToken;
        hexOneProtocol = _hexOneProtocol;
        __Ownable_init();
    }

    /// @inheritdoc IHexOneEscrow
    function balanceOfHex() public view override returns (uint256) {
        return IERC20(hexToken).balanceOf(address(this));
    }

    /// @inheritdoc IHexOneEscrow
    function depositCollateralToHexOneProtocol(uint16 _duration) 
        external 
        onlyAfterSacrifice 
        onlyOwner 
        override 
    {
        uint256 collateralAmount = balanceOfHex();
        require (collateralAmount > 0, "no collateral to deposit");

        IERC20(hexToken).approve(hexOneProtocol, collateralAmount);
        IHexOneProtocol(hexOneProtocol).depositCollateral(
            hexToken, 
            collateralAmount, 
            _duration
        );

        collateralDeposited = true;

        _distributeHexOne();
    }

    /// @inheritdoc IHexOneEscrow
    function reDepositCollateral() external onlyAfterSacrifice override {
        require (collateralDeposited, "collateral not deposited yet");

        IHexOneVault hexOneVault = IHexOneVault(IHexOneProtocol(hexOneProtocol).getVaultAddress(hexToken));
        IHexOneVault.DepositShowInfo[] memory depositInfos = hexOneVault.getUserInfos(address(this));
        require (depositInfos.length > 0, "not deposit pool");
        uint256 depositId = depositInfos[0].depositId;
        IHexOneProtocol(hexOneProtocol).claimCollateral(hexToken, depositId);

        _distributeHexOne();
    }

    /// @notice Distribute $HEX1 token to sacrifice participants.
    /// @dev the distribute amount is based on amount of sacrifice that participant did.
    function _distributeHexOne() internal {
        uint256 hexOneBalance = IERC20(hexOneToken).balanceOf(address(this));
        if (hexOneBalance == 0) return;

        address[] memory participants = IHexOneBootstrap(hexOneBootstrap).getSacrificeParticipants();
        uint256 length = participants.length;
        require (length > 0, "no sacrifice participants");

        uint256 totalAmount = IHexOneBootstrap(hexOneBootstrap).sacrificeHEXITAmount();
        for (uint256 i = 0; i < length; i ++) {
            address participant = participants[i];
            uint256 participantAmount = IHexOneBootstrap(hexOneBootstrap).userRewardsForSacrifice(participant);
            uint256 rewards = hexOneBalance * participantAmount / totalAmount;
            if (rewards > 0) {
                IERC20(hexOneToken).safeTransfer(participant, rewards);
            }
        }
    }

    uint256[100] private __gap;
}