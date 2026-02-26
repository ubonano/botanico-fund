const functions = require("firebase-functions");
const { admin, db } = require("./config/firebase");
const { getMarketPrices, getWalletBalances, getPoolBalances } = require("./services/blockchain");
const { updateFundState, updateInvestors } = require("./services/firestore");

/**
 * Cloud Function expuesta por HTTP encargada de recolectar un pantallazo 
 * instantáneo (snapshot) del valor financiero general del fondo y de todos 
 * sus componentes descentralizados (DeFi/UniswapV3).
 * 
 * Recolecta métricas On-Chain nativas en Polygon, balance de billeteras en caliente, 
 * y calcula por acción (Shares NAV). Por su parte actualiza bases de datos Firestore con el 
 * estado más actualizado e iterando el total de sus accionistas / Inversores.
 * 
 * @param {functions.https.Request} req - Objeto del requerimiento HTTP enlazado que encapsula params o body.
 * @param {functions.Response} res - Objeto de respuesta HTTP para informar status, header o retornos raw.
 * @returns {Promise<void>} Termina de resolver dando retorno final e informativo a la API.
 */
exports.marketSnapshot = functions.https.onRequest(async (req, res) => {
    try {
        const walletAddress = req.query.walletAddress || req.body.walletAddress;
        if (!walletAddress) {
            return res.status(400).send("Falta el parámetro 'walletAddress'");
        }

        // 1. Obtener la data volátil y valores (Blockchain & Oráculos DEX)
        const prices = await getMarketPrices();
        const { weth: wethWallet, wbtc: wbtcWallet, usdt: usdtWallet } = await getWalletBalances(walletAddress);
        const { poolWeth, poolWbtc } = await getPoolBalances(walletAddress);

        // Consolidados finales
        const totalWeth = wethWallet + poolWeth;
        const totalWbtc = wbtcWallet + poolWbtc;
        const totalValueUsd = (totalWeth * prices.WETH) + (totalWbtc * prices.WBTC) + usdtWallet;

        // Estructura de estadísticas unificadas  
        const stats = {
            prices,
            wethWallet, wbtcWallet, usdtWallet,
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
        const msg = `[Snapshot Complete] Total: $${totalValueUsd.toFixed(2)} | NAV: $${navs.navUsd.toFixed(4)}`;
        console.log(msg);
        res.status(200).send(msg);

    } catch (error) {
        console.error("Error executing market snapshot:", error);
        res.status(500).send(`Error interno: ${error.message}`);
    }
});
