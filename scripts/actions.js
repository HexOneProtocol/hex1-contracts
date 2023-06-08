const { ethers, network } = require("hardhat");
const { getContract, getCurrentTimestamp } = require("./utils");
const { getDeploymentParam } = require("./param");

async function getHexTokenFeeInfo() {
    const hexOneProtocol = await getContract(
        "HexOneProtocol",
        "HexOneProtocol",
        network.name
    );

    let param = getDeploymentParam();
    let hexTokenAddr = param.hexToken;
    console.log(await hexOneProtocol.fees(hexTokenAddr));
}

async function getRewardsPoolInfo() {
    const hexOneStaking = await getContract(
        "HexOneStaking",
        "HexOneStaking",
        network.name
    );

    console.log("rewardsPool info: ", await hexOneStaking.rewardsPool());
}

async function setHexTokenFeeInfo(feeRate) {
    const hexOneProtocol = await getContract(
        "HexOneProtocol",
        "HexOneProtocol",
        network.name
    );
    let param = getDeploymentParam();
    let hexTokenAddr = param.hexToken;
    console.log("set depositFeeRate");
    let tx = await hexOneProtocol.setDepositFee(hexTokenAddr, feeRate);
    await tx.wait();
    console.log("enable DepositFee");
    tx = await hexOneProtocol.setDepositFeeEnable(hexTokenAddr, true);
    await tx.wait();
    console.log("setHexTokenDepositFee successfully");
}

async function enableStaking() {
    const hexOneStaking = await getContract(
        "HexOneStaking",
        "HexOneStaking",
        network.name
    );

    console.log(
        "current staking status: ",
        await hexOneStaking.stakingEnable()
    );

    let tx = await hexOneStaking.enableStaking();
    await tx.wait();

    console.log("after staking status: ", await hexOneStaking.stakingEnable());
}

async function generateAdditionalTokens() {
    const hexOneBootstrap = await getContract(
        "HexOneBootstrap",
        "HexOneBootstrap",
        network.name
    );

    console.log(
        "generateAdditionalTokens and purchase hexit to staking contract"
    );
    await hexOneBootstrap.generateAdditionalTokens();
    console.log("addtionalTokens generated successfully!");
}

async function createHexStakingPool() {
    const hexOneStaking = await getContract(
        "HexOneStaking",
        "HexOneStaking",
        network.name
    );
    let param = getDeploymentParam();
    let hexTokenAddr = param.hexToken;

    console.log("add hex token to allowToken list");
    let tx = await hexOneStaking.addAllowedTokens(
        [hexTokenAddr],
        [{ hexDistRate: 0, hexitDistRate: 2000 }]
    );
    await tx.wait();
    console.log("processed successfully!");
}

async function increasePriceFeedRate() {
    const hexOnePriceFeed = await getContract(
        "HexOnePriceFeedTest",
        "HexOnePriceFeedTest",
        network.name
    );
    console.log("set priceFeed rate as 150%");
    let tx = await hexOnePriceFeed.setTestRate(1500);
    await tx.wait();
    console.log("processed successfully!");
}

async function decreasePriceFeedRate() {
    const hexOnePriceFeed = await getContract(
        "HexOnePriceFeedTest",
        "HexOnePriceFeedTest",
        network.name
    );
    console.log("set priceFeed rate as 80%");
    let tx = await hexOnePriceFeed.setTestRate(800);
    await tx.wait();
    console.log("processed successfully!");
}

async function setHexOneEscrowAddress() {
    const hexOneProtocol = await getContract(
        "HexOneProtocol",
        "HexOneProtocol",
        network.name
    );
    const hexOneEscrow = await getContract(
        "HexOneEscrow",
        "HexOneEscrow",
        network.name
    );
    console.log("setting EscrowContract address");
    let tx = await hexOneProtocol.setEscrowContract(hexOneEscrow.address);
    await tx.wait();
    console.log("processed successfully!");
}

async function depositEscrowHexToProtocol() {
    const hexOneEscrow = await getContract(
        "HexOneEscrow",
        "HexOneEscrow",
        network.name
    );
    // console.log("deposit escrow hex to protocol");
    // let tx = await hexOneEscrow.depositCollateralToHexOneProtocol(5);
    // await tx.wait();
    // console.log("processed successfully!");

    let walletAddress = "0xd1C56Cf01B810e6AD2c22A583A7DeaB7F1d5eFfa";
    console.log(await hexOneEscrow.getOverview(walletAddress));
}

async function getLiquidableDeposits() {
    const hexOneVault = await getContract(
        "HexOneVault",
        "HexOneVault",
        network.name
    );
    console.log(await hexOneVault.getLiquidableDeposits());
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Action contract with the account: ", deployer.address);

    // await getHexTokenFeeInfo();
    // await setHexTokenFeeInfo(50); // set feeRate as 5%
    // await getHexTokenFeeInfo();

    // await getRewardsPoolInfo();
    // await generateAdditionalTokens();
    // await getRewardsPoolInfo();

    // await enableStaking();

    // await createHexStakingPool();

    // await increasePriceFeedRate();
    // await decreasePriceFeedRate();

    // await setHexOneEscrowAddress();

    await depositEscrowHexToProtocol();

    // await getLiquidableDeposits();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });