const { db } = require('../config/firebase');

/**
 * Actualiza el estado global del fondo en Firestore (colección 'fund_state' y 'snapshots').
 * Calcula el NAV (Net Asset Value) por métrica de activo para el fondo general y guarda
 * el historial del estado en un snapshot.
 *
 * @param {FirebaseFirestore.WriteBatch} batch - Instancia del batch de Firestore para agrupar las escrituras.
 * @param {Object} stats - Objeto con las métricas consolidadas de la blockchain.
 * @param {Object} stats.prices - Precios actuales de los tokens (ej. { WETH: 2500, WBTC: 60000 }).
 * @param {number} stats.wethWallet - Balance de WETH en la wallet.
 * @param {number} stats.wbtcWallet - Balance de WBTC en la wallet.
 * @param {number} stats.polWallet - Balance de POL (nativo) en la wallet.
 * @param {number} stats.usdtWallet - Balance de USDT en la wallet (informativo, no parte del fondo).
 * @param {number} stats.poolWeth - Balance de WETH invertido en pools de liquidez.
 * @param {number} stats.poolWbtc - Balance de WBTC invertido en pools de liquidez.
 * @param {number} stats.totalWeth - Balance total de WETH (wallet + pools).
 * @param {number} stats.totalWbtc - Balance total de WBTC (wallet + pools).
 * @param {number} stats.totalValueUsd - Valor total del fondo expresado en USD.
 * @param {FirebaseFirestore.FieldValue} timestamp - Marca de tiempo del servidor para la transacción.
 * 
 * @returns {Promise<{navUsd: number, navWeth: number, navWbtc: number}>} Retorna los NAVs calculados.
 */
async function updateFundState(batch, stats, timestamp) {
    const fundDocRef = db.doc(`fund_state/current`);
    const fundDocSnap = await fundDocRef.get();
    const fundDocData = fundDocSnap.data() || {};

    // SAFE PARSE: Si el campo no existe, asumir 0
    const totalShares = fundDocData.total_shares ? parseFloat(fundDocData.total_shares) : 0;

    const navUsd = totalShares > 0 ? stats.totalValueUsd / totalShares : 1.0;

    // Cross-Calculating total portfolio value in based assets
    const totalValueEnWeth = stats.totalWeth + (stats.totalWbtc * (stats.prices.WBTC / stats.prices.WETH));
    const navWeth = totalShares > 0 ? totalValueEnWeth / totalShares : (1.0 / stats.prices.WETH);

    const totalValueEnWbtc = stats.totalWbtc + (stats.totalWeth * (stats.prices.WETH / stats.prices.WBTC));
    const navWbtc = totalShares > 0 ? totalValueEnWbtc / totalShares : (1.0 / stats.prices.WBTC);

    const today = new Date().toISOString().split('T')[0];
    const fundSnapshotRef = db.collection('snapshots').doc(today);

    const stateData = {
        nav_usd: navUsd,
        nav_weth: navWeth,
        nav_wbtc: navWbtc,
        total_shares: totalShares,
        total_value_usd: stats.totalValueUsd,
        total_value_weth: totalValueEnWeth,
        total_value_wbtc: totalValueEnWbtc,
        inventory_weth: stats.totalWeth,
        inventory_wbtc: stats.totalWbtc,
    };

    batch.set(fundDocRef, { ...stateData, last_update_timestamp: timestamp }, { merge: true });
    batch.set(fundSnapshotRef, {
        ...stateData,
        timestamp,
        price_weth: stats.prices.WETH,
        price_wbtc: stats.prices.WBTC,
        price_pol: stats.prices.POL,
        balance_pol_wallet: stats.polWallet,
        balance_usdt_wallet: stats.usdtWallet,
        balance_weth_wallet: stats.wethWallet,
        balance_weth_pool: stats.poolWeth,
        balance_weth_total: stats.totalWeth,
        balance_wbtc_wallet: stats.wbtcWallet,
        balance_wbtc_pool: stats.poolWbtc,
        balance_wbtc_total: stats.totalWbtc,
    });

    return { navUsd, navWeth, navWbtc };
}

