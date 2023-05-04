const { network } = require("hardhat");
const { hour } = require("./utils");

const DEPLOYMENT_PARAM = {
    mainnet: {
        dexRouter: "",
        hexToken: "",
        usdcAddress: "",
        usdcPriceFeed: "",
        feeReceiver: "",
    },
    fuji: {
        dexRouter: "0x3705aBF712ccD4fc56Ee76f0BD3009FD4013ad75",
        hexToken: "0xEb06b60E0b3A421a7100A3b09fd25DE119831694",
        usdcAddress: "0x8025e948a7d494A845588099cb861a903EAdcF93",
        usdcPriceFeed: "0x7898AcCC83587C3C55116c5230C17a6Cd9C71bad",
        feeReceiver: "0x4364E1d16526c954b029b6cf9335CB1b0eaAfB69",
        teamWallet: "0x4364E1d16526c954b029b6cf9335CB1b0eaAfB69",
        feeRate: 100, // 10%
        minStakingDuration: 1, // 1 day
        maxStakingDuration: 10, // 10 days
        sacrificeStartTime: hour, // means after 0 seconds
        sacrificeDuration: 1, // 1 day
        airdropStartTime: hour, // means after 0 seconds
        airdropDuration: 1, // 1 days
        rateForSacrifice: 800,
        rateForAirdrop: 200,
        sacrificeDistRate: 750,
        sacrificeLiquidityRate: 250,
        airdropDistRateForHexHolder: 1000,
        airdropDistRateForHEXITHolder: 9000,
        hexitDistRateForStaking: 50, // 5%
    },
};

const getDeploymentParam = () => {
    if (network.name == "fuji") {
        return DEPLOYMENT_PARAM.fuji;
    } else if (network.name == "mainnet") {
        return DEPLOYMENT_PARAM.mainnet;
    } else {
        return {};
    }
};

module.exports = {
    getDeploymentParam,
};