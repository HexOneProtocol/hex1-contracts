// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./utils/TokenUtils.sol";
import "./interfaces/IHexOneBootstrap.sol";
import "./interfaces/IHexOneStaking.sol";
import "./interfaces/IHexOnePriceFeed.sol";
import "./interfaces/IHexOneProtocol.sol";
import "./interfaces/pulsex/IPulseXPair.sol";
import "./interfaces/pulsex/IPulseXRouter.sol";
import "./interfaces/pulsex/IPulseXFactory.sol";
import "./interfaces/IHEXIT.sol";
import "./interfaces/IHexToken.sol";
import "./interfaces/IToken.sol";
import "./interfaces/IWETH9.sol";

/// @notice For sacrifice and airdrop
contract HexOneBootstrap is OwnableUpgradeable, IHexOneBootstrap {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;
    using SafeERC20 for IERC20;

    uint16 public rateForSacrifice;

    uint16 public rateForAirdrop;

    uint16 public sacrificeDistRate;

    uint16 public sacrificeLiquidityRate;

    uint16 public airdropDistRateForHexHolder;

    uint16 public airdropDistRateForHEXITHolder;

    uint16 public distRateForDailyAirdrop; // 50%

    uint16 public supplyCropRateForSacrifice; // 4.7%

    uint16 public additionalRateForStaking;

    uint16 public additionalRateForTeam;

    uint16 public sliceRate;

    /// @notice Allowed token info.
    mapping(address => Token) public allowedTokens;

    mapping(uint256 => uint256) public totalSacrificeWeight;

    mapping(uint256 => mapping(address => uint256))
        public totalSacrificeTokenAmount;

    mapping(uint256 => mapping(address => uint256)) public sacrificeUserWeight;

    mapping(address => uint256) public userRewardsForSacrifice;

    mapping(address => EnumerableSet.UintSet) private userSacrificedIds;

    mapping(address => uint256) public userSacrificedUSD;

    mapping(uint256 => SacrificeInfo) public sacrificeInfos;

    mapping(address => RequestAirdrop) public requestAirdropInfo;

    mapping(uint256 => uint256) public requestedAmountInfo;

    IPulseXRouter02 public dexRouter;
    address public hexOneProtocol;
    address public hexOnePriceFeed;
    address public hexitToken;
    address public hexToken;
    address public hexOneToken;
    address public pairToken;
    address public escrowCA;
    address public stakingContract;
    address public teamWallet;

    uint256 public sacrificeInitialSupply;
    uint256 public sacrificeStartTime;
    uint256 public sacrificeEndTime;
    uint256 public airdropStartTime;
    uint256 public airdropEndTime;
    uint256 public HEXITAmountForAirdrop;
    uint256 public override HEXITAmountForSacrifice;
    uint256 public sacrificeId;
    uint256 public airdropId;

    uint16 public FIXED_POINT;
    bool private amountUpdated;
    bool public hexitPurchased;

    EnumerableSet.AddressSet private sacrificeParticipants;
    EnumerableSet.AddressSet private airdropRequestors;

    modifier whenSacrificeDuration() {
        uint256 curTimestamp = block.timestamp;
        require(
            curTimestamp > sacrificeStartTime &&
                curTimestamp < sacrificeEndTime,
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

    function initialize(Param calldata _param) public initializer {
        FIXED_POINT = 1000;
        sliceRate = 5; // 0.5%
        distRateForDailyAirdrop = 500; // 50%
        supplyCropRateForSacrifice = 47; // 4.7%
        sacrificeInitialSupply = 5_555_555 * 1e18;
        additionalRateForStaking = 330; // 33%
        additionalRateForTeam = 500; // 50%

        hexOneProtocol = _param.hexOneProtocol;
        hexOnePriceFeed = _param.hexOnePriceFeed;

        sacrificeStartTime = _param.sacrificeStartTime;
        sacrificeEndTime =
            _param.sacrificeStartTime +
            _param.sacrificeDuration *
            1 days;

        airdropStartTime = _param.airdropStartTime;
        airdropEndTime =
            _param.airdropStartTime +
            _param.airdropDuration *
            1 days;

        dexRouter = IPulseXRouter02(_param.dexRouter);

        hexToken = _param.hexToken;
        hexOneToken = _param.hexOneToken;
        pairToken = _param.pairToken;
        hexitToken = _param.hexitToken;

        rateForSacrifice = _param.rateForSacrifice;
        rateForAirdrop = _param.rateForAirdrop;

        sacrificeDistRate = _param.sacrificeDistRate;
        sacrificeLiquidityRate = _param.sacrificeLiquidityRate;

        airdropDistRateForHexHolder = _param.airdropDistRateForHexHolder;
        airdropDistRateForHEXITHolder = _param.airdropDistRateForHEXITHolder;

        stakingContract = _param.stakingContract;
        teamWallet = _param.teamWallet;

        sacrificeId = 1;
        airdropId = 1;

        _splitHEXITAmount();

        __Ownable_init();
    }

    function afterSacrificeDuration() external view override returns (bool) {
        return block.timestamp > sacrificeEndTime;
    }

    function setEscrowContract(address _escrowCA) external override onlyOwner {
        require(_escrowCA != address(0), "zero escrow contract address");
        escrowCA = _escrowCA;
    }

    function setPriceFeedCA(address _priceFeed) external override onlyOwner {
        require(_priceFeed != address(0), "zero priceFeed contract address");
        hexOnePriceFeed = _priceFeed;
    }

    function isSacrificeParticipant(
        address _user
    ) external view returns (bool) {
        return sacrificeParticipants.contains(_user);
    }

    function getAirdropRequestors() external view returns (address[] memory) {
        return airdropRequestors.values();
    }

    function getSacrificeParticipants()
        external
        view
        returns (address[] memory)
    {
        return sacrificeParticipants.values();
    }

    function setAllowedTokens(
        address[] calldata _tokens,
        bool _enable
    ) external override onlyOwner {
        uint256 length = _tokens.length;
        require(length > 0, "invalid length");

        for (uint256 i = 0; i < length; i++) {
            address token = _tokens[i];
            if (_enable) {
                require(
                    allowedTokens[token].weight != 0,
                    "token weight is not set yet"
                );
                allowedTokens[token].decimals = TokenUtils.expectDecimals(
                    token
                );
            }
            allowedTokens[token].enable = _enable;
        }
        emit AllowedTokensSet(_tokens, _enable);
    }

    function setTokenWeight(
        address[] calldata _tokens,
        uint16[] calldata _weights
    ) external override onlyOwner {
        uint256 length = _tokens.length;
        require(length > 0, "invalid length");
        require(length == _weights.length, "array mismatched");
        require(block.timestamp < sacrificeStartTime, "too late to set");

        for (uint256 i = 0; i < length; i++) {
            address token = _tokens[i];
            uint16 weight = _weights[i];
            require(weight >= FIXED_POINT, "invalid weight");
            allowedTokens[token].weight = weight;
        }
        emit TokenWeightSet(_tokens, _weights);
    }

    function getAmountForSacrificeByDay(
        uint256 _dayIndex
    ) public view override returns (uint256) {
        uint256 todayIndex = getCurrentSacrificeDay();
        require(_dayIndex > 0 && _dayIndex <= todayIndex, "invalid day index");
        return _calcSupplyAmountForSacrificeByDay(_dayIndex - 1);
    }

    function getCurrentSacrificeDay() public view override returns (uint256) {
        if (block.timestamp <= sacrificeStartTime) {
            return 0;
        }
        uint256 endTime = block.timestamp > sacrificeEndTime
            ? sacrificeEndTime
            : block.timestamp;
        uint256 elapsedTime = endTime - sacrificeStartTime;
        return elapsedTime / 1 days + 1;
    }

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

    function getUserSacrificeInfo(
        address _user
    ) external view override returns (SacrificeInfo[] memory) {
        uint256[] memory ids = userSacrificedIds[_user].values();
        uint256 length = ids.length;

        SacrificeInfo[] memory info = new SacrificeInfo[](length);
        for (uint256 i = 0; i < ids.length; i++) {
            info[i] = sacrificeInfos[ids[i]];
            info[i].day = sacrificeInfos[ids[i]].day + 1;
        }

        return info;
    }

    function claimRewardsForSacrifice(uint256 _sacrificeId) external override {
        address sender = msg.sender;
        SacrificeInfo storage info = sacrificeInfos[_sacrificeId];
        uint256 curDay;
        require(
            (curDay = getCurrentSacrificeDay()) > 0,
            "sacrifice not started"
        );
        curDay = curDay - 1;
        require(
            userSacrificedIds[sender].contains(_sacrificeId),
            "invalid sacrificeId"
        );
        require(!info.claimed, "already claimed");
        require(info.day < curDay, "sacrifice duration");

        info.claimed = true;

        uint256 totalWeight = totalSacrificeWeight[info.day];
        uint256 supplyAmount = info.supplyAmount;
        uint256 userWeight = info.sacrificedWeight;
        uint256 rewardsHexitAmount = (supplyAmount * userWeight) / totalWeight;
        userRewardsForSacrifice[sender] += rewardsHexitAmount;
        IHEXIT(hexitToken).mintToken(rewardsHexitAmount, sender);

        emit RewardsDistributed();
    }

    function getCurrentAirdropDay() public view override returns (uint256) {
        if (block.timestamp <= airdropStartTime) {
            return 0;
        }
        uint256 endTime = block.timestamp > airdropEndTime
            ? airdropEndTime
            : block.timestamp;
        uint256 elapsedTime = endTime - airdropStartTime;
        return elapsedTime / 1 days;
    }

    function getAirdropSupplyAmount(
        uint256 _dayIndex
    ) external view override returns (uint256) {
        uint256 curDay = getCurrentAirdropDay();
        require(_dayIndex <= curDay, "invalid dayIndex");
        return _calcAmountForAirdrop(_dayIndex);
    }

    function getCurrentAirdropInfo(
        address _user
    ) external view override returns (AirdropPoolInfo memory) {
        RequestAirdrop memory userInfo = requestAirdropInfo[_user];
        AirdropPoolInfo memory airdropPoolInfo;

        if (userInfo.airdropId == 0) {
            uint256 curDay = getCurrentAirdropDay();
            uint256 curPoolAmount = requestedAmountInfo[curDay];
            uint256 sacrificeAmount = userSacrificedUSD[_user];
            uint256 shareAmount = _getTotalShareUSD(_user);
            uint256 userWeight = (sacrificeAmount *
                airdropDistRateForHEXITHolder) /
                FIXED_POINT +
                (shareAmount * airdropDistRateForHexHolder) /
                FIXED_POINT;
            uint16 shareOfPool = uint16(
                (userWeight * FIXED_POINT) / (curPoolAmount + userWeight)
            );

            airdropPoolInfo = AirdropPoolInfo({
                sacrificedAmount: sacrificeAmount,
                stakingShareAmount: shareAmount,
                curAirdropDay: curDay,
                curDayPoolAmount: curPoolAmount + userWeight,
                curDaySupplyHEXIT: _calcAmountForAirdrop(curDay),
                sacrificeDistRate: airdropDistRateForHEXITHolder,
                stakingDistRate: airdropDistRateForHexHolder,
                shareOfPool: shareOfPool
            });
        } else {
            uint256 day = userInfo.requestedDay;
            uint256 curPoolAmount = requestedAmountInfo[day];
            uint256 userWeight = userInfo.totalUSD;
            uint16 shareOfPool = uint16(
                (userWeight * FIXED_POINT) / (curPoolAmount)
            );
            airdropPoolInfo = AirdropPoolInfo({
                sacrificedAmount: userInfo.sacrificeUSD,
                stakingShareAmount: userInfo.hexShares,
                curAirdropDay: day,
                curDayPoolAmount: curPoolAmount,
                curDaySupplyHEXIT: _calcAmountForAirdrop(day),
                sacrificeDistRate: airdropDistRateForHEXITHolder,
                stakingDistRate: airdropDistRateForHexHolder,
                shareOfPool: shareOfPool
            });
        }

        return airdropPoolInfo;
    }

    function requestAirdrop() external override whenAirdropDuration {
        address sender = msg.sender;
        RequestAirdrop storage userInfo = requestAirdropInfo[sender];
        require(sender != address(0), "zero caller address");
        require(userInfo.airdropId == 0, "already requested");

        userInfo.airdropId = (airdropId++);
        userInfo.requestedDay = getCurrentAirdropDay();
        userInfo.sacrificeUSD = userSacrificedUSD[sender];
        userInfo.sacrificeMultiplier = airdropDistRateForHEXITHolder;
        userInfo.hexShares = _getTotalShareUSD(sender);
        userInfo.hexShareMultiplier = airdropDistRateForHexHolder;
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

    function claimAirdrop() external override {
        address sender = msg.sender;
        RequestAirdrop storage userInfo = requestAirdropInfo[sender];

        uint256 dayIndex = userInfo.requestedDay;
        uint256 curDay = getCurrentAirdropDay();
        require(sender != address(0), "zero caller address");
        require(userInfo.airdropId > 0, "not requested");
        require(!userInfo.claimed, "already claimed");
        require(dayIndex < curDay, "in airdrop duration");

        uint256 rewardsAmount = _calcUserRewardsForAirdrop(sender, dayIndex);
        if (rewardsAmount > 0) {
            IHEXIT(hexitToken).mintToken(rewardsAmount, sender);
        }
        userInfo.claimedAmount = rewardsAmount;
        userInfo.claimed = true;
        airdropRequestors.remove(sender);
    }

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
            shareOfPool: uint16(
                (info.totalUSD * FIXED_POINT) / requestedAmountInfo[dayIndex]
            )
        });

        return history;
    }

    function generateAdditionalTokens() external onlyOwner {
        require(block.timestamp > airdropEndTime, "before airdrop ends");
        require(!hexitPurchased, "already purchased");
        uint256 totalAmount = HEXITAmountForAirdrop + HEXITAmountForSacrifice;
        uint256 amountForStaking = (totalAmount * additionalRateForStaking) /
            FIXED_POINT;
        uint256 amountForTeam = (totalAmount * additionalRateForTeam) /
            FIXED_POINT;
        hexitPurchased = true;

        IHEXIT(hexitToken).mintToken(amountForStaking, address(this));
        IHEXIT(hexitToken).approve(stakingContract, amountForStaking);
        IHEXIT(hexitToken).mintToken(amountForTeam, teamWallet);

        IHexOneStaking(stakingContract).purchaseHexit(amountForStaking);
    }

    function withdrawToken(address _token) external override onlyOwner {
        require(block.timestamp > sacrificeEndTime, "sacrifice duration");

        uint256 balance = 0;
        if (_token == address(0)) {
            balance = address(this).balance;
            require(balance > 0, "zero balance");
            _transferETH(owner(), balance);
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
        uint256 dayIndex = getCurrentSacrificeDay();
        require(dayIndex > 0, "before sacrifice startTime");
        dayIndex -= 1;

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
        uint256 sacrificeDayAmount = getAmountForSacrificeByDay(dayIndex + 1);

        sacrificeInfos[sacrificeId] = SacrificeInfo(
            sacrificeId,
            dayIndex,
            sacrificeDayAmount,
            _amount,
            sacrificeWeight,
            usdValue,
            _token,
            IToken(_token).symbol(),
            weight,
            false
        );
        userSacrificedIds[_participant].add(sacrificeId++);

        _processSacrifice(_token, _amount, _participant);
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

    function _calcSupplyAmountForSacrificeByDay(
        uint256 _dayIndex
    ) internal view returns (uint256) {
        uint256 supplyAmount = sacrificeInitialSupply;
        for (uint256 i = 0; i < _dayIndex; i++) {
            supplyAmount =
                (supplyAmount * (FIXED_POINT - supplyCropRateForSacrifice)) /
                FIXED_POINT;
        }

        return supplyAmount;
    }

    function _calcAmountForAirdrop(
        uint256 _dayIndex
    ) internal view returns (uint256) {
        uint256 airdropAmount = HEXITAmountForAirdrop;
        for (uint256 i = 0; i <= _dayIndex; i++) {
            airdropAmount =
                (airdropAmount * distRateForDailyAirdrop) /
                FIXED_POINT;
        }
        return airdropAmount;
    }

    function _processSacrifice(
        address _token,
        uint256 _amount,
        address _participant
    ) internal {
        uint256 amountForDistribution = (_amount * sacrificeDistRate) /
            FIXED_POINT;
        uint256 amountForLiquidity = _amount - amountForDistribution;

        /// distribution
        _swapToken(_token, hexToken, escrowCA, amountForDistribution);

        /// liquidity
        uint256 swapAmountForLiquidity = amountForLiquidity / 2;
        uint256 swappedHexAmount = _swapToken(
            _token,
            hexToken,
            address(this),
            swapAmountForLiquidity
        );
        uint16 minDuration = IHexOneProtocol(hexOneProtocol).getMinDuration();
        if (_token != hexToken) {
            IERC20(hexToken).approve(hexOneProtocol, swappedHexAmount);
            IHexOneProtocol(hexOneProtocol).depositCollateral(
                hexToken,
                swappedHexAmount,
                minDuration,
                _participant
            );
        } else {
            IERC20(hexToken).approve(hexOneProtocol, swapAmountForLiquidity);
            IHexOneProtocol(hexOneProtocol).depositCollateral(
                hexToken,
                swapAmountForLiquidity,
                minDuration,
                _participant
            );
        }

        _swapToken(_token, pairToken, address(this), swapAmountForLiquidity);
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
    ) internal returns (uint256) {
        if (_amount == 0) return 0;

        address[] memory path = new address[](2);
        address WETH = dexRouter.WPLS();
        if (_token != _targetToken) {
            path[0] = _token == address(0) ? dexRouter.WPLS() : _token;
            path[1] = _targetToken;
            uint256[] memory amounts = dexRouter.getAmountsOut(_amount, path);
            uint256 minAmountOut = (amounts[1] * sliceRate) / FIXED_POINT;
            minAmountOut = amounts[1] - minAmountOut;

            uint256 beforeBal = IERC20(_targetToken).balanceOf(_recipient);
            if (_token == address(0)) {
                if (_targetToken == WETH) {
                    IWETH9(WETH).deposit{value: _amount}();
                    IERC20(WETH).safeTransfer(_recipient, _amount);
                } else {
                    dexRouter
                        .swapExactETHForTokensSupportingFeeOnTransferTokens{
                        value: _amount
                    }(0, path, _recipient, block.timestamp);
                }
            } else {
                IERC20(_token).approve(address(dexRouter), _amount);
                dexRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    _amount,
                    minAmountOut,
                    path,
                    _recipient,
                    block.timestamp
                );
            }
            uint256 afterBal = IERC20(_targetToken).balanceOf(_recipient);
            return afterBal - beforeBal;
        } else {
            IERC20(_targetToken).safeTransfer(_recipient, _amount);
            return _amount;
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

    function _splitHEXITAmount() internal {
        uint256 sacrificeDuration = sacrificeEndTime - sacrificeStartTime;
        sacrificeDuration = sacrificeDuration / 1 days;
        for (uint256 i = 0; i < sacrificeDuration; i++) {
            uint256 supplyAmount = _calcSupplyAmountForSacrificeByDay(i);
            uint256 amountForSacrifice = (supplyAmount * rateForSacrifice) /
                FIXED_POINT;
            uint256 amountForAirdrop = supplyAmount - amountForSacrifice;
            HEXITAmountForAirdrop += amountForAirdrop;
            HEXITAmountForSacrifice += amountForSacrifice;
        }
    }

    function _transferETH(address _recipient, uint256 _amount) internal {
        (bool sent, ) = _recipient.call{value: _amount}("");
        require(sent, "sending ETH failed");
    }

    uint256[100] private __gap;
}