/**
 * Itera sobre todos los inversores en la colección 'investors' y actualiza el valor actual 
 * de su portafolio y su ROI en base a los nuevos NAVs calculados. Guarda un snapshot 
 * individual para cada inversor para llevar registro histórico.
 *
 * @param {FirebaseFirestore.WriteBatch} batch - Instancia del batch de Firestore.
 * @param {Object} navs - Objeto que contiene los Net Asset Values actuales.
 * @param {number} navs.navUsd - Valor de la acción expresado en USD.
 * @param {number} navs.navWeth - Valor de la acción expresado en WETH.
 * @param {number} navs.navWbtc - Valor de la acción expresado en WBTC.
 * @param {FirebaseFirestore.FieldValue} timestamp - Marca de tiempo del servidor.
 * 
 * @returns {Promise<void>}
 */
async function updateInvestors(batch, navs, timestamp) {
    const investorsSnap = await db.collection('investors').get();

    investorsSnap.forEach(invDoc => {
        const data = invDoc.data();
        const shares = parseFloat(data.current_shares || 0);
        const netUsd = parseFloat(data.net_investment_usd || 0);
        const netWbtc = parseFloat(data.net_investment_wbtc || 0);
        const netWeth = parseFloat(data.net_investment_weth || 0);

        const curValUsd = shares * navs.navUsd;
        const curValWbtc = shares * navs.navWbtc;
        const curValWeth = shares * navs.navWeth;

        const calculateRoi = (current, net) => net > 0 ? (current - net) / net : 0;

        const rUsd = calculateRoi(curValUsd, netUsd);
        const rWbtc = calculateRoi(curValWbtc, netWbtc);
        const rWeth = calculateRoi(curValWeth, netWeth);

        const avgPurchaseUsd = parseFloat(data.avg_purchase_nav_usd || 0);
        const avgPurchaseWbtc = parseFloat(data.avg_purchase_nav_wbtc || 0);
        const avgPurchaseWeth = parseFloat(data.avg_purchase_nav_weth || 0);
        const pnlUsd = parseFloat(data.total_realized_pnl_usd || 0);
        const pnlWbtc = parseFloat(data.total_realized_pnl_wbtc || 0);
        const pnlWeth = parseFloat(data.total_realized_pnl_weth || 0);

        const investorData = {
            current_shares: shares,
            net_investment_usd: netUsd,
            net_investment_wbtc: netWbtc,
            net_investment_weth: netWeth,
            roi_usd: rUsd,
            roi_wbtc: rWbtc,
            roi_weth: rWeth,
            avg_purchase_nav_usd: avgPurchaseUsd,
            avg_purchase_nav_wbtc: avgPurchaseWbtc,
            avg_purchase_nav_weth: avgPurchaseWeth,
            total_realized_pnl_usd: pnlUsd,
            total_realized_pnl_wbtc: pnlWbtc,
            total_realized_pnl_weth: pnlWeth
        };

        const invRef = invDoc.ref;
        batch.set(invRef, investorData, { merge: true });

        const snapshotData = {
            ...investorData,
            timestamp,
            total_value_usd: curValUsd,
            total_value_wbtc: curValWbtc,
            total_value_weth: curValWeth,
        };

        const invSnapshotRef = invRef.collection('snapshots').doc(new Date().toISOString().split('T')[0]);
        batch.set(invSnapshotRef, snapshotData);
    });
}

/**
 * Actualiza el estado del bot y guarda un snapshot diario en una colección separada.
 * Similar a updateFundState pero aislado del cálculo de inversores/NAV.
 * Lleva control de saldos, valor total y ROI general del bot.
 *
 * @param {FirebaseFirestore.WriteBatch} batch - Instancia del batch de Firestore.
 * @param {Object} botStats - Métricas del bot desde la blockchain.
 * @param {Object} botStats.prices - Precios actuales { WETH, WBTC, POL }.
 * @param {number} botStats.wethWallet - WETH suelto en el contrato.
 * @param {number} botStats.wbtcWallet - WBTC suelto en el contrato.
 * @param {number} botStats.polWallet - POL (gas) en el contrato.
 * @param {number} botStats.usdtWallet - USDT en el contrato.
 * @param {number} botStats.poolWeth - WETH invertido en posición LP.
 * @param {number} botStats.poolWbtc - WBTC invertido en posición LP.
 * @param {number} botStats.totalWeth - WETH total (wallet + pool).
 * @param {number} botStats.totalWbtc - WBTC total (wallet + pool).
 * @param {number} botStats.totalValueUsd - Valor total en USD.
 * @param {FirebaseFirestore.FieldValue} timestamp - Marca de tiempo del servidor.
 * @returns {Promise<void>}
 */
