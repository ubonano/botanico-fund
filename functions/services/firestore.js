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
 * @param {number} stats.usdtWallet - Balance de USDT en la wallet.
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
    const navWeth = totalShares > 0 ? stats.totalWeth / totalShares : (1.0 / stats.prices.WETH);
    const navWbtc = totalShares > 0 ? stats.totalWbtc / totalShares : (1.0 / stats.prices.WBTC);

    const snapshotId = `${Date.now()}`;
    const fundSnapshotRef = db.collection('snapshots').doc(snapshotId);

    const stateData = {
        nav_usd: navUsd,
        nav_weth: navWeth,
        nav_wbtc: navWbtc,
        total_shares: totalShares,
        total_value_usd: stats.totalValueUsd,
        total_value_weth: stats.totalWeth,
        total_value_wbtc: stats.totalWbtc,
    };

    batch.set(fundDocRef, { ...stateData, last_update_timestamp: timestamp }, { merge: true });
    batch.set(fundSnapshotRef, {
        ...stateData,
        timestamp,
        price_weth: stats.prices.WETH,
        price_wbtc: stats.prices.WBTC,
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

        const investorData = {
            current_shares: shares,
            net_investment_usd: netUsd,
            net_investment_wbtc: netWbtc,
            net_investment_weth: netWeth,
            roi_usd: rUsd,
            roi_wbtc: rWbtc,
            roi_weth: rWeth
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

        const invSnapshotRef = invRef.collection('snapshots').doc(`${Date.now()}`);
        batch.set(invSnapshotRef, snapshotData);
    });
}

module.exports = {
    updateFundState,
    updateInvestors
};
