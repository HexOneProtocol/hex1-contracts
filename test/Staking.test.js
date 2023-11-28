const { expect } = require("chai");
const { ethers } = require("hardhat");
const { constants } = require("@openzeppelin/test-helpers");

const { uniswap_abi } = require("../external_abi/uniswap.abi.json");
const { erc20_abi } = require("../external_abi/erc20.abi.json");
const { hex_abi } = require("../external_abi/hex.abi.json");

const {
    deploy,
    bigNum,
    getCurrentTimestamp,
    smallNum,
    spendTime,
    day,
    deployProxy,
    hour,
} = require("../scripts/utils");

describe("Staking contract test", function () {
    let usdcPriceFeed = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
    let uniPriceFeed = "0x553303d460EE0afB37EdFf9bE42922D8FF63220e";
    let pulsexRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    let hexDistRate = 500;
    let hexitDistRate = 500;

    before(async function () {
        [
            this.deployer,
            this.account_1,
            this.account_2,
            this.hexOneProtocol,
            this.hexOneBootstrap,
            this.staker_1,
            this.staker_2,
        ] = await ethers.getSigners();

        this.mockUSDC = await deploy(
            "HexOneMockToken",
            "MockUSDC",
            "Mock USDC",
            "MUSDC"
        );

        this.hexToken = await deploy("HexMockToken", "HexMockToken");

        this.mockHEXIT = await deploy(
            "HexOneMockToken",
            "MockHEXIT",
            "Mock HEXIT",
            "HEXIT"
        );

        this.mockUNI = await deploy(
            "HexOneMockToken",
            "MockUNI",
            "Mock UNI",
            "MUNI"
        );

        this.staking = await deployProxy("HexOneStaking", "HexOneStaking", [
            this.hexToken.address,
            this.mockHEXIT.address,
            hexDistRate,
            hexitDistRate,
        ]);
    });

    it("check deployment", async function () {
        console.log("deployed successfully!");
    });

    describe("setBaseData", function () {
        it("reverts if caller is not the owner", async function () {
            await expect(
                this.staking
                    .connect(this.account_1)
                    .setBaseData(
                        this.hexOneProtocol.address,
                        this.hexOneBootstrap.address
                    )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("reverts if param address is zero", async function () {
            await expect(
                this.staking.setBaseData(
                    constants.ZERO_ADDRESS,
                    this.hexOneBootstrap.address
                )
            ).to.be.revertedWith("zero hexOneProtocol address");

            await expect(
                this.staking.setBaseData(
                    this.hexOneProtocol.address,
                    constants.ZERO_ADDRESS
                )
            ).to.be.revertedWith("zero hexOneBootstrap address");
        });

        it("setBaseData", async function () {
            await this.staking.setBaseData(
                this.hexOneProtocol.address,
                this.hexOneBootstrap.address
            );
        });
    });

    describe("add AllowedTokens", function () {
        it("reverts if array is empty", async function () {
            await expect(
                this.staking.addAllowedTokens(
                    [],
                    [
                        {
                            hexDistRate: 9000,
                            hexitDistRate: 9000,
                        },
                        {
                            hexDistRate: 1000,
                            hexitDistRate: 3000,
                        },
                        {
                            hexDistRate: 1500,
                            hexitDistRate: 2000,
                        },
                        {
                            hexDistRate: 2000,
                            hexitDistRate: 1000,
                        },
                    ]
                )
            ).to.be.revertedWith("invalid length array");
        });

        it("reverts if array length is mismatched", async function () {
            await expect(
                this.staking.addAllowedTokens(
                    [
                        this.mockUNI.address,
                        this.hexToken.address,
                        this.mockHEXIT.address,
                        this.mockUSDC.address,
                    ],
                    [
                        {
                            hexDistRate: 0,
                            hexitDistRate: 3000,
                        },
                        {
                            hexDistRate: 0,
                            hexitDistRate: 2000,
                        },
                        {
                            hexDistRate: 0,
                            hexitDistRate: 1000,
                        },
                    ]
                )
            ).to.be.revertedWith("mismatched array");
        });

        it("reverts if caller is not the owner", async function () {
            await expect(
                this.staking.connect(this.account_1).addAllowedTokens(
                    [
                        this.mockUNI.address,
                        this.hexToken.address,
                        this.mockHEXIT.address,
                        this.mockUSDC.address,
                    ],
                    [
                        {
                            hexDistRate: 9000,
                            hexitDistRate: 9000,
                        },
                        {
                            hexDistRate: 0,
                            hexitDistRate: 3000,
                        },
                        {
                            hexDistRate: 0,
                            hexitDistRate: 2000,
                        },
                        {
                            hexDistRate: 0,
                            hexitDistRate: 1000,
                        },
                    ]
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("add allowed tokens", async function () {
            await this.staking.addAllowedTokens(
                [
                    this.mockUNI.address,
                    this.hexToken.address,
                    this.mockHEXIT.address,
                    this.mockUSDC.address,
                ],
                [
                    {
                        hexDistRate: 9000,
                        hexitDistRate: 9000,
                    },
                    {
                        hexDistRate: 0,
                        hexitDistRate: 3000,
                    },
                    {
                        hexDistRate: 0,
                        hexitDistRate: 2000,
                    },
                    {
                        hexDistRate: 0,
                        hexitDistRate: 1000,
                    },
                ]
            );
        });
    });

    describe("staking, claimRewards and unstaking", function () {
        it("current Staking day is zero if staking is not enabled", async function () {
            let curStakingDay = await this.staking.currentStakingDay();
            expect(Number(curStakingDay)).to.be.equal(0);
        });

        it("reverts if staking is not enabled", async function () {
            await expect(
                this.staking
                    .connect(this.staker_1)
                    .stakeToken(this.hexToken.address, bigNum(100, 8))
            ).to.be.revertedWith("staking is not enabled");
        });

        describe("enable staking", function () {
            it("reverts if caller is not the owner", async function () {
                await expect(
                    this.staking.connect(this.account_1).enableStaking()
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("reverts if hex and hexit is not purchased", async function () {
                await expect(this.staking.enableStaking()).to.be.revertedWith(
                    "no rewards pool"
                );
            });

            it("reverts purchase hex if caller is not hexOneProtocol", async function () {
                await expect(
                    this.staking.purchaseHex(bigNum(100, 8))
                ).to.be.revertedWith("only HexOneProtocol");
            });

            it("reverts purchase if purchase amount is invalid", async function () {
                await expect(
                    this.staking.connect(this.hexOneProtocol).purchaseHex(0)
                ).to.be.revertedWith("invalid purchase amount");
            });

            it("purchase hex", async function () {
                await this.hexToken.connect(this.hexOneProtocol).mint();
                let purchaseAmount = await this.hexToken.balanceOf(
                    this.hexOneProtocol.address
                );
                await this.hexToken
                    .connect(this.hexOneProtocol)
                    .approve(this.staking.address, BigInt(purchaseAmount));
                await this.staking
                    .connect(this.hexOneProtocol)
                    .purchaseHex(BigInt(purchaseAmount));
            });

            it("reverts purchase hexit if caller is not hexOneBootstrap", async function () {
                await expect(
                    this.staking.purchaseHexit(bigNum(100, 18))
                ).to.be.revertedWith("only HexOneBootstrap");
            });

            it("reverts purchase hexit if purchase amount is invalid", async function () {
                await expect(
                    this.staking.connect(this.hexOneBootstrap).purchaseHexit(0)
                ).to.be.revertedWith("invalid purchase amount");
            });

            it("reverts purchase hexit if purchase amount is invalid", async function () {
                await expect(
                    this.staking.connect(this.hexOneProtocol).purchaseHex(0)
                ).to.be.revertedWith("invalid purchase amount");
            });

            it("purchase hexit", async function () {
                let purchaseAmount = bigNum(1000, 18);
                await this.mockHEXIT.mintToken(
                    BigInt(purchaseAmount),
                    this.hexOneBootstrap.address
                );
                await this.mockHEXIT
                    .connect(this.hexOneBootstrap)
                    .approve(this.staking.address, BigInt(purchaseAmount));
                await this.staking
                    .connect(this.hexOneBootstrap)
                    .purchaseHexit(BigInt(purchaseAmount));
            });

            it("enable staking", async function () {
                await this.staking.enableStaking();
                // reverts if staking is already enabled
                await expect(this.staking.enableStaking()).to.be.revertedWith(
                    "already enabled"
                );
            });
        });

        describe("staking, claim and unstake", function () {
            it("stake USDC with staker_1", async function () {
                let beforeStakingStatus =
                    await this.staking.getUserStakingStatus(
                        this.staker_1.address
                    );
                beforeStakingStatus = beforeStakingStatus[3];
                let stakeAmount = bigNum(100, 18);
                await this.mockUSDC.mintToken(
                    BigInt(stakeAmount),
                    this.staker_1.address
                );
                await this.mockUSDC
                    .connect(this.staker_1)
                    .approve(this.staking.address, BigInt(stakeAmount));
                await this.staking
                    .connect(this.staker_1)
                    .stakeToken(this.mockUSDC.address, BigInt(stakeAmount));
                let afterStakingStatus =
                    await this.staking.getUserStakingStatus(
                        this.staker_1.address
                    );
                afterStakingStatus = afterStakingStatus[3];

                expect(smallNum(stakeAmount, 18)).to.be.equal(
                    smallNum(
                        BigInt(afterStakingStatus.stakedAmount) -
                            BigInt(beforeStakingStatus.stakedAmount),
                        18
                    )
                );
                expect(
                    smallNum(BigInt(stakeAmount) / BigInt(10), 18)
                ).to.be.equal(
                    smallNum(
                        BigInt(afterStakingStatus.claimableHexitAmount) -
                            BigInt(beforeStakingStatus.claimableHexitAmount),
                        18
                    )
                );
                expect(smallNum(stakeAmount, 18)).to.be.equal(
                    smallNum(
                        BigInt(afterStakingStatus.totalLockedAmount) -
                            BigInt(beforeStakingStatus.totalLockedAmount),
                        18
                    )
                );
            });

            it("stake UNI with staker_1", async function () {
                let stakeAmount = bigNum(100, 18);
                await this.mockUNI.mintToken(
                    BigInt(stakeAmount),
                    this.staker_1.address
                );
                await this.mockUNI
                    .connect(this.staker_1)
                    .approve(this.staking.address, BigInt(stakeAmount));
                await this.staking
                    .connect(this.staker_1)
                    .stakeToken(this.mockUNI.address, BigInt(stakeAmount));
            });

            it("check claimable rewards and rewardsRate", async function () {
                let [hexAmount, hexitAmount] =
                    await this.staking.claimableRewardsAmount(
                        this.staker_1.address,
                        this.mockUSDC.address
                    );

                console.log(
                    "claimable hex and hexit amount of USDC staking: ",
                    smallNum(hexAmount, 8),
                    smallNum(hexitAmount, 18)
                );

                expect(smallNum(hexAmount, 8)).to.be.equal(0);
                expect(smallNum(hexitAmount, 18)).to.be.greaterThan(0);

                [hexAmount, hexitAmount] =
                    await this.staking.claimableRewardsAmount(
                        this.staker_1.address,
                        this.mockUNI.address
                    );

                console.log(
                    "claimable hex and hexit amount of UNI staking: ",
                    smallNum(hexAmount, 8),
                    smallNum(hexitAmount, 18)
                );

                expect(smallNum(hexAmount, 8)).to.be.greaterThan(0);
                expect(smallNum(hexitAmount, 18)).to.be.greaterThan(0);

                let hexRewardsRatePerShare =
                    await this.staking.hexRewardsRatePerShare();
                let hexitRewardsRatePerShare =
                    await this.staking.hexitRewardsRatePerShare();

                console.log(
                    "hexRewardsRatePerShare, hexitRewardsRatePerShare: ",
                    smallNum(hexRewardsRatePerShare, 18),
                    smallNum(hexitRewardsRatePerShare, 18)
                );

                expect(smallNum(hexRewardsRatePerShare, 18)).to.be.greaterThan(
                    0
                );
                expect(
                    smallNum(hexitRewardsRatePerShare, 18)
                ).to.be.greaterThan(0);
            });

            it("stake USDC with staker_2 and check share rate", async function () {
                let beforeRate = await this.staking.hexitRewardsRatePerShare();
                let stakeAmount = bigNum(100, 18);
                await this.mockUSDC.mintToken(
                    BigInt(stakeAmount),
                    this.staker_2.address
                );
                await this.mockUSDC
                    .connect(this.staker_2)
                    .approve(this.staking.address, BigInt(stakeAmount));
                await this.staking
                    .connect(this.staker_2)
                    .stakeToken(this.mockUSDC.address, BigInt(stakeAmount));
                let afterRate = await this.staking.hexitRewardsRatePerShare();

                expect(smallNum(afterRate, 18)).to.be.greaterThan(
                    smallNum(beforeRate, 18)
                );
            });

            it("stake UNI with staker_2 and check share rate", async function () {
                let beforeRate = await this.staking.hexitRewardsRatePerShare();
                let stakeAmount = bigNum(100, 18);
                await this.mockUNI.mintToken(
                    BigInt(stakeAmount),
                    this.staker_2.address
                );
                await this.mockUNI
                    .connect(this.staker_2)
                    .approve(this.staking.address, BigInt(stakeAmount));
                await this.staking
                    .connect(this.staker_2)
                    .stakeToken(this.mockUNI.address, BigInt(stakeAmount));
                let afterRate = await this.staking.hexitRewardsRatePerShare();

                expect(smallNum(afterRate, 18)).to.be.greaterThan(
                    smallNum(beforeRate, 18)
                );
            });

            it("claim rewards", async function () {
                let [hexAmount, hexitAmount] =
                    await this.staking.claimableRewardsAmount(
                        this.staker_1.address,
                        this.mockUSDC.address
                    );

                let beforeHexBal = await this.hexToken.balanceOf(
                    this.staker_1.address
                );
                let beforeHexitBal = await this.mockHEXIT.balanceOf(
                    this.staker_1.address
                );
                await expect(
                    this.staking.claimRewards(this.mockUSDC.address)
                ).to.be.revertedWith("no staking pool");
                await this.staking
                    .connect(this.staker_1)
                    .claimRewards(this.mockUSDC.address);
                let afterHexBal = await this.hexToken.balanceOf(
                    this.staker_1.address
                );
                let afterHexitBal = await this.mockHEXIT.balanceOf(
                    this.staker_1.address
                );

                expect(
                    smallNum(BigInt(afterHexBal) - BigInt(beforeHexBal), 8)
                ).to.be.equal(smallNum(hexAmount, 8));
                expect(
                    smallNum(BigInt(afterHexitBal) - BigInt(beforeHexitBal), 18)
                ).to.be.equal(smallNum(hexitAmount, 18));
            });

            it("check claimableAmount after claim rewards", async function () {
                let [hexAmount, hexitAmount] =
                    await this.staking.claimableRewardsAmount(
                        this.staker_1.address,
                        this.mockUSDC.address
                    );

                expect(smallNum(hexAmount, 8)).to.be.equal(0);
                expect(smallNum(hexitAmount, 18)).to.be.equal(0);
            });

            it("reverts if try to unstake before 24 hours", async function () {
                let stakingInfo = await this.staking.stakingInfos(
                    this.staker_1.address,
                    this.mockUSDC.address
                );
                let stakedAmount = stakingInfo.stakedAmount;
                let unstakeAmount = BigInt(stakedAmount) / BigInt(2);

                await expect(
                    this.staking
                        .connect(this.staker_1)
                        .unstake(this.mockUSDC.address, unstakeAmount)
                ).to.be.revertedWith("too soon");
            });

            it("unstake tokens and check userStakingStatus", async function () {
                await spendTime(day);
                let stakingInfo = await this.staking.stakingInfos(
                    this.staker_1.address,
                    this.mockUSDC.address
                );
                let stakedAmount = stakingInfo.stakedAmount;
                let unstakeAmount = BigInt(stakedAmount) / BigInt(2);
                let beforeBal = await this.mockUSDC.balanceOf(
                    this.staker_1.address
                );
                await this.staking
                    .connect(this.staker_1)
                    .unstake(this.mockUSDC.address, unstakeAmount);
                let afterBal = await this.mockUSDC.balanceOf(
                    this.staker_1.address
                );

                expect(
                    smallNum(BigInt(afterBal) - BigInt(beforeBal), 18)
                ).to.be.equal(smallNum(unstakeAmount, 18));
            });
        });
    });

    describe("remove AllowedTokens", function () {
        it("reverts if caller is not the owner", async function () {
            await expect(
                this.staking.connect(this.staker_1).removeAllowedTokens([])
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("reverts if tokens length is zero", async function () {
            await expect(
                this.staking.removeAllowedTokens([])
            ).to.be.revertedWith("invalid length array");
        });

        it("reverts if token not exists", async function () {
            await expect(
                this.staking.removeAllowedTokens([ethers.constants.AddressZero])
            ).to.be.revertedWith("not exists allowedToken");
        });

        it("reverts if token's pool that going to remove is exists", async function () {
            expect(
                smallNum(
                    await this.staking.lockedTokenAmounts(this.mockUNI.address),
                    18
                )
            ).to.be.greaterThan(0);

            await expect(
                this.staking.removeAllowedTokens([this.mockUNI.address])
            ).to.be.revertedWith("live staking pools exist");
        });

        it("remove allowed tokens", async function () {
            let beforeStakingStatus = await this.staking.getUserStakingStatus(
                this.staker_1.address
            );
            await this.staking.removeAllowedTokens([this.hexToken.address]);
            let afterStakingStatus = await this.staking.getUserStakingStatus(
                this.staker_1.address
            );

            expect(
                beforeStakingStatus.length - afterStakingStatus.length
            ).to.be.equal(1);
        });
    });
});
