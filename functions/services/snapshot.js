const { admin, db } = require("../config/firebase");
const { getMarketPrices, getWalletBalances, getPoolBalances } = require("./blockchain");
const { updateFundState, updateInvestors, updateBotSnapshot } = require("./firestore");

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

    // 3. Snapshot del BOT DE LIQUIDEZ (si hay botAddress configurado)
    if (botAddress) {
        try {
            const { weth: botWeth, wbtc: botWbtc, usdt: botUsdt, matic: botPol } = await getWalletBalances(botAddress);
            const { poolWeth: botPoolWeth, poolWbtc: botPoolWbtc } = await getPoolBalances(botAddress);

            const botTotalWeth = botWeth + botPoolWeth;
            const botTotalWbtc = botWbtc + botPoolWbtc;
            const botTotalValueUsd = (botTotalWeth * prices.WETH) + (botTotalWbtc * prices.WBTC);

            const botStats = {
                prices,
                wethWallet: botWeth,
                wbtcWallet: botWbtc,
                polWallet: botPol,
                usdtWallet: botUsdt,
                poolWeth: botPoolWeth,
                poolWbtc: botPoolWbtc,
                totalWeth: botTotalWeth,
                totalWbtc: botTotalWbtc,
                totalValueUsd: botTotalValueUsd
            };

            await updateBotSnapshot(batch, botStats, timestamp);
            console.log(`[Bot Snapshot] $${botTotalValueUsd.toFixed(2)} | WETH: ${botTotalWeth.toFixed(6)} | WBTC: ${botTotalWbtc.toFixed(8)}`);
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
