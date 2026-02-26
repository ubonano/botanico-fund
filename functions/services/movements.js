const { db } = require("../config/firebase");
const { getMarketPrices } = require("./blockchain");
const { executeMarketSnapshot } = require("./snapshot");

/**
 * Procesa un movimiento de capital (DEPOSIT o WITHDRAWAL) para un inversor.
 * 1. Fuerza un snapshot del mercado para tener el NAV actualizado.
 * 2. Obtiene los precios actuales para valuar el movimiento.
 * 3. Ejecuta una transacción atómica para actualizar el fondo y el inversor.
 *
 * @param {string} investorId - ID del inversor.
 * @param {string} type - Tipo de movimiento ('DEPOSIT' o 'WITHDRAWAL').
 * @param {number} amountUsd - Monto del movimiento en dólares.
 * @returns {Promise<string>} Mensaje de éxito con los detalles de la operación.
 */
async function processCapitalMovement(investorId, type, amountUsd) {
    if (!investorId) throw new Error("investorId es requerido.");
    if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') throw new Error("type debe ser 'DEPOSIT' o 'WITHDRAWAL'.");
    if (typeof amountUsd !== 'number' || amountUsd <= 0) throw new Error("amountUsd debe ser un número mayor a 0.");

    console.log(`[Movement] Iniciando procesamiento de ${type} de $${amountUsd} para el inversor ${investorId}...`);

    // 1. Forzar un snapshot del mercado para asegurar el NAV más reciente
    console.log(`[Movement] Forzando ejecución de market snapshot...`);
    await executeMarketSnapshot();

    // 2. Obtener precios actuales para el cálculo de los aportes en crypto
    const prices = await getMarketPrices();

    // 3. Iniciar transacción en Firestore
    const fundDocRef = db.doc(`fund_state/current`);
    const investorRef = db.doc(`investors/${investorId}`);

    const resultMsg = await db.runTransaction(async (transaction) => {
        const fundSnap = await transaction.get(fundDocRef);
        const investorSnap = await transaction.get(investorRef);

        if (!fundSnap.exists) {
            throw new Error("El documento de estado del fondo ('fund_state/current') no existe.");
        }

        const fundData = fundSnap.data();
        let totalShares = fundData.total_shares ? parseFloat(fundData.total_shares) : 0;
        let navUsd = fundData.nav_usd ? parseFloat(fundData.nav_usd) : 1.0;
        let navWbtc = fundData.nav_wbtc ? parseFloat(fundData.nav_wbtc) : (1.0 / prices.WBTC);
        let navWeth = fundData.nav_weth ? parseFloat(fundData.nav_weth) : (1.0 / prices.WETH);

        // Si el NAV es 0 (caso extremo, evitar división por cero)
        if (navUsd <= 0) navUsd = 1.0;
        if (navWbtc <= 0) navWbtc = 1.0 / prices.WBTC;
        if (navWeth <= 0) navWeth = 1.0 / prices.WETH;

        // Calcular cuotapartes a operar
        const sharesOperated = amountUsd / navUsd;
        const sharesModifier = type === 'DEPOSIT' ? sharesOperated : -sharesOperated;

        const amountWbtc = amountUsd / prices.WBTC;
        const amountWeth = amountUsd / prices.WETH;
        const cryptoModifier = type === 'DEPOSIT' ? 1 : -1;

        // Variables del Inversor
        let currentShares = 0;
        let netUsd = 0, netWbtc = 0, netWeth = 0;
        let realizedPnlUsdTotal = 0, realizedPnlWbtcTotal = 0, realizedPnlWethTotal = 0;

        if (investorSnap.exists) {
            const invData = investorSnap.data();
            currentShares = invData.current_shares ? parseFloat(invData.current_shares) : 0;
            netUsd = invData.net_investment_usd ? parseFloat(invData.net_investment_usd) : 0;
            netWbtc = invData.net_investment_wbtc ? parseFloat(invData.net_investment_wbtc) : 0;
            netWeth = invData.net_investment_weth ? parseFloat(invData.net_investment_weth) : 0;
            realizedPnlUsdTotal = invData.total_realized_pnl_usd ? parseFloat(invData.total_realized_pnl_usd) : 0;
            realizedPnlWbtcTotal = invData.total_realized_pnl_wbtc ? parseFloat(invData.total_realized_pnl_wbtc) : 0;
            realizedPnlWethTotal = invData.total_realized_pnl_weth ? parseFloat(invData.total_realized_pnl_weth) : 0;
        } else if (type === 'WITHDRAWAL') {
            throw new Error("No se puede realizar un retiro para un inversor inexistente.");
        }

        const newTotalShares = totalShares + sharesModifier;
        const newInvestorShares = currentShares + sharesModifier;

        if (newInvestorShares < 0) {
            throw new Error(`El inversor no tiene suficientes cuotapartes para retirar $${amountUsd}. Máximo posible basado en el NAV actual ($${navUsd}) es ${currentShares * navUsd}`);
        }

        let newNetUsd = netUsd;
        let newNetWbtc = netWbtc;
        let newNetWeth = netWeth;
        let opRealizedPnlUsd = 0;
        let opRealizedPnlWbtc = 0;
        let opRealizedPnlWeth = 0;

        if (type === 'DEPOSIT') {
            newNetUsd += amountUsd;
            newNetWbtc += amountWbtc;
            newNetWeth += amountWeth;
        } else if (type === 'WITHDRAWAL') {
            // Calcular porcentaje retirado para deducción proporcional de inversión inicial
            const porcRetirado = sharesOperated / currentShares;

            const costoBaseRetiradoUsd = netUsd * porcRetirado;
            const costoBaseRetiradoWbtc = netWbtc * porcRetirado;
            const costoBaseRetiradoWeth = netWeth * porcRetirado;

            newNetUsd -= costoBaseRetiradoUsd;
            newNetWbtc -= costoBaseRetiradoWbtc;
            newNetWeth -= costoBaseRetiradoWeth;

            // Ganancia Realizada (PnL) de la operación
            opRealizedPnlUsd = amountUsd - costoBaseRetiradoUsd;
            opRealizedPnlWbtc = amountWbtc - costoBaseRetiradoWbtc;
            opRealizedPnlWeth = amountWeth - costoBaseRetiradoWeth;

            // Acumulación histórica de ganancias realizadas
            realizedPnlUsdTotal += opRealizedPnlUsd;
            realizedPnlWbtcTotal += opRealizedPnlWbtc;
            realizedPnlWethTotal += opRealizedPnlWeth;
        }

        // Evitar negativos minúsculos flotantes por javascript math
        if (newNetUsd < 0.0001) newNetUsd = 0;
        if (newNetWbtc < 0.00000001) newNetWbtc = 0;
        if (newNetWeth < 0.00000001) newNetWeth = 0;

        // Calcular nuevo ROI latente con todas las monedas
        const currentValUsd = newInvestorShares * navUsd;
        const roiUsd = newNetUsd > 0 ? (currentValUsd - newNetUsd) / newNetUsd : 0;

        const currentValWbtc = newInvestorShares * navWbtc;
        const roiWbtc = newNetWbtc > 0 ? (currentValWbtc - newNetWbtc) / newNetWbtc : 0;

        const currentValWeth = newInvestorShares * navWeth;
        const roiWeth = newNetWeth > 0 ? (currentValWeth - newNetWeth) / newNetWeth : 0;

        // Precio promedio de compra de la cuotaparte
        const avgPurchaseNavUsd = newInvestorShares > 0 ? newNetUsd / newInvestorShares : 0;
        const avgPurchaseNavWbtc = newInvestorShares > 0 ? newNetWbtc / newInvestorShares : 0;
        const avgPurchaseNavWeth = newInvestorShares > 0 ? newNetWeth / newInvestorShares : 0;

        // Preparar escrituras
        transaction.set(fundDocRef, {
            total_shares: newTotalShares
        }, { merge: true });

        const investorData = {
            current_shares: newInvestorShares,
            net_investment_usd: newNetUsd,
            net_investment_wbtc: newNetWbtc,
            net_investment_weth: newNetWeth,
            roi_usd: roiUsd,
            roi_wbtc: roiWbtc,
            roi_weth: roiWeth,
            avg_purchase_nav_usd: avgPurchaseNavUsd,
            avg_purchase_nav_wbtc: avgPurchaseNavWbtc,
            avg_purchase_nav_weth: avgPurchaseNavWeth,
            total_realized_pnl_usd: realizedPnlUsdTotal,
            total_realized_pnl_wbtc: realizedPnlWbtcTotal,
            total_realized_pnl_weth: realizedPnlWethTotal
            // Nota: name se omite si ya existe o se podría añadir, 
            // pero típicamente el doc ID es el nombre o se maneja aparte.
        };

        if (!investorSnap.exists) {
            investorData.name = investorId;
        }

        transaction.set(investorRef, investorData, { merge: true });

        // Registrar operación
        const operationRef = investorRef.collection('operations').doc(`${Date.now()}`);
        transaction.set(operationRef, {
            timestamp: new Date().toISOString(), // No usamos serverTimestamp en ops hist. si queremos precisión de bloque, o sí, usamos el local del server
            type: type,
            amount_usd: amountUsd,
            amount_wbtc: amountWbtc,
            amount_weth: amountWeth,
            price_wbtc: prices.WBTC,
            price_weth: prices.WETH,
            nav_usd_applied: navUsd,
            shares_operated: sharesModifier,
            shares_before: currentShares,
            shares_after: newInvestorShares,
            net_usd_before: netUsd,
            net_usd_after: newNetUsd,
            realized_pnl_usd: type === 'WITHDRAWAL' ? opRealizedPnlUsd : 0,
            realized_pnl_wbtc: type === 'WITHDRAWAL' ? opRealizedPnlWbtc : 0,
            realized_pnl_weth: type === 'WITHDRAWAL' ? opRealizedPnlWeth : 0
        });

        return `[Success] ${investorId} procesado: nuevo balance ${newInvestorShares.toFixed(4)} shares. ROI USD actual: ${(roiUsd * 100).toFixed(2)}%`;
    });

    console.log(resultMsg);
    return resultMsg;
}

module.exports = {
    processCapitalMovement
};
