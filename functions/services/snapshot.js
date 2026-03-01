const { admin, db } = require("../config/firebase");
const { getMarketPrices, getWalletBalances, getPoolBalances } = require("./blockchain");
const { updateFundState, updateInvestors } = require("./firestore");

/**
 * Lógica central para obtener el snapshot del mercado y actualizar Firestore.
 * Puede ser invocada tanto por la función programada como por la HTTP.
 */
async function executeMarketSnapshot() {
    // Obtener la configuración del fondo desde Firestore para extraer la wallet
    const configRef = db.collection("config").doc("fund");
    const configSnap = await configRef.get();

    if (!configSnap.exists) {
        throw new Error("No existe el documento de configuración en Firestore ('config/fund').");
    }

    const configData = configSnap.data();
    const walletAddress = configData.walletAddress;

    if (!walletAddress) {
        throw new Error("Falta configurar la 'walletAddress' en la colección 'config' documento 'fund'.");
    }

    // 1. Obtener la data volátil y valores (Blockchain & Oráculos DEX)
    const prices = await getMarketPrices();
    const { weth: wethWallet, wbtc: wbtcWallet, usdt: usdtWallet, matic: polWallet } = await getWalletBalances(walletAddress);
    const { poolWeth, poolWbtc } = await getPoolBalances(walletAddress);

    // Consolidados finales (solo activos del fondo: WETH + WBTC)
    const totalWeth = wethWallet + poolWeth;
    const totalWbtc = wbtcWallet + poolWbtc;
    const totalValueUsd = (totalWeth * prices.WETH) + (totalWbtc * prices.WBTC);

    // Estructura de estadísticas unificadas  
    const stats = {
        prices,
        wethWallet, wbtcWallet, polWallet, usdtWallet,
        poolWeth, poolWbtc,
        totalWeth, totalWbtc,
        totalValueUsd
    };

    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    // 2. Transaccionar la actualización de base de datos a un Batch unificado.
    const batch = db.batch();

    const navs = await updateFundState(batch, stats, timestamp);
    await updateInvestors(batch, navs, timestamp);

    await batch.commit(); // Impacto atómico real sobre todo Firestore

    // Salida limpia
    return `[Snapshot Complete] Total: $${totalValueUsd.toFixed(2)} | NAV: $${navs.navUsd.toFixed(4)}`;
}

module.exports = {
    executeMarketSnapshot
};
