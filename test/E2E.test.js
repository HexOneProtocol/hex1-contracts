const { expect } = require("chai");
const { ethers } = require("hardhat");
const { constants } = require("@openzeppelin/test-helpers");

const { pulsex_abi } = require("../external_abi/pulsex.abi.json");
const { erc20_abi } = require("../external_abi/erc20.abi.json");
const { hex_abi } = require("../external_abi/hex.abi.json");

const {
    deploy,
    bigNum,
    sendETHTo,
    getCurrentTimestamp,
    smallNum,
    spendTime,
    day,
    deployProxy,
    hour,
    getETHBalance,
} = require("../scripts/utils");

describe("HexOne Protocol", function () {
    let usdcAddress = "0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07";
    let hexTokenAddress = "0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39";
    let pulsexRouterAddress = "0x98bf93ebf5c380C0e6Ae8e192A7e2AE08edAcc02";
    let WPLS;

    before(async function () {
        [
            this.deployer,
            this.depositor_1,
            this.depositor_2,
            this.depositor_3,
            this.staker_1,
            this.staker_2,
            this.sacrificer_1,
            this.sacrificer_2,
            this.hex_staker,
            this.feeReceiver,
            this.liquidator,
            this.teamFinance,
        ] = await ethers.getSigners();

        this.dexRouter = new ethers.Contract(
            pulsexRouterAddress,
            pulsex_abi,
            this.deployer
        );
        this.hexToken = new ethers.Contract(
            hexTokenAddress,
            hex_abi,
            this.deployer
        );
        this.USDC = new ethers.Contract(usdcAddress, erc20_abi, this.deployer);

        this.hexOneToken = await deploy(
            "HexOneToken",
            "HexOneToken",
            "HexOne",
            "HEXONE"
        );

        this.hexOneToken = await deploy(
            "HexOneMockToken",
            "HexOneMockToken",
            "HexOne",
            "HEXONE"
        );
        this.hexOnePriceFeed = await deployProxy(
            "HexOnePriceFeedTest",
            "HexOnePriceFeedTest",
            [this.hexToken.address, usdcAddress, this.dexRouter.address]
        );
        this.HEXIT = await deploy(
            "HEXIT",
            "HEXIT",
            "Hex Incentive Token",
            "HEXIT"
        );
        this.hexOneVault = await deployProxy("HexOneVault", "HexOneVault", [
            this.hexToken.address,
            this.hexOnePriceFeed.address,
        ]);
        this.staking = await deployProxy("HexOneStaking", "HexOneStaking", [
            this.hexToken.address,
            this.HEXIT.address,
            50, // 5% HEXIT dist
            100, // 10% HEX$1 dist
        ]);
        this.hexOneProtocol = await deploy(
            "HexOneProtocol",
            "HexOneProtocol",
            this.hexToken.address,
            this.hexOneToken.address,
            [this.hexOneVault.address],
            this.staking.address,
            30,
            120
        );

        let sacrificeStartTime = await getCurrentTimestamp();
        sacrificeStartTime = BigInt(sacrificeStartTime) + BigInt(hour);
        let sacrificeDuration = 100; // 100 days.

        let airdropStarTime =
            BigInt(sacrificeStartTime) +
            BigInt(day) * BigInt(sacrificeDuration) +
            BigInt(day);
        let airdropDuration = 100; // 100 days.

        let bootstrapParam = {
            hexOneProtocol: this.hexOneProtocol.address,
            hexOnePriceFeed: this.hexOnePriceFeed.address,
            dexRouter: this.dexRouter.address,
            hexToken: this.hexToken.address,
            hexOneToken: this.hexOneToken.address,
            pairToken: usdcAddress,
            hexitToken: this.HEXIT.address,
            stakingContract: this.staking.address,
            teamWallet: this.teamFinance.address,
            sacrificeStartTime: sacrificeStartTime,
            airdropStartTime: airdropStarTime,
            sacrificeDuration: sacrificeDuration,
            airdropDuration: airdropDuration,
            rateForSacrifice: 800, // 80%
            rateForAirdrop: 200, // 20%
            sacrificeDistRate: 750, // 75%
            sacrificeLiquidityRate: 250, // 25%
            airdropDistRateForHexHolder: 700, // 70%
            airdropDistRateForHEXITHolder: 300, // 30%
        };

        this.hexOneBootstrap = await deployProxy(
            "HexOneBootstrap",
            "HexOneBootstrap",
            [bootstrapParam]
        );

        this.hexOneEscrow = await deployProxy("HexOneEscrow", "HexOneEscrow", [
            this.hexOneBootstrap.address,
            this.hexToken.address,
            this.hexOneToken.address,
            this.hexOneProtocol.address,
            this.hexOnePriceFeed.address,
        ]);
    });

    it("check deployment", async function () {
        console.log("deployed successfully!");
    });

    describe("initialize", function () {
        it("initialize", async function () {
            await this.hexOneProtocol.setEscrowContract(
                this.hexOneEscrow.address
            );
            await this.hexOneToken.setAdmin(this.hexOneProtocol.address);
            await this.hexOneVault.setHexOneProtocol(
                this.hexOneProtocol.address
            );
            await this.hexOneBootstrap.setEscrowContract(
                this.hexOneEscrow.address
            );
            await this.HEXIT.setBootstrap(this.hexOneBootstrap.address);
            await this.staking.setBaseData(
                this.hexOneProtocol.address,
                this.hexOneBootstrap.address
            );
        });

        it("add allowed tokens to staking pool contract", async function () {
            await this.staking.addAllowedTokens(
                [this.hexToken.address],
                [
                    {
                        hexDistRate: 1000,
                        hexitDistRate: 0,
                    },
                ]
            );
        });

        it("buy hex token", async function () {
            let ethAmountForBuy = bigNum(200, 18);
            let WPLSAddress = await this.dexRouter.WPLS();

            let amounts = await this.dexRouter.getAmountsOut(
                BigInt(ethAmountForBuy),
                [WPLSAddress, this.hexToken.address]
            );
            let expectHexTokenAmount = amounts[1];

            let beforeBal = await this.hexToken.balanceOf(
                this.deployer.address
            );
            await this.dexRouter.swapExactETHForTokens(
                0,
                [WPLSAddress, this.hexToken.address],
                this.deployer.address,
                BigInt(await getCurrentTimestamp()) + BigInt(100),
                { value: BigInt(ethAmountForBuy) }
            );
            let afterBal = await this.hexToken.balanceOf(this.deployer.address);

            expect(smallNum(afterBal, 8) - smallNum(beforeBal, 8)).to.be.equal(
                smallNum(expectHexTokenAmount, 8)
            );

            let transferAmount = BigInt(expectHexTokenAmount) / BigInt(6);
            await this.hexToken.transfer(
                this.staker_1.address,
                BigInt(transferAmount)
            );
            await this.hexToken.transfer(
                this.staker_2.address,
                BigInt(transferAmount)
            );
        });

        it("buy USDC token", async function () {
            let ethAmountForBuy = bigNum(1000, 18);
            let WPLSAddress = await this.dexRouter.WPLS();

            let amounts = await this.dexRouter.getAmountsOut(
                BigInt(ethAmountForBuy),
                [WPLSAddress, this.USDC.address]
            );
            let expectUSDCTokenAmount = amounts[1];

            let beforeBal = await this.USDC.balanceOf(this.deployer.address);
            await this.dexRouter.swapExactETHForTokens(
                0,
                [WPLSAddress, this.USDC.address],
                this.deployer.address,
                BigInt(await getCurrentTimestamp()) + BigInt(100),
                { value: BigInt(ethAmountForBuy) }
            );
            let afterBal = await this.USDC.balanceOf(this.deployer.address);

            expect(
                smallNum(afterBal, 8) - smallNum(beforeBal, 8)
            ).to.be.closeTo(smallNum(expectUSDCTokenAmount, 8), 0.0001);

            let transferAmount = BigInt(expectUSDCTokenAmount) / BigInt(6);
            await this.USDC.transfer(
                this.staker_1.address,
                BigInt(transferAmount)
            );
            await this.USDC.transfer(
                this.staker_2.address,
                BigInt(transferAmount)
            );
        });
    });

    describe("Sacrifice and Airdrop", function () {
        describe("Sacrifice", function () {
            it("set allowed tokens and token weight", async function () {
                await expect(
                    this.hexOneBootstrap.setAllowedTokens(
                        [this.USDC.address, this.hexToken.address],
                        true
                    )
                ).to.be.revertedWith("token weight is not set yet");

                await this.hexOneBootstrap.setTokenWeight(
                    [this.USDC.address, this.hexToken.address],
                    [3000, 5555]
                );

                await this.hexOneBootstrap.setAllowedTokens(
                    [this.USDC.address, this.hexToken.address],
                    true
                );
            });

            it("sacrifice USDC", async function () {
                let sacrificeUSDCAmount = await this.USDC.balanceOf(
                    this.deployer.address
                );
                sacrificeUSDCAmount = BigInt(sacrificeUSDCAmount) / BigInt(5);
                console.log(
                    "USDC amount to sacrifice",
                    smallNum(sacrificeUSDCAmount, 6)
                );
                await this.USDC.transfer(
                    this.sacrificer_1.address,
                    BigInt(sacrificeUSDCAmount)
                );

                await expect(
                    this.hexOneBootstrap
                        .connect(this.sacrificer_1)
                        .sacrificeToken(
                            this.USDC.address,
                            BigInt(sacrificeUSDCAmount)
                        )
                ).to.be.revertedWith("not sacrifice duration");

                await spendTime(day * 1);

                await this.USDC.connect(this.sacrificer_1).approve(
                    this.hexOneBootstrap.address,
                    BigInt(sacrificeUSDCAmount)
                );
                let beforeHexBal = await this.hexToken.balanceOf(
                    this.hexOneEscrow.address
                );
                await this.hexOneBootstrap
                    .connect(this.sacrificer_1)
                    .sacrificeToken(
                        this.USDC.address,
                        BigInt(sacrificeUSDCAmount)
                    );
                let afterHexBal = await this.hexToken.balanceOf(
                    this.hexOneEscrow.address
                );
                let receivedAmount = BigInt(afterHexBal) - BigInt(beforeHexBal);

                console.log(
                    "hex amount that escrow contract received: ",
                    smallNum(receivedAmount, 8)
                );
                expect(smallNum(receivedAmount, 8)).to.be.greaterThan(0);
                console.log(
                    "sacrifice token and hex token balance after sacrifice",
                    smallNum(
                        await this.USDC.balanceOf(this.hexOneBootstrap.address),
                        6
                    ),
                    smallNum(
                        await this.hexToken.balanceOf(
                            this.hexOneBootstrap.address
                        ),
                        8
                    )
                );
            });

            it("sacrifice hex token", async function () {
                let sacrificeHexAmount = await this.hexToken.balanceOf(
                    this.deployer.address
                );
                sacrificeHexAmount = BigInt(sacrificeHexAmount) / BigInt(2);
                console.log(
                    "Hex token amount to sacrifice: ",
                    smallNum(sacrificeHexAmount, 8)
                );
                await this.hexToken.transfer(
                    this.sacrificer_2.address,
                    BigInt(sacrificeHexAmount)
                );

                await this.hexToken
                    .connect(this.sacrificer_2)
                    .approve(
                        this.hexOneBootstrap.address,
                        BigInt(sacrificeHexAmount)
                    );
                await this.hexOneBootstrap
                    .connect(this.sacrificer_2)
                    .sacrificeToken(
                        this.hexToken.address,
                        BigInt(sacrificeHexAmount)
                    );
            });

            it("after sacrifice duration, distribute", async function () {
                let sacrificeInfos =
                    await this.hexOneBootstrap.getUserSacrificeInfo(
                        this.sacrificer_2.address
                    );
                let sacrificeId = sacrificeInfos[0].sacrificeId;
                await expect(
                    this.hexOneBootstrap
                        .connect(this.sacrificer_2)
                        .claimRewardsForSacrifice(sacrificeId)
                ).to.be.revertedWith("sacrifice duration");

                // spend 99 days to finish sacrifice duration
                await spendTime(day * 100);

                let beforeSacrificerBal_2 = await this.HEXIT.balanceOf(
                    this.sacrificer_2.address
                );
                await this.hexOneBootstrap
                    .connect(this.sacrificer_2)
                    .claimRewardsForSacrifice(sacrificeId);
                let afterSacrificerBal_2 = await this.HEXIT.balanceOf(
                    this.sacrificer_2.address
                );

                let receivedRewards_2 =
                    BigInt(afterSacrificerBal_2) -
                    BigInt(beforeSacrificerBal_2);

                console.log(
                    "received hexit token for sacrificer_2",
                    smallNum(receivedRewards_2, 18)
                );

                expect(smallNum(receivedRewards_2, 18)).to.be.greaterThan(0);
            });
        });

        describe("Airdrop", function () {
            it("spend one more day", async function () {
                await spendTime(day);
            });

            it("stake hex through hex token contract", async function () {
                let stakeHexAmount = await this.hexToken.balanceOf(
                    this.deployer.address
                );
                stakeHexAmount = BigInt(stakeHexAmount) / BigInt(50);
                console.log(
                    "hexToken amount to stake",
                    smallNum(stakeHexAmount, 8)
                );

                await this.hexToken.transfer(
                    this.hex_staker.address,
                    BigInt(stakeHexAmount)
                );
                await this.hexToken
                    .connect(this.hex_staker)
                    .approve(this.hexToken.address, BigInt(stakeHexAmount));
                await this.hexToken
                    .connect(this.hex_staker)
                    .stakeStart(stakeHexAmount, 80);
            });

            it("hex staker request airdrop", async function () {
                await this.hexOneBootstrap
                    .connect(this.hex_staker)
                    .requestAirdrop();
                await expect(
                    this.hexOneBootstrap
                        .connect(this.feeReceiver)
                        .requestAirdrop()
                ).to.be.revertedWith("not have eligible assets for airdrop");

                await this.hexOneBootstrap
                    .connect(this.sacrificer_1)
                    .requestAirdrop();

                await spendTime(hour * 3);
                await expect(
                    this.hexOneBootstrap
                        .connect(this.sacrificer_1)
                        .requestAirdrop()
                ).to.be.revertedWith("already requested");
                await this.hexOneBootstrap
                    .connect(this.sacrificer_2)
                    .requestAirdrop();
            });

            it("after some time, claim rewards", async function () {
                let beforeBal = await this.HEXIT.balanceOf(
                    this.sacrificer_1.address
                );

                // await expect(
                //     this.hexOneBootstrap
                //         .connect(this.sacrificer_1)
                //         .claimAirdrop()
                // ).to.be.revertedWith("too soon");
                // await spendTime(day);

                await this.hexOneBootstrap
                    .connect(this.sacrificer_1)
                    .claimAirdrop();
                let afterBal = await this.HEXIT.balanceOf(
                    this.sacrificer_1.address
                );
                let receivedAmount = BigInt(afterBal) - BigInt(beforeBal);
                console.log(
                    "sacrificer_1 received HEXIT amount as airdrop: ",
                    smallNum(receivedAmount, 18)
                );
                expect(smallNum(receivedAmount, 18)).to.be.greaterThan(0);

                await spendTime(day);
                beforeBal = await this.HEXIT.balanceOf(
                    this.sacrificer_2.address
                );
                await this.hexOneBootstrap
                    .connect(this.sacrificer_2)
                    .claimAirdrop();
                afterBal = await this.HEXIT.balanceOf(
                    this.sacrificer_2.address
                );
                receivedAmount = BigInt(afterBal) - BigInt(beforeBal);
                console.log(
                    "sacrificer_2 received HEXIT amount as airdrop: ",
                    smallNum(receivedAmount, 18)
                );
                expect(smallNum(receivedAmount, 18)).to.be.greaterThan(0);

                beforeBal = await this.HEXIT.balanceOf(this.hex_staker.address);
                await this.hexOneBootstrap
                    .connect(this.hex_staker)
                    .claimAirdrop();
                afterBal = await this.HEXIT.balanceOf(this.hex_staker.address);
                receivedAmount = BigInt(afterBal) - BigInt(beforeBal);
                console.log(
                    "hex_staker received HEXIT amount as airdrop: ",
                    smallNum(receivedAmount, 18)
                );
                expect(smallNum(receivedAmount, 18)).to.be.greaterThan(0);
            });

            it("after duration, check additional HEXIT generation", async function () {
                /// reverts if before airdrop end time
                await expect(
                    this.hexOneBootstrap.generateAdditionalTokens()
                ).to.be.revertedWith("before airdrop ends");

                await spendTime(100 * day);

                let hexitForAirdrop =
                    await this.hexOneBootstrap.HEXITAmountForAirdrop();
                let hexitForSacrifice =
                    await this.hexOneBootstrap.HEXITAmountForSacrifice();
                let totalHexit =
                    BigInt(hexitForAirdrop) + BigInt(hexitForSacrifice);
                let beforeStakingBal = await this.HEXIT.balanceOf(
                    this.staking.address
                );
                let beforeTeamBal = await this.HEXIT.balanceOf(
                    this.teamFinance.address
                );
                await this.hexOneBootstrap.generateAdditionalTokens();
                let afterStakingBal = await this.HEXIT.balanceOf(
                    this.staking.address
                );
                let afterTeamBal = await this.HEXIT.balanceOf(
                    this.teamFinance.address
                );

                let expectStakingAmount =
                    (BigInt(totalHexit) * BigInt(33)) / BigInt(100);
                let expectTeamAmount =
                    (BigInt(totalHexit) * BigInt(50)) / BigInt(100);

                expect(
                    smallNum(BigInt(afterTeamBal) - BigInt(beforeTeamBal), 18)
                ).to.be.equal(smallNum(expectTeamAmount, 18));

                expect(
                    smallNum(
                        BigInt(afterStakingBal) - BigInt(beforeStakingBal),
                        18
                    )
                ).to.be.equal(smallNum(expectStakingAmount, 18));
            });
        });

        describe("Escrow", function () {
            it("get hex balance", async function () {
                let hexBalance = await this.hexOneEscrow.balanceOfHex();
                console.log(
                    "hex token balance that escrow token has: ",
                    smallNum(hexBalance, 8)
                );
                expect(smallNum(hexBalance, 8)).to.be.greaterThan(0);
            });

            it("deposit collateral", async function () {
                let beforeBal_1 = await this.hexOneToken.balanceOf(
                    this.sacrificer_1.address
                );
                let beforeBal_2 = await this.hexOneToken.balanceOf(
                    this.sacrificer_2.address
                );
                await this.hexOneEscrow.depositCollateralToHexOneProtocol(60);
                let afterBal_1 = await this.hexOneToken.balanceOf(
                    this.sacrificer_1.address
                );
                let afterBal_2 = await this.hexOneToken.balanceOf(
                    this.sacrificer_2.address
                );
                let rewardsAmount_1 = BigInt(afterBal_1) - BigInt(beforeBal_1);
                let rewardsAmount_2 = BigInt(afterBal_2) - BigInt(beforeBal_2);

                console.log(
                    "$HEX1 amount that sacrificer received as rewards: ",
                    smallNum(rewardsAmount_1, 18),
                    smallNum(rewardsAmount_2, 18)
                );
            });

            it("after duration, reDeposit", async function () {
                await spendTime(81 * day);

                let beforeBal_1 = await this.hexOneToken.balanceOf(
                    this.sacrificer_1.address
                );
                let beforeBal_2 = await this.hexOneToken.balanceOf(
                    this.sacrificer_2.address
                );
                await this.hexOneEscrow
                    .connect(this.depositor_1)
                    .reDepositCollateral();
                let afterBal_1 = await this.hexOneToken.balanceOf(
                    this.sacrificer_1.address
                );
                let afterBal_2 = await this.hexOneToken.balanceOf(
                    this.sacrificer_2.address
                );
                let rewardsAmount_1 = BigInt(afterBal_1) - BigInt(beforeBal_1);
                let rewardsAmount_2 = BigInt(afterBal_2) - BigInt(beforeBal_2);

                console.log(
                    "$HEX1 amount that sacrificer received as rewards: ",
                    smallNum(rewardsAmount_1, 18),
                    smallNum(rewardsAmount_2, 18)
                );
            });
        });
    });

    describe("main process test", function () {
        describe("deposit and claim hex", function () {
            describe("deposit hex", function () {
                it("deposit hex as collateral and check received $HEX1", async function () {
                    let hexAmountForDeposit = await this.hexToken.balanceOf(
                        this.deployer.address
                    );
                    hexAmountForDeposit =
                        BigInt(hexAmountForDeposit) / BigInt(2);
                    let duration = 40; // 40 days

                    console.log(
                        "HEX token amount to deposit: ",
                        smallNum(hexAmountForDeposit, 8)
                    );

                    let beforeBal = await this.hexOneToken.balanceOf(
                        this.depositor_1.address
                    );
                    await this.hexToken.transfer(
                        this.depositor_1.address,
                        BigInt(hexAmountForDeposit)
                    );
                    console.log(
                        "depositAmount: ",
                        smallNum(hexAmountForDeposit, 8)
                    );
                    await this.hexToken
                        .connect(this.depositor_1)
                        .approve(
                            this.hexOneProtocol.address,
                            BigInt(hexAmountForDeposit)
                        );
                    console.log(
                        "depositAmount: ",
                        smallNum(hexAmountForDeposit, 8)
                    );
                    await this.hexOneProtocol
                        .connect(this.depositor_1)
                        .depositCollateral(
                            this.hexToken.address,
                            BigInt(hexAmountForDeposit),
                            duration,
                            this.depositor_1.address
                        );
                    let afterBal = await this.hexOneToken.balanceOf(
                        this.depositor_1.address
                    );

                    let expectMintAmount =
                        await this.hexOnePriceFeed.getHexTokenPrice(
                            hexAmountForDeposit
                        );

                    expect(
                        smallNum(afterBal, 18) - smallNum(beforeBal, 18)
                    ).to.be.equal(smallNum(expectMintAmount, 18));
                    let shareBalance = await this.hexOneVault.getShareBalance(
                        this.depositor_1.address
                    );
                    expect(smallNum(shareBalance, 8)).to.be.greaterThan(0);
                    console.log(
                        "shareBalance after deposit collateral: ",
                        smallNum(shareBalance, 8)
                    );
                });
            });

            describe("claim hex", function () {
                it("reverts if try to claim before maturity", async function () {
                    let userInfos = await this.hexOneVault.getUserInfos(
                        this.depositor_1.address
                    );
                    let depositId = userInfos[0].depositId;
                    expect(
                        smallNum(userInfos[0].borrowableAmount, 18)
                    ).to.be.equal(0);
                    await expect(
                        this.hexOneProtocol
                            .connect(this.depositor_1)
                            .claimCollateral(this.hexToken.address, depositId)
                    ).to.be.revertedWith("before maturity");
                });

                it("claim after maturity", async function () {
                    let userInfos = await this.hexOneVault.getUserInfos(
                        this.depositor_1.address
                    );
                    expect(userInfos.length).to.be.equal(1);
                    let depositId = userInfos[0].depositId;
                    let mintAmount = userInfos[0].mintAmount;
                    let depositedAmount = userInfos[0].depositAmount;

                    await spendTime(day * 45);

                    let beforeHexOneBal = await this.hexOneToken.balanceOf(
                        this.depositor_1.address
                    );
                    let beforeHexBal = await this.hexToken.balanceOf(
                        this.depositor_1.address
                    );
                    await this.hexOneProtocol
                        .connect(this.depositor_1)
                        .claimCollateral(this.hexToken.address, depositId);
                    let afterHexOneBal = await this.hexOneToken.balanceOf(
                        this.depositor_1.address
                    );
                    let afterHexBal = await this.hexToken.balanceOf(
                        this.depositor_1.address
                    );
                    expect(
                        smallNum(beforeHexOneBal, 18) -
                            smallNum(afterHexOneBal, 18)
                    ).to.be.equal(smallNum(mintAmount, 18));
                    console.log(
                        "received HEX token amount as rewards: ",
                        smallNum(afterHexBal, 8) - smallNum(beforeHexBal, 8)
                    );
                    expect(
                        smallNum(afterHexBal, 8) - smallNum(beforeHexBal, 8)
                    ).to.be.greaterThan(smallNum(depositedAmount, 8));
                    let shareBalance = await this.hexOneVault.getShareBalance(
                        this.depositor_1.address
                    );
                    expect(smallNum(shareBalance, 12)).to.be.equal(0);
                    console.log(
                        "user information after claim: ",
                        await this.hexOneVault.getUserInfos(
                            this.depositor_1.address
                        )
                    );
                    userInfos = await this.hexOneVault.getUserInfos(
                        this.depositor_1.address
                    );
                    expect(userInfos.length).to.be.equal(0);
                });
            });
        });

        describe("set vaulsts", function () {
            it("reverts if caller is not the owner", async function () {
                await expect(
                    this.hexOneProtocol
                        .connect(this.depositor_1)
                        .setVaults([this.hexOneVault.address], false)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("remove hexOneVault", async function () {
                await this.hexOneProtocol.setVaults(
                    [this.hexOneVault.address],
                    false
                );
                expect(
                    await this.hexOneProtocol.isAllowedToken(
                        this.hexToken.address
                    )
                ).to.be.equal(false);
            });

            it("add hexOneVault again", async function () {
                await this.hexOneProtocol.setVaults(
                    [this.hexOneVault.address],
                    true
                );
                expect(
                    await this.hexOneProtocol.isAllowedToken(
                        this.hexToken.address
                    )
                ).to.be.equal(true);
            });
        });

        describe("deposit fee", function () {
            describe("set deposit fee", function () {
                it("reverts if caller is not the owner", async function () {
                    await expect(
                        this.hexOneProtocol
                            .connect(this.depositor_1)
                            .setDepositFee(this.hexToken.address, 10)
                    ).to.be.revertedWith("Ownable: caller is not the owner");
                });

                it("reverts if token is not allowed", async function () {
                    await expect(
                        this.hexOneProtocol.setDepositFee(
                            this.hexOneToken.address,
                            100
                        )
                    ).to.be.revertedWith("not allowed token");
                });

                it("reverts if deposit fee is over 100%", async function () {
                    await expect(
                        this.hexOneProtocol.setDepositFee(
                            this.hexToken.address,
                            1001
                        )
                    ).to.be.revertedWith("invalid fee rate");
                });

                it("set deposit fee", async function () {
                    await this.hexOneProtocol.setDepositFee(
                        this.hexToken.address,
                        30
                    );
                });
            });

            describe("set deposit enable", function () {
                it("reverts if caller is not the owner", async function () {
                    await expect(
                        this.hexOneProtocol
                            .connect(this.depositor_1)
                            .setDepositFeeEnable(this.hexToken.address, true)
                    ).to.be.revertedWith("Ownable: caller is not the owner");
                });

                it("reverts if token is not allowed", async function () {
                    await expect(
                        this.hexOneProtocol.setDepositFeeEnable(
                            this.hexOneToken.address,
                            true
                        )
                    ).to.be.revertedWith("not allowed token");
                });

                it("set deposit fee enable", async function () {
                    await this.hexOneProtocol.setDepositFeeEnable(
                        this.hexToken.address,
                        true
                    );
                });
            });

            describe("deposit collateral with fee", function () {
                it("reverts if token is not allowed", async function () {
                    await expect(
                        this.hexOneProtocol
                            .connect(this.depositor_3)
                            .depositCollateral(
                                this.hexOneToken.address,
                                bigNum(10),
                                4,
                                this.depositor_3.address
                            )
                    ).to.be.revertedWith("invalid token");
                });

                it("reverts if amount is zero", async function () {
                    await expect(
                        this.hexOneProtocol
                            .connect(this.depositor_3)
                            .depositCollateral(
                                this.hexToken.address,
                                0,
                                4,
                                this.depositor_3.address
                            )
                    ).to.be.revertedWith("invalid amount");
                });

                it("reverts if duration is invalid", async function () {
                    await expect(
                        this.hexOneProtocol
                            .connect(this.depositor_3)
                            .depositCollateral(
                                this.hexToken.address,
                                bigNum(10),
                                20,
                                this.depositor_3.address
                            )
                    ).to.be.revertedWith("invalid duration");
                });

                it("deposit collateral and check fee", async function () {
                    let hexAmountForDeposit = await this.hexToken.balanceOf(
                        this.deployer.address
                    );
                    hexAmountForDeposit =
                        BigInt(hexAmountForDeposit) / BigInt(4);
                    let duration = 50; // 50 days

                    let beforeBal = await this.hexOneToken.balanceOf(
                        this.depositor_3.address
                    );
                    let stakingPoolAddr =
                        await this.hexOneProtocol.stakingMaster();
                    let beforePoolBal = await this.hexToken.balanceOf(
                        stakingPoolAddr
                    );
                    await this.hexToken.transfer(
                        this.depositor_3.address,
                        BigInt(hexAmountForDeposit)
                    );
                    await this.hexToken
                        .connect(this.depositor_3)
                        .approve(
                            this.hexOneProtocol.address,
                            BigInt(hexAmountForDeposit)
                        );
                    console.log(
                        "depositAmount: ",
                        smallNum(hexAmountForDeposit, 8)
                    );
                    await this.hexOneProtocol
                        .connect(this.depositor_3)
                        .depositCollateral(
                            this.hexToken.address,
                            BigInt(hexAmountForDeposit),
                            duration,
                            this.depositor_3.address
                        );
                    let afterBal = await this.hexOneToken.balanceOf(
                        this.depositor_3.address
                    );
                    let afterPoolBal = await this.hexToken.balanceOf(
                        stakingPoolAddr
                    );

                    let feeRate = await this.hexOneProtocol.fees(
                        this.hexToken.address
                    );
                    feeRate = feeRate.feeRate;
                    let feeAmount =
                        (BigInt(hexAmountForDeposit) * BigInt(feeRate)) /
                        BigInt(1000);
                    let tradeAmount =
                        BigInt(hexAmountForDeposit) - BigInt(feeAmount);
                    let expectMintAmount =
                        await this.hexOnePriceFeed.getHexTokenPrice(
                            tradeAmount
                        );

                    expect(
                        smallNum(afterBal, 18) - smallNum(beforeBal, 18)
                    ).to.be.equal(smallNum(expectMintAmount, 18));
                    let shareBalance = await this.hexOneVault.getShareBalance(
                        this.depositor_3.address
                    );
                    expect(smallNum(shareBalance, 12)).to.be.greaterThan(0);
                    expect(
                        smallNum(
                            BigInt(afterPoolBal) - BigInt(beforePoolBal),
                            8
                        )
                    ).to.be.equal(smallNum(feeAmount, 8));
                    console.log(
                        "shareBalance after deposit collateral: ",
                        smallNum(shareBalance, 12)
                    );
                });
            });
        });

        describe("staking hex token", function () {
            it("reverts if staking is not enabled", async function () {
                await expect(
                    this.staking
                        .connect(this.staker_1)
                        .stakeToken(this.hexToken.address, bigNum(100, 8))
                ).to.be.revertedWith("staking is not enabled");
            });

            it("enable staking", async function () {
                await expect(
                    this.staking.connect(this.staker_1).enableStaking()
                ).to.be.revertedWith("Ownable: caller is not the owner");

                await this.staking.enableStaking();
            });

            it("stake hexToken", async function () {
                let stakeAmount = await this.hexToken.balanceOf(
                    this.staker_1.address
                );
                await this.hexToken
                    .connect(this.staker_1)
                    .approve(this.staking.address, BigInt(stakeAmount));
                await this.staking
                    .connect(this.staker_1)
                    .stakeToken(this.hexToken.address, BigInt(stakeAmount));

                stakeAmount = BigInt(stakeAmount) / BigInt(2);
                await this.hexToken
                    .connect(this.staker_2)
                    .approve(this.staking.address, BigInt(stakeAmount));
                await this.staking
                    .connect(this.staker_2)
                    .stakeToken(this.hexToken.address, BigInt(stakeAmount));
            });
        });

        describe("set staking master", function () {
            it("deploy new staking master", async function () {
                this.staking = await deployProxy(
                    "HexOneStaking",
                    "HexOneStaking",
                    [
                        this.hexToken.address,
                        this.HEXIT.address,
                        100, // 10% HEXIT dist
                        150, // 15% HEXIT dist
                    ]
                );
            });

            it("set new staking master", async function () {
                let oldOne = await this.hexOneProtocol.stakingMaster();
                expect(oldOne).to.be.not.equal(this.staking.address);

                /// reverts if caller is not the owner
                await expect(
                    this.hexOneProtocol
                        .connect(this.depositor_1)
                        .setStakingPool(this.staking.address)
                ).to.be.revertedWith("Ownable: caller is not the owner");

                await this.hexOneProtocol.setStakingPool(this.staking.address);

                expect(await this.hexOneProtocol.stakingMaster()).to.be.equal(
                    this.staking.address
                );

                await this.hexOneProtocol.setStakingPool(oldOne);
            });
        });

        describe("borrow more $HEX1", function () {
            let increasePricePerToken;
            it("set increased testRate for borrow", async function () {
                let beforePrice = await this.hexOnePriceFeed.getHexTokenPrice(
                    bigNum(1, 8)
                );
                let testRate = 1500; // 150%
                await this.hexOnePriceFeed.setTestRate(testRate);
                let afterPrice = await this.hexOnePriceFeed.getHexTokenPrice(
                    bigNum(1, 8)
                );
                increasePricePerToken =
                    BigInt(afterPrice) - BigInt(beforePrice);
            });

            it("get borrowable amounts", async function () {
                let borrowableAmounts =
                    await this.hexOneVault.getBorrowableAmounts(
                        this.depositor_3.address
                    );
                expect(borrowableAmounts.length).to.be.equal(1);
                console.log(borrowableAmounts[0]);
            });

            it("reverts if token is not allowed", async function () {
                await expect(
                    this.hexOneProtocol
                        .connect(this.depositor_3)
                        .borrowHexOne(
                            this.hexOneToken.address,
                            1,
                            bigNum(10, 18)
                        )
                ).to.be.revertedWith("not allowed token");
            });

            it("borrow more $HEX1", async function () {
                let depositInfo = await this.hexOneVault.getUserInfos(
                    this.depositor_3.address
                );
                let depositedTokenAmount = depositInfo[0].depositAmount;
                console.log(
                    "depositedAmont: ",
                    smallNum(depositedTokenAmount, 8)
                );
                console.log(
                    "increase price per token: ",
                    smallNum(increasePricePerToken, 18)
                );

                let borrowableAmounts =
                    await this.hexOneVault.getBorrowableAmounts(
                        this.depositor_3.address
                    );
                let borrowableAmount = borrowableAmounts[0].borrowableAmount;
                let depositId = borrowableAmounts[0].depositId;

                let beforeBal = await this.hexOneToken.balanceOf(
                    this.depositor_3.address
                );
                await this.hexOneProtocol
                    .connect(this.depositor_3)
                    .borrowHexOne(
                        this.hexToken.address,
                        depositId,
                        BigInt(borrowableAmount)
                    );
                let afterBal = await this.hexOneToken.balanceOf(
                    this.depositor_3.address
                );
                let expectAmount =
                    (BigInt(depositedTokenAmount) *
                        BigInt(increasePricePerToken)) /
                    BigInt(10 ** 8);
                let borrowedAmount = BigInt(afterBal) - BigInt(beforeBal);

                console.log(
                    "borrowed $HEX1 token amount: ",
                    smallNum(borrowedAmount, 18),
                    smallNum(borrowableAmount, 18),
                    smallNum(expectAmount, 18)
                );

                console.log(
                    "$HEX1 balance after borrow: ",
                    smallNum(afterBal, 18)
                );

                expect(smallNum(borrowedAmount, 18)).to.be.equal(
                    smallNum(borrowableAmount, 18)
                );
                expect(smallNum(borrowedAmount, 18)).to.be.closeTo(
                    smallNum(expectAmount, 18),
                    0.01
                );
            });
        });

        describe("claim hex token of liquidate deposit", function () {
            it("spend time and check liquidable deposits", async function () {
                let deposits = await this.hexOneVault.getLiquidableDeposits();
                expect(deposits.length).to.be.equal(2);

                /// spend time
                await spendTime(55 * day);

                deposits = await this.hexOneVault.getLiquidableDeposits();
                expect(deposits.length).to.be.equal(4);

                // first deposit is after grace duration so liquidable should be true.
                expect(deposits[0].liquidable).to.be.equal(true);
                // third deposit is in grace duration so liquidable should be false.
                expect(deposits[3].liquidable).to.be.equal(false);
            });

            it("liquidate hex", async function () {
                await this.hexOneToken.mintToken(
                    bigNum(1000, 18),
                    this.deployer.address
                );
                let deposits = await this.hexOneVault.getLiquidableDeposits();

                let borrowedHexOne = deposits[0].borrowedHexOne;
                let depositId = deposits[0].depositId;

                let beforeHexOneBal = await this.hexOneToken.balanceOf(
                    this.deployer.address
                );
                let beforeBal = await this.hexToken.balanceOf(
                    this.deployer.address
                );
                await this.hexOneProtocol.claimCollateral(
                    this.hexToken.address,
                    depositId
                );
                let afterBal = await this.hexToken.balanceOf(
                    this.deployer.address
                );
                let afterHexOneBal = await this.hexOneToken.balanceOf(
                    this.deployer.address
                );
                let receivedAmount = BigInt(afterBal) - BigInt(beforeBal);
                let burntAmount =
                    BigInt(beforeHexOneBal) - BigInt(afterHexOneBal);

                expect(smallNum(receivedAmount, 8)).to.be.greaterThan(0);
                expect(smallNum(burntAmount, 18)).to.be.equal(
                    smallNum(borrowedHexOne, 18)
                );
            });
        });

        describe("unstake and get rewards", function () {
            it("claimable rewards", async function () {
                let [hexRewardsAmount_1, hexitRewardsAmount_1] =
                    await this.staking.claimableRewardsAmount(
                        this.staker_1.address,
                        this.hexToken.address
                    );

                let [hexRewardsAmount_2, hexitRewardsAmount_2] =
                    await this.staking.claimableRewardsAmount(
                        this.staker_2.address,
                        this.hexToken.address
                    );

                expect(smallNum(hexRewardsAmount_1, 8)).to.be.greaterThan(0);
                expect(smallNum(hexitRewardsAmount_1, 8)).to.be.equal(0);
                expect(smallNum(hexRewardsAmount_2, 8)).to.be.greaterThan(0);
                expect(smallNum(hexitRewardsAmount_2, 8)).to.be.equal(0);

                let beforeBal = await this.hexToken.balanceOf(
                    this.staker_1.address
                );

                let stakedAmount = await this.staking.stakingInfos(
                    this.staker_1.address,
                    this.hexToken.address
                );
                stakedAmount = stakedAmount.stakedAmount;
                let unstakeAmount = BigInt(stakedAmount) / BigInt(4);
                await this.staking
                    .connect(this.staker_1)
                    .unstake(this.hexToken.address, BigInt(unstakeAmount));
                let afterBal = await this.hexToken.balanceOf(
                    this.staker_1.address
                );
                let expectClaimableAmount =
                    (BigInt(hexRewardsAmount_1) * BigInt(unstakeAmount)) /
                    BigInt(stakedAmount);
                expect(
                    smallNum(BigInt(afterBal) - BigInt(beforeBal), 8)
                ).to.be.equal(
                    smallNum(
                        BigInt(expectClaimableAmount) + BigInt(unstakeAmount),
                        8
                    )
                );

                stakedAmount = await this.staking.stakingInfos(
                    this.staker_2.address,
                    this.hexToken.address
                );
                stakedAmount = stakedAmount.stakedAmount;
                beforeBal = await this.hexToken.balanceOf(
                    this.staker_2.address
                );
                await this.staking
                    .connect(this.staker_2)
                    .unstake(this.hexToken.address, BigInt(unstakeAmount));
                afterBal = await this.hexToken.balanceOf(this.staker_2.address);

                expectClaimableAmount =
                    (BigInt(hexRewardsAmount_2) * BigInt(unstakeAmount)) /
                    BigInt(stakedAmount);

                expect(
                    smallNum(BigInt(afterBal) - BigInt(beforeBal), 8)
                ).to.be.closeTo(
                    smallNum(
                        BigInt(expectClaimableAmount) + BigInt(unstakeAmount),
                        8
                    ),
                    0.01
                );
            });
        });
    });
});
