// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/IHexOneProtocol.sol";
import "./interfaces/IHexOneVault.sol";
import "./interfaces/IHexOneStaking.sol";
import "./interfaces/IHexOneToken.sol";

contract HexOneProtocol is Ownable, IHexOneProtocol {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    EnumerableSet.AddressSet private vaults;

    /// @notice Allowed token info based on allowed vaults.
    EnumerableSet.AddressSet private allowedTokens;

    /// @notice Minimum stake duration. (days)
    uint16 public MIN_DURATION;

    /// @notice Maximum stake duration. (days)
    uint16 public MAX_DURATION;

    /// @notice The address of hex token.
    address public immutable hexToken;

    /// @notice The address of $HEX1.
    address public immutable hexOneToken;

    /// @notice The address of staking master.
    address public stakingMaster;

    /// @notice The address of HexOneEscrow.
    address public hexOneEscrow;

    /// @dev The address to burn tokens.
    address public immutable DEAD;

    uint16 public immutable FIXED_POINT;

    uint8 public immutable version;

    /// @notice Show vault address from token address.
    mapping(address => address) private vaultInfos;

    /// @notice Show deposited token addresses by user.
    mapping(address => EnumerableSet.AddressSet) private depositedTokenInfos;

    /// @notice Fee Info by token.
    mapping(address => Fee) public fees;

    constructor(
        address _hexToken,
        address _hexOneToken,
        address[] memory _vaults,
        address _stakingMaster,
        uint16 _minDuration,
        uint16 _maxDuration
    ) {
        require(_hexOneToken != address(0), "zero $HEX1 token address");
        require(_hexToken != address(0), "zero hex token address");
        require(
            _maxDuration > _minDuration,
            "max Duration is less min duration"
        );
        require(_stakingMaster != address(0), "zero staking master address");
        MIN_DURATION = _minDuration;
        MAX_DURATION = _maxDuration;
        hexOneToken = _hexOneToken;
        _setVaults(_vaults, true);
        stakingMaster = _stakingMaster;
        hexToken = _hexToken;
        version = 1;

        DEAD = 0x000000000000000000000000000000000000dEaD;
        FIXED_POINT = 1000;
    }

    /// @inheritdoc IHexOneProtocol
    function getMaxDuration() external view override returns (uint16) {
        return MAX_DURATION;
    }

    /// @inheritdoc IHexOneProtocol
    function getMinDuration() external view override returns (uint16) {
        return MIN_DURATION;
    }

    /// @inheritdoc IHexOneProtocol
    function setMinDuration(uint16 _minDuration) external override onlyOwner {
        require(
            _minDuration < MAX_DURATION,
            "minDuration is bigger than maxDuration"
        );
        MIN_DURATION = _minDuration;
    }

    /// @inheritdoc IHexOneProtocol
    function setMaxDuration(uint16 _maxDuration) external override onlyOwner {
        require(
            _maxDuration > MIN_DURATION,
            "maxDuration is less than minDuration"
        );
        MAX_DURATION = _maxDuration;
    }

    /// @inheritdoc IHexOneProtocol
    function setVaults(
        address[] calldata _vaults,
        bool _add
    ) external override onlyOwner {
        _setVaults(_vaults, _add);
    }

    /// @inheritdoc IHexOneProtocol
    function setEscrowContract(address _escrowCA) external override onlyOwner {
        require(_escrowCA != address(0), "zero escrow contract address");
        hexOneEscrow = _escrowCA;
    }

    /// @inheritdoc IHexOneProtocol
    function setStakingPool(
        address _stakingMaster
    ) external override onlyOwner {
        require(_stakingMaster != address(0), "zero stakingMaster address");
        stakingMaster = _stakingMaster;
    }

    /// @inheritdoc IHexOneProtocol
    function isAllowedToken(
        address _token
    ) external view override returns (bool) {
        return allowedTokens.contains(_token);
    }

    /// @inheritdoc IHexOneProtocol
    function getVaultAddress(
        address _token
    ) external view override returns (address) {
        return vaultInfos[_token];
    }

    /// @inheritdoc IHexOneProtocol
    function setDepositFee(
        address _token,
        uint16 _fee
    ) external override onlyOwner {
        require(allowedTokens.contains(_token), "not allowed token");
        require(_fee < FIXED_POINT, "invalid fee rate");
        fees[_token] = Fee(_fee, true);
    }

    /// @inheritdoc IHexOneProtocol
    function setDepositFeeEnable(
        address _token,
        bool _enable
    ) external override onlyOwner {
        require(allowedTokens.contains(_token), "not allowed token");
        fees[_token].enabled = _enable;
    }

    /// @inheritdoc IHexOneProtocol
    function borrowHexOne(
        address _token,
        uint256 _depositId,
        uint256 _amount
    ) external override {
        address sender = msg.sender;
        require(sender != address(0), "zero caller address");
        require(allowedTokens.contains(_token), "not allowed token");
        require(
            depositedTokenInfos[sender].contains(_token),
            "not deposited token"
        );

        IHexOneVault hexOneVault = IHexOneVault(vaultInfos[_token]);
        hexOneVault.borrowHexOne(sender, _depositId, _amount);
        IHexOneToken(hexOneToken).mintToken(_amount, sender);
    }

    /// @inheritdoc IHexOneProtocol
    function depositCollateral(
        address _token,
        uint256 _amount,
        uint16 _duration,
        address _depositor
    ) external override {
        address sender = msg.sender;
        require(sender != address(0), "zero address caller");
        require(allowedTokens.contains(_token), "invalid token");
        require(_amount > 0, "invalid amount");
        require(
            _duration >= MIN_DURATION && _duration <= MAX_DURATION,
            "invalid duration"
        );

        IHexOneVault hexOneVault = IHexOneVault(vaultInfos[_token]);
        _amount = _transferDepositTokenWithFee(sender, _token, _amount);
        uint256 mintAmount = hexOneVault.depositCollateral(
            _depositor,
            _amount,
            _duration
        );

        require(mintAmount > 0, "depositing amount is too small to mint $HEX1");
        if (!depositedTokenInfos[_depositor].contains(_token)) {
            depositedTokenInfos[_depositor].add(_token);
        }
        IHexOneToken(hexOneToken).mintToken(mintAmount, sender);

        emit HexOneMint(sender, mintAmount);
    }

    /// @inheritdoc IHexOneProtocol
    function claimCollateral(
        address _token,
        uint256 _depositId
    ) external override returns (uint256) {
        address sender = msg.sender;

        require(sender != address(0), "zero caller address");
        require(allowedTokens.contains(_token), "not allowed token");

        bool restake = (sender == hexOneEscrow);
        (
            uint256 burnAmount,
            uint256 mintAmount,
            uint256 receivedAmount
        ) = IHexOneVault(vaultInfos[_token]).claimCollateral(
                sender,
                _depositId,
                restake
            );

        if (burnAmount > 0) {
            IHexOneToken(hexOneToken).burnToken(burnAmount, sender);
        }

        if (mintAmount > 0) {
            IHexOneToken(hexOneToken).mintToken(mintAmount, sender);
        }

        return receivedAmount;
    }

    /// @inheritdoc IHexOneProtocol
    function claimHex(
        address _token,
        uint256 _depositId
    ) external override returns (uint256) {
        address sender = msg.sender;

        require(sender != address(0), "zero caller address");
        require(allowedTokens.contains(_token), "not allowed token");

        (uint256 burnAmount, uint256 receivedAmount) = IHexOneVault(
            vaultInfos[_token]
        ).claimHex(sender, _depositId);

        if (burnAmount > 0) {
            IHexOneToken(hexOneToken).burnToken(burnAmount, sender);
        }

        return receivedAmount;
    }

    /// @notice Add/Remove vault and base token addresses.
    function _setVaults(address[] memory _vaults, bool _add) internal {
        uint256 length = _vaults.length;
        for (uint256 i = 0; i < length; i++) {
            address vault = _vaults[i];
            address token = IHexOneVault(vault).baseToken();
            require(
                (_add && !vaults.contains(vault)) ||
                    (!_add && vaults.contains(vault)),
                "already set"
            );
            if (_add) {
                vaults.add(vault);
                require(
                    !allowedTokens.contains(token),
                    "already exist vault has same base token"
                );
                allowedTokens.add(token);
                vaultInfos[token] = vault;
            } else {
                vaults.remove(vault);
                allowedTokens.remove(token);
                vaultInfos[token] = address(0);
            }
        }
    }

    /// @notice Transfer token from sender and take fee.
    /// @param _depositor The address of depositor.
    /// @param _token The address of deposit token.
    /// @param _amount The amount of token to deposit.
    /// @return Real token amount without fee.
    function _transferDepositTokenWithFee(
        address _depositor,
        address _token,
        uint256 _amount
    ) internal returns (uint256) {
        uint16 fee = fees[_token].enabled ? fees[_token].feeRate : 0;
        uint256 feeAmount = (_amount * fee) / FIXED_POINT;
        uint256 realAmount = _amount - feeAmount;
        uint256 total = IERC20(_token).balanceOf(_depositor);
        if (total < _amount) _amount = total;
        IERC20(_token).safeTransferFrom(_depositor, address(this), _amount);
        address vaultAddress = vaultInfos[_token];
        require(vaultAddress != address(0), "proper vault is not set");
        IERC20(_token).safeApprove(vaultAddress, 0);
        IERC20(_token).safeApprove(vaultAddress, realAmount);
        IERC20(_token).safeApprove(stakingMaster, 0);
        IERC20(_token).safeApprove(stakingMaster, feeAmount);
        require(version != 1 || _token == hexToken, "wrong purchase token");
        if (feeAmount > 0) {
            IHexOneStaking(stakingMaster).purchaseHex(feeAmount);
        }

        return realAmount;
    }
}
