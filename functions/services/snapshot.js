const { admin, db } = require("../config/firebase");
const { getMarketPrices, getWalletBalances, getPoolBalances } = require("./blockchain");
const { updateFundState, updateInvestors, updateBotSnapshot } = require("./firestore");
const { getBotSnapshotData } = require("./botSnapshot");

/**
 * Lógica central para obtener el snapshot del mercado y actualizar Firestore.
 * Incluye snapshot del fondo principal Y del bot de liquidez.
 */
async function executeMarketSnapshot() {
    // Obtener la configuración del fondo desde Firestore
    const configRef = db.collection("config").doc("fund");
    const configSnap = await configRef.get();

    if (!configSnap.exists) {
        throw new Error("No existe el documento de configuración en Firestore ('config/fund').");
    }

    const configData = configSnap.data();
    const walletAddress = configData.walletAddress;
    const botAddress = configData.botAddress;

    if (!walletAddress) {
        throw new Error("Falta configurar la 'walletAddress' en la colección 'config' documento 'fund'.");
    }

    // 1. Obtener precios (compartido para fondo y bot)
    const prices = await getMarketPrices();

    // 2. Snapshot del FONDO PRINCIPAL
    const { weth: wethWallet, wbtc: wbtcWallet, usdt: usdtWallet, matic: polWallet } = await getWalletBalances(walletAddress);
    const { poolWeth, poolWbtc } = await getPoolBalances(walletAddress);

    const totalWeth = wethWallet + poolWeth;
    const totalWbtc = wbtcWallet + poolWbtc;
    const totalValueUsd = (totalWeth * prices.WETH) + (totalWbtc * prices.WBTC);

    const stats = {
        prices,
        wethWallet, wbtcWallet, polWallet, usdtWallet,
        poolWeth, poolWbtc,
        totalWeth, totalWbtc,
        totalValueUsd
    };

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();

    const navs = await updateFundState(batch, stats, timestamp);
    await updateInvestors(batch, navs, timestamp);

    // 3. Snapshot del BOT DE LIQUIDEZ (desglosado en idle + fees + pool)
    if (botAddress) {
        try {
            const botData = await getBotSnapshotData();
            await updateBotSnapshot(batch, botData, prices, timestamp);

            const totalUsd = (botData.totalWeth * prices.WETH) + (botData.totalWbtc * prices.WBTC);
            console.log(`[Bot Snapshot] $${totalUsd.toFixed(2)} | WETH: ${botData.totalWeth.toFixed(6)} (idle:${botData.idle.weth.toFixed(6)} fees:${botData.fees.weth.toFixed(6)} pool:${botData.pool.weth.toFixed(6)}) | WBTC: ${botData.totalWbtc.toFixed(8)} (idle:${botData.idle.wbtc.toFixed(8)} fees:${botData.fees.wbtc.toFixed(8)} pool:${botData.pool.wbtc.toFixed(8)})`);
        } catch (err) {
            console.error("[Bot Snapshot Error]", err);
            // No bloquear el snapshot principal si falla el del bot
        }
    }

    await batch.commit();

    return `[Snapshot Complete] Total: $${totalValueUsd.toFixed(2)} | NAV: $${navs.navUsd.toFixed(4)}`;
}

module.exports = {
    executeMarketSnapshot
};

