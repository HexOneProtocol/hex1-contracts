// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./utils/TokenUtils.sol";
import "./interfaces/IHexOneBootstrap.sol";
import "./interfaces/IHexOnePriceFeed.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./interfaces/IHEXIT.sol";
import "./interfaces/IHexToken.sol";

/// @notice For sacrifice and airdrop
contract HexOneBootstrap is OwnableUpgradeable, IHexOneBootstrap {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeERC20 for IERC20;

    /// @notice Percent of HEXIT token for sacrifice distribution.
    uint16 public rateForSacrifice;

    /// @notice Percent of HEXIT token for airdrop.
    uint16 public rateForAirdrop;

    /// @notice Distibution rate.
    ///         This percent of HEXIT token goes to middle contract
    ///         for distribute $HEX1 token to sacrifice participants.
    uint16 public sacrificeDistRate;

    /// @notice Percent for will be used for liquidity.
    uint16 public sacrificeLiquidityRate;

    /// @notice Percent for users who has t-shares by staking hex.
    uint16 public airdropDistRateForHexHolder;

    /// @notice Percent for users who has $HEXIT by sacrifice.
    uint16 public airdropDistRateForHEXITHolder;

    /// @notice Percent that will be used for daily airdrop.
    uint16 public distRateForDailyAirdrop; // 50%

    /// @notice Percent that will be supplied daily.
    uint16 public supplyCropRateForSacrifice; // 4.7%

    /// @notice HEXIT token rate will be generated additionally for Staking.
    uint16 public additionalRateForStaking;

    /// @notice HEXIT token rate will be generated addtionally for Team.
    uint16 public additionalRateForTeam;

    /// @notice Allowed token info.
    mapping(address => Token) public allowedTokens;

    /// @notice total sacrificed weight info by daily.
    mapping(uint256 => uint256) public totalSacrificeWeight;

    mapping(uint256 => mapping(address => uint256))
        public totalSacrificeTokenAmount;

    //! For Sacrifice
    /// @notice weight that user sacrificed by daily.
    mapping(uint256 => mapping(address => uint256)) public sacrificeUserWeight;

    /// @notice received HEXIT token amount info per user.
    mapping(address => uint256) public userRewardsForSacrifice;

    /// @notice sacrifice indexes that user sacrificed
    mapping(address => EnumerableSet.UintSet) private userSacrificedIds;

    mapping(address => uint256) public userSacrificedUSD;

    mapping(uint256 => SacrificeInfo) public sacrificeInfos;

    //! For Airdrop
    /// @notice dayIndex that a wallet requested airdrop.
    /// @dev request dayIndex starts from 1.
    mapping(address => RequestAirdrop) public requestAirdropInfo;

    /// @notice Requested amount by daily.
    mapping(uint256 => uint256) public requestedAmountInfo;

    IUniswapV2Router02 public dexRouter;
    address public hexOnePriceFeed;
    address public hexitToken;
    address public hexToken;
    address public pairToken;
    address public escrowCA;
    address public stakingContract;
    address public teamWallet;

    uint256 public sacrificeInitialSupply;
    uint256 public sacrificeStartTime;
    uint256 public sacrificeEndTime;
    uint256 public airdropStartTime;
    uint256 public airdropEndTime;
    uint256 public airdropHEXITAmount;
    uint256 public override sacrificeHEXITAmount;
    uint256 public sacrificeId;
    uint256 public airdropId;

    uint16 public FIXED_POINT;
    bool private amountUpdated;

    EnumerableSet.AddressSet private sacrificeParticipants;
    EnumerableSet.AddressSet private airdropRequestors;

    modifier whenSacrificeDuration() {
        uint256 curTimestamp = block.timestamp;
        require(
            curTimestamp >= sacrificeStartTime &&
                curTimestamp <= sacrificeEndTime,
            "not sacrifice duration"
        );
        _;
    }

    modifier whenAirdropDuration() {
        uint256 curTimestamp = block.timestamp;
        require(
            curTimestamp >= airdropStartTime && curTimestamp <= airdropEndTime,
            "not airdrop duration"
        );
        _;
    }

    modifier onlyAllowedToken(address _token) {
        /// address(0) is native token.
        require(allowedTokens[_token].enable, "not allowed token");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(Param memory _param) public initializer {
        FIXED_POINT = 1000;
        distRateForDailyAirdrop = 500; // 50%
        supplyCropRateForSacrifice = 47; // 4.7%
        sacrificeInitialSupply = 5_555_555 * 1e18;
        additionalRateForStaking = 330; // 33%
        additionalRateForTeam = 500; // 50%

        require(
            _param.hexOnePriceFeed != address(0),
            "zero hexOnePriceFeed address"
        );
        hexOnePriceFeed = _param.hexOnePriceFeed;

        require(
            _param.sacrificeStartTime > block.timestamp,
            "sacrifice: before current time"
        );
        require(_param.sacrificeDuration > 0, "sacrfice: zero duration days");
        sacrificeStartTime = _param.sacrificeStartTime;
        sacrificeEndTime =
            _param.sacrificeStartTime +
            _param.sacrificeDuration *
            1 days;

        require(
            _param.airdropStartTime > sacrificeEndTime,
            "airdrop: before sacrifice"
        );
        require(_param.airdropDuration > 0, "airdrop: zero duration days");
        airdropStartTime = _param.airdropStartTime;
        airdropEndTime =
            _param.airdropStartTime +
            _param.airdropDuration *
            1 days;

        require(_param.dexRouter != address(0), "zero dexRouter address");
        dexRouter = IUniswapV2Router02(_param.dexRouter);

        require(_param.hexToken != address(0), "zero hexToken address");
        require(_param.pairToken != address(0), "zero pairToken address");
        require(_param.hexitToken != address(0), "zero hexit token address");
        hexToken = _param.hexToken;
        pairToken = _param.pairToken;
        hexitToken = _param.hexitToken;

        require(
            _param.rateForSacrifice + _param.rateForAirdrop == FIXED_POINT,
            "distRate: invalid rate"
        );
        rateForSacrifice = _param.rateForSacrifice;
        rateForAirdrop = _param.rateForAirdrop;

        require(
            _param.sacrificeDistRate + _param.sacrificeLiquidityRate ==
                FIXED_POINT,
            "sacrificeRate: invalid rate"
        );
        sacrificeDistRate = _param.sacrificeDistRate;
        sacrificeLiquidityRate = _param.sacrificeLiquidityRate;

        require(
            _param.airdropDistRateForHexHolder +
                _param.airdropDistRateForHEXITHolder ==
                FIXED_POINT,
            "airdropRate: invalid rate"
        );
        airdropDistRateForHexHolder = _param.airdropDistRateForHexHolder;
        airdropDistRateForHEXITHolder = _param.airdropDistRateForHEXITHolder;

        require(
            _param.stakingContract != address(0),
            "zero staking contract address"
        );
        require(_param.teamWallet != address(0), "zero team wallet address");
        stakingContract = _param.stakingContract;
        teamWallet = _param.teamWallet;

        sacrificeId = 1;
        airdropId = 1;

        _distributeHEXITAmount();

        __Ownable_init();
    }

    /// @inheritdoc IHexOneBootstrap
    function afterSacrificeDuration() external view override returns (bool) {
        return block.timestamp > sacrificeEndTime;
    }

    /// @inheritdoc IHexOneBootstrap
    function setEscrowContract(address _escrowCA) external override onlyOwner {
        require(_escrowCA != address(0), "zero escrow contract address");
        escrowCA = _escrowCA;
    }

    /// @inheritdoc IHexOneBootstrap
    function setPriceFeedCA(address _priceFeed) external override onlyOwner {
        require(_priceFeed != address(0), "zero priceFeed contract address");
        hexOnePriceFeed = _priceFeed;
    }

    /// @inheritdoc IHexOneBootstrap
    function isSacrificeParticipant(
        address _user
    ) external view returns (bool) {
        return sacrificeParticipants.contains(_user);
    }

    /// @inheritdoc IHexOneBootstrap
    function getAirdropRequestors() external view returns (address[] memory) {
        return airdropRequestors.values();
    }

    /// @inheritdoc IHexOneBootstrap
    function getSacrificeParticipants()
        external
        view
        returns (address[] memory)
    {
        return sacrificeParticipants.values();
    }

    /// @inheritdoc IHexOneBootstrap
    function setAllowedTokens(
        address[] memory _tokens,
        bool _enable
    ) external override onlyOwner {
        uint256 length = _tokens.length;
        require(length > 0, "invalid length");

        for (uint256 i = 0; i < length; i++) {
            address token = _tokens[i];
            allowedTokens[token].enable = true;
            allowedTokens[token].decimals = TokenUtils.expectDecimals(token);
        }
        emit AllowedTokensSet(_tokens, _enable);
    }

    /// @inheritdoc IHexOneBootstrap
    function setTokenWeight(
        address[] memory _tokens,
        uint16[] memory _weights
    ) external override onlyOwner {
        uint256 length = _tokens.length;
        require(length > 0, "invalid length");
        require(block.timestamp < sacrificeStartTime, "too late to set");

        for (uint256 i = 0; i < length; i++) {
            address token = _tokens[i];
            uint16 weight = _weights[i];
            require(weight >= FIXED_POINT, "invalid weight");
            allowedTokens[token].weight = weight;
        }
        emit TokenWeightSet(_tokens, _weights);
    }

    //! Sacrifice Logic
    /// @inheritdoc IHexOneBootstrap
    function getAmountForSacrifice(
        uint256 _dayIndex
    ) public view override returns (uint256) {
        uint256 todayIndex = getCurrentSacrificeDay();
        require(_dayIndex <= todayIndex, "invalid day index");

        return _calcSupplyAmountForSacrifice(_dayIndex);
    }

    /// @inheritdoc IHexOneBootstrap
    function getCurrentSacrificeDay() public view override returns (uint256) {
        uint256 elapsedTime = block.timestamp - sacrificeStartTime;
        return elapsedTime / 1 days;
    }

    /// @inheritdoc IHexOneBootstrap
    function sacrificeToken(
        address _token,
        uint256 _amount
    ) external whenSacrificeDuration onlyAllowedToken(_token) {
        address sender = msg.sender;
        require(sender != address(0), "zero caller address");
        require(_token != address(0), "zero token address");
        require(_amount > 0, "zero amount");

        IERC20(_token).safeTransferFrom(sender, address(this), _amount);
        _updateSacrificeInfo(sender, _token, _amount);
    }

    /// @inheritdoc IHexOneBootstrap
    function getUserSacrificeInfo(
        address _user
    ) external view override returns (SacrificeInfo[] memory) {
        uint256[] memory ids = userSacrificedIds[_user].values();
        uint256 length = ids.length;

        SacrificeInfo[] memory info = new SacrificeInfo[](length);
        for (uint256 i = 0; i < ids.length; i++) {
            info[i] = sacrificeInfos[ids[i]];
        }

        return info;
    }

    /// @inheritdoc IHexOneBootstrap
    function claimRewardsForSacrifice(uint256 _sacrificeId) external override {
        address sender = msg.sender;
        SacrificeInfo memory info = sacrificeInfos[_sacrificeId];
        uint256 curDay = getCurrentSacrificeDay();
        require(
            userSacrificedIds[sender].contains(_sacrificeId),
            "invalid sacrificeId"
        );
        require(info.day < curDay, "sacrifice duration");

        uint256 dayIndex = info.day;
        uint256 totalWeight = totalSacrificeWeight[dayIndex];
        uint256 userWeight = info.sacrificedWeight;
        uint256 supplyAmount = _calcSupplyAmountForSacrifice(dayIndex);
        uint256 rewardsAmount = ((supplyAmount * userWeight) / totalWeight);

        uint256 sacrificeRewardsAmount = (rewardsAmount * rateForSacrifice) /
            FIXED_POINT;
        userRewardsForSacrifice[sender] += sacrificeRewardsAmount;
        IHEXIT(hexitToken).mintToken(sacrificeRewardsAmount, sender);

        userSacrificedIds[sender].remove(_sacrificeId);

        emit RewardsDistributed();
    }

    //! Airdrop logic
    /// @inheritdoc IHexOneBootstrap
    function getCurrentAirdropDay() public view override returns (uint256) {
        return (block.timestamp - airdropStartTime) / 1 days;
    }

    /// @inheritdoc IHexOneBootstrap
    function requestAirdrop() external override whenAirdropDuration {
        address sender = msg.sender;
        RequestAirdrop storage userInfo = requestAirdropInfo[sender];
        require(sender != address(0), "zero caller address");
        require(userInfo.airdropId == 0, "already requested");

        userInfo.airdropId = (airdropId++);
        userInfo.requestedDay = getCurrentAirdropDay();
        userInfo.sacrificeUSD = userSacrificedUSD[sender];
        userInfo.sacrificeMultiplier = airdropDistRateForHexHolder;
        userInfo.hexShares = _getTotalShareUSD(sender);
        userInfo.hexShareMultiplier = airdropDistRateForHEXITHolder;
        userInfo.totalUSD =
            (userInfo.sacrificeUSD * userInfo.sacrificeMultiplier) /
            FIXED_POINT +
            (userInfo.hexShares * userInfo.hexShareMultiplier) /
            FIXED_POINT;
        require(userInfo.totalUSD > 0, "not have eligible assets for airdrop");
        userInfo.claimedAmount = 0;
        requestedAmountInfo[userInfo.requestedDay] += userInfo.totalUSD;
        airdropRequestors.add(sender);
    }

    /// @inheritdoc IHexOneBootstrap
    function claimAirdrop() external override {
        address sender = msg.sender;
        RequestAirdrop storage userInfo = requestAirdropInfo[sender];
        uint256 dayIndex = userInfo.requestedDay;
        require(sender != address(0), "zero caller address");
        require(userInfo.airdropId > 0, "not requested");
        require(!userInfo.claimed, "already claimed");

        uint256 rewardsAmount = _calcUserRewardsForAirdrop(sender, dayIndex);
        if (rewardsAmount > 0) {
            IHEXIT(hexitToken).mintToken(rewardsAmount, sender);
        }
        userInfo.claimedAmount = rewardsAmount;
        userInfo.claimed = true;
        airdropRequestors.remove(sender);
    }

    /// @inheritdoc IHexOneBootstrap
    function getAirdropClaimHistory(
        address _user
    ) external view override returns (AirdropClaimHistory memory) {
        AirdropClaimHistory memory history;
        RequestAirdrop memory info = requestAirdropInfo[_user];
        if (!info.claimed) {
            return history;
        }

        uint256 dayIndex = info.requestedDay;
        history = AirdropClaimHistory({
            airdropId: info.airdropId,
            requestedDay: dayIndex,
            sacrificeUSD: info.sacrificeUSD,
            sacrificeMultiplier: info.sacrificeMultiplier,
            hexShares: info.hexShares,
            hexShareMultiplier: info.hexShareMultiplier,
            totalUSD: info.totalUSD,
            dailySupplyAmount: _calcAmountForAirdrop(dayIndex),
            claimedAmount: info.claimedAmount,
            shareOfPool: uint16((info.totalUSD * 1000) / requestedAmountInfo[dayIndex])
        });

        return history;
    }

    /// @inheritdoc IHexOneBootstrap
    function generateAdditionalTokens() external onlyOwner {
        require(block.timestamp > airdropEndTime, "before airdrop ends");
        uint256 amountForStaking = (airdropHEXITAmount *
            additionalRateForStaking) / FIXED_POINT;
        uint256 amountForTeam = (airdropHEXITAmount * additionalRateForTeam) /
            FIXED_POINT;

        IHEXIT(hexitToken).mintToken(amountForStaking, stakingContract);
        IHEXIT(hexitToken).mintToken(amountForTeam, teamWallet);
    }

    /// @inheritdoc IHexOneBootstrap
    function withdrawToken(address _token) external override onlyOwner {
        require(block.timestamp > sacrificeEndTime, "sacrifice duration");

        uint256 balance = 0;
        if (_token == address(0)) {
            balance = address(this).balance;
            require(balance > 0, "zero balance");
            (bool sent, ) = (owner()).call{value: balance}("");
            require(sent, "sending ETH failed");
        } else {
            balance = IERC20(_token).balanceOf(address(this));
            require(balance > 0, "zero balance");
            IERC20(_token).safeTransfer(owner(), balance);
        }

        emit Withdrawed(_token, balance);
    }

    receive()
        external
        payable
        whenSacrificeDuration
        onlyAllowedToken(address(0))
    {
        _updateSacrificeInfo(msg.sender, address(0), msg.value);
    }

    function _updateSacrificeInfo(
        address _participant,
        address _token,
        uint256 _amount
    ) internal {
        uint256 usdValue = IHexOnePriceFeed(hexOnePriceFeed).getBaseTokenPrice(
            _token,
            _amount
        );
        (uint256 dayIndex, ) = _getSupplyAmountForSacrificeToday();

        uint16 weight = allowedTokens[_token].weight == 0
            ? FIXED_POINT
            : allowedTokens[_token].weight;
        uint256 sacrificeWeight = (usdValue * weight) / FIXED_POINT;
        totalSacrificeWeight[dayIndex] += sacrificeWeight;
        totalSacrificeTokenAmount[dayIndex][_token] += _amount;
        sacrificeUserWeight[dayIndex][_participant] += sacrificeWeight;
        userSacrificedUSD[_participant] += usdValue;

        if (!sacrificeParticipants.contains(_participant)) {
            sacrificeParticipants.add(_participant);
        }

        sacrificeInfos[sacrificeId] = SacrificeInfo(
            sacrificeId,
            dayIndex,
            getAmountForSacrifice(dayIndex),
            _amount,
            sacrificeWeight,
            usdValue,
            _token,
            weight
        );
        userSacrificedIds[_participant].add(sacrificeId++);

        _processSacrifice(_token, _amount);
    }

    function _getTotalShareUSD(address _user) internal view returns (uint256) {
        uint256 stakeCount = IHexToken(hexToken).stakeCount(_user);
        if (stakeCount == 0) return 0;

        uint256 shares = 0; // decimals = 12
        for (uint256 i = 0; i < stakeCount; i++) {
            IHexToken.StakeStore memory stakeStore = IHexToken(hexToken)
                .stakeLists(_user, i);
            shares += stakeStore.stakeShares;
        }

        IHexToken.GlobalsStore memory globals = IHexToken(hexToken).globals();
        uint256 shareRate = uint256(globals.shareRate); // decimals = 1
        uint256 hexAmount = uint256((shares * shareRate) / 10 ** 5);

        return IHexOnePriceFeed(hexOnePriceFeed).getHexTokenPrice(hexAmount);
    }

    function _getSupplyAmountForSacrificeToday()
        internal
        view
        returns (uint256 day, uint256 supplyAmount)
    {
        uint256 elapsedTime = block.timestamp - sacrificeStartTime;
        uint256 dayIndex = elapsedTime / 1 days;
        supplyAmount = _calcSupplyAmountForSacrifice(dayIndex);

        return (dayIndex, 0);
    }

    function _calcSupplyAmountForSacrifice(
        uint256 _dayIndex
    ) internal view returns (uint256) {
        uint256 supplyAmount = sacrificeInitialSupply;
        for (uint256 i = 0; i < _dayIndex; i++) {
            supplyAmount =
                (supplyAmount * supplyCropRateForSacrifice) /
                FIXED_POINT;
        }

        return supplyAmount;
    }

    function _calcAmountForAirdrop(
        uint256 _dayIndex
    ) internal view returns (uint256) {
        uint256 airdropAmount = airdropHEXITAmount;
        for (uint256 i = 0; i <= _dayIndex; i++) {
            airdropAmount =
                (airdropAmount * distRateForDailyAirdrop) /
                FIXED_POINT;
        }
        return airdropAmount;
    }

    function _processSacrifice(address _token, uint256 _amount) internal {
        uint256 amountForDistribution = (_amount * sacrificeDistRate) /
            FIXED_POINT;
        uint256 amountForLiquidity = _amount - amountForDistribution;

        /// distribution
        _swapToken(_token, hexToken, escrowCA, amountForDistribution);

        /// liquidity
        uint256 swapAmountForLiquidity = amountForLiquidity / 2;
        _swapToken(_token, hexToken, address(this), swapAmountForLiquidity);
        _swapToken(_token, pairToken, address(this), swapAmountForLiquidity);
        uint256 pairTokenBalance = IERC20(pairToken).balanceOf(address(this));
        uint256 hexTokenBalance = IERC20(hexToken).balanceOf(address(this));
        if (pairTokenBalance > 0 && hexTokenBalance > 0) {
            IERC20(pairToken).approve(address(dexRouter), pairTokenBalance);
            IERC20(hexToken).approve(address(dexRouter), hexTokenBalance);
            dexRouter.addLiquidity(
                pairToken,
                hexToken,
                pairTokenBalance,
                hexTokenBalance,
                0,
                0,
                address(this),
                block.timestamp
            );
        }
    }

    /// @notice Swap sacrifice token to hex/pair token.
    /// @param _token The address of sacrifice token.
    /// @param _targetToken The address of token to be swapped to.
    /// @param _recipient The address of recipient.
    /// @param _amount The amount of sacrifice token.
    function _swapToken(
        address _token,
        address _targetToken,
        address _recipient,
        uint256 _amount
    ) internal {
        if (_amount == 0) return;

        address[] memory path = new address[](2);
        if (_token != _targetToken) {
            path[0] = _token == address(0) ? dexRouter.WETH() : _token;
            path[1] = _targetToken;

            if (_token == address(0)) {
                dexRouter.swapExactETHForTokensSupportingFeeOnTransferTokens{
                    value: _amount
                }(0, path, _recipient, block.timestamp);
            } else {
                IERC20(_token).approve(address(dexRouter), _amount);
                dexRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    _amount,
                    0,
                    path,
                    _recipient,
                    block.timestamp
                );
            }
        } else {
            IERC20(_targetToken).safeTransfer(_recipient, _amount);
        }
    }

    function _calcUserRewardsForAirdrop(
        address _user,
        uint256 _dayIndex
    ) internal view returns (uint256) {
        RequestAirdrop memory userInfo = requestAirdropInfo[_user];
        uint256 totalAmount = requestedAmountInfo[_dayIndex];
        uint256 supplyAmount = _calcAmountForAirdrop(_dayIndex);

        return (supplyAmount * userInfo.totalUSD) / totalAmount;
    }

    function _distributeHEXITAmount() internal {
        uint256 sacrificeDuration = sacrificeEndTime - sacrificeStartTime;
        sacrificeDuration = sacrificeDuration / 1 days;
        for (uint256 i = 0; i < sacrificeDuration; i++) {
            uint256 supplyAmount = _calcSupplyAmountForSacrifice(i);
            uint256 sacrificeRewardsAmount = (supplyAmount * rateForSacrifice) /
                FIXED_POINT;
            uint256 airdropAmount = supplyAmount - sacrificeRewardsAmount;
            airdropHEXITAmount += airdropAmount;
            sacrificeHEXITAmount += sacrificeRewardsAmount;
        }
    }

    uint256[100] private __gap;
}
