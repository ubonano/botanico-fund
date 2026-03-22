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
 * Actualiza el estado del bot y guarda un snapshot diario.
 * Recibe datos desglosados en 3 componentes (idle, fees, pool) y calcula PnL bimonetario.
 *
 * @param {FirebaseFirestore.WriteBatch} batch - Instancia del batch de Firestore.
 * @param {Object} botData - Datos desglosados del bot desde la blockchain.
 * @param {Object} botData.idle - Balance líquido { weth, wbtc }.
 * @param {Object} botData.fees - Comisiones pendientes { weth, wbtc }.
 * @param {Object} botData.pool - Liquidez activa en pool { weth, wbtc }.
 * @param {number} botData.totalWeth - WETH total (idle + fees + pool).
 * @param {number} botData.totalWbtc - WBTC total (idle + fees + pool).
 * @param {number} botData.poolPriceWbtcInWeth - Precio de 1 WBTC en WETH (del sqrtPriceX96).
 * @param {boolean} botData.hasActivePosition - Si hay posición NFT activa.
 * @param {Object} prices - Precios USD de Chainlink { WETH, WBTC, POL }.
 * @param {FirebaseFirestore.FieldValue} timestamp - Marca de tiempo del servidor.
 * @returns {Promise<void>}
 */
async function updateBotSnapshot(batch, botData, prices, timestamp) {
    const botStateRef = db.doc('bot_state/current');
    const botStateSnap = await botStateRef.get();
    const botStateData = botStateSnap.data() || {};

    // ═══ VALORES INICIALES (congelados una vez, leídos de Firestore) ═══
    let initialWeth = botStateData.initial_weth || 0;
    let initialWbtc = botStateData.initial_wbtc || 0;
    let initialPriceWeth = botStateData.initial_price_weth || 0;
    let initialPriceWbtc = botStateData.initial_price_wbtc || 0;
    let initialValueUsd = botStateData.initial_value_usd || 0;

    // Si es la primera vez, congelar los valores iniciales
    if (!botStateData.initial_value_usd && botData.totalWeth > 0) {
        initialWeth = botData.totalWeth;
        initialWbtc = botData.totalWbtc;
        initialPriceWeth = prices.WETH;
        initialPriceWbtc = prices.WBTC;
        initialValueUsd = (botData.totalWeth * prices.WETH) + (botData.totalWbtc * prices.WBTC);
    }

    // Posición inicial convertida a cada denominación
    const initialValueWeth = initialPriceWeth > 0 ? initialValueUsd / initialPriceWeth : 0;
    const initialValueWbtc = initialPriceWbtc > 0 ? initialValueUsd / initialPriceWbtc : 0;

    // ═══ VALORES ACTUALES ═══
    const totalValueUsd = (botData.totalWeth * prices.WETH) + (botData.totalWbtc * prices.WBTC);
    const totalValueWeth = prices.WETH > 0 ? totalValueUsd / prices.WETH : 0;
    const totalValueWbtc = prices.WBTC > 0 ? totalValueUsd / prices.WBTC : 0;

    // ═══ ROI POR TOKEN ═══
    const calculateRoi = (current, initial) => initial > 0 ? (current - initial) / initial : 0;
    const roiUsd = calculateRoi(totalValueUsd, initialValueUsd);
    const roiWeth = calculateRoi(totalValueWeth, initialValueWeth);
    const roiWbtc = calculateRoi(totalValueWbtc, initialValueWbtc);

    const stateData = {
        // Precios de mercado
        price_weth: prices.WETH,
        price_wbtc: prices.WBTC,
        price_pol: prices.POL,
        price_wbtc_in_weth: prices.WETH > 0 ? prices.WBTC / prices.WETH : 0,
        // Inventario desglosado
        idle_weth: botData.idle.weth,
        idle_wbtc: botData.idle.wbtc,
        fees_weth: botData.fees.weth,
        fees_wbtc: botData.fees.wbtc,
        pool_weth: botData.pool.weth,
        pool_wbtc: botData.pool.wbtc,
        total_weth: botData.totalWeth,
        total_wbtc: botData.totalWbtc,
        // Valores iniciales (congelados)
        initial_weth: initialWeth,
        initial_wbtc: initialWbtc,
        initial_price_weth: initialPriceWeth,
        initial_price_wbtc: initialPriceWbtc,
        initial_value_usd: initialValueUsd,
        initial_value_weth: initialValueWeth,
        initial_value_wbtc: initialValueWbtc,
        // Valores actuales (toda la posición convertida)
        total_value_usd: totalValueUsd,
        total_value_weth: totalValueWeth,
        total_value_wbtc: totalValueWbtc,
        // ROI por token
        roi_usd: roiUsd,
        roi_weth: roiWeth,
        roi_wbtc: roiWbtc,
        // Metadata
        has_active_position: botData.hasActivePosition,
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