async function updateBotSnapshot(batch, botStats, timestamp) {
    const botStateRef = db.doc('bot_state/current');
    const botStateSnap = await botStateRef.get();
    const botStateData = botStateSnap.data() || {};

    // ROI: comparar valor actual vs valor inicial
    // El valor inicial se guarda la primera vez que se ejecuta el snapshot
    let initialValueUsd = botStateData.initial_value_usd || 0;
    let initialWeth = botStateData.initial_weth || 0;
    let initialWbtc = botStateData.initial_wbtc || 0;

    if (!botStateData.initial_value_usd && botStats.totalValueUsd > 0) {
        // Primera ejecución: guardar como inversión inicial
        initialValueUsd = botStats.totalValueUsd;
        initialWeth = botStats.totalWeth;
        initialWbtc = botStats.totalWbtc;
    }

    const calculateRoi = (current, initial) => initial > 0 ? (current - initial) / initial : 0;

    // ROI en USD, WETH y WBTC
    const roiUsd = calculateRoi(botStats.totalValueUsd, initialValueUsd);

    // Valor total expresado en WETH y WBTC para ROI en esos términos
    const totalValueWeth = botStats.totalWeth + (botStats.totalWbtc * (botStats.prices.WBTC / botStats.prices.WETH));
    const totalValueWbtc = botStats.totalWbtc + (botStats.totalWeth * (botStats.prices.WETH / botStats.prices.WBTC));
    const initialValueWeth = initialWeth + (initialWbtc * (botStats.prices.WBTC / botStats.prices.WETH));
    const initialValueWbtc = initialWbtc + (initialWeth * (botStats.prices.WETH / botStats.prices.WBTC));
    const roiWeth = calculateRoi(totalValueWeth, initialValueWeth);
    const roiWbtc = calculateRoi(totalValueWbtc, initialValueWbtc);

    const stateData = {
        // Saldos actuales
        balance_weth_wallet: botStats.wethWallet,
        balance_wbtc_wallet: botStats.wbtcWallet,
        balance_pol_wallet: botStats.polWallet,
        balance_usdt_wallet: botStats.usdtWallet,
        balance_weth_pool: botStats.poolWeth,
        balance_wbtc_pool: botStats.poolWbtc,
        balance_weth_total: botStats.totalWeth,
        balance_wbtc_total: botStats.totalWbtc,
        // Valores totales
        total_value_usd: botStats.totalValueUsd,
        total_value_weth: totalValueWeth,
        total_value_wbtc: totalValueWbtc,
        // Inversión inicial (se fija una vez)
        initial_value_usd: initialValueUsd,
        initial_weth: initialWeth,
        initial_wbtc: initialWbtc,
        // ROI
        roi_usd: roiUsd,
        roi_weth: roiWeth,
        roi_wbtc: roiWbtc,
        // Precios al momento
        price_weth: botStats.prices.WETH,
        price_wbtc: botStats.prices.WBTC,
        price_pol: botStats.prices.POL,
    };

    // Estado actual del bot
    batch.set(botStateRef, { ...stateData, last_update_timestamp: timestamp }, { merge: true });

    // Snapshot diario
    const today = new Date().toISOString().split('T')[0];
    const botSnapshotRef = db.collection('bot_snapshots').doc(today);
    batch.set(botSnapshotRef, { ...stateData, timestamp });
}

module.exports = {
    updateFundState,
    updateInvestors,
    updateBotSnapshot
};

