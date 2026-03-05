const { db } = require("../config/firebase");
const { getMarketPrices } = require("./blockchain");
const { executeMarketSnapshot } = require("./snapshot");

/**
 * Procesa la carga de comisiones generadas por las pools de liquidez.
 * 
 * 1. Fuerza un snapshot del mercado para tener el NAV actualizado.
 * 2. Obtiene precios actuales de WETH y WBTC.
 * 3. Lee la configuración del fondo para obtener el fundInvestorId.
 * 4. Ejecuta una transacción atómica donde:
 *    - Calcula la participación de cada inversor activo.
 *    - Cobra la comisión de servicio transfiriendo cuotapartes al inversor fondo.
 *    - Registra la operación en la colección 'commissions' y en las operaciones de cada inversor.
 *
 * @param {number} amountUsd - Monto total de comisiones recolectadas en USD.
 * @returns {Promise<string>} Mensaje de éxito con los detalles de la operación.
 */
async function processCommissions(amountUsd) {
    if (typeof amountUsd !== 'number' || amountUsd <= 0) {
        throw new Error("amountUsd debe ser un número mayor a 0.");
    }

    console.log(`[Commissions] Iniciando carga de comisiones por $${amountUsd}...`);

    // 1. Forzar snapshot para tener el NAV actualizado
    console.log(`[Commissions] Forzando ejecución de market snapshot...`);
    await executeMarketSnapshot();

    // 2. Obtener precios actuales
    const prices = await getMarketPrices();
    const amountWbtc = amountUsd / prices.WBTC;
    const amountWeth = amountUsd / prices.WETH;

    // 3. Leer configuración del fondo
    const configRef = db.collection("config").doc("fund");
    const configSnap = await configRef.get();

    if (!configSnap.exists) {
        throw new Error("No existe el documento de configuración en Firestore ('config/fund').");
    }

    const configData = configSnap.data();
    const fundInvestorId = configData.fundInvestorId;

    if (!fundInvestorId) {
        throw new Error("Falta configurar 'fundInvestorId' en la colección 'config' documento 'fund'.");
    }

    // 4. Transacción atómica en Firestore
    const fundDocRef = db.doc(`fund_state/current`);
    const fundInvestorRef = db.doc(`investors/${fundInvestorId}`);

    const resultMsg = await db.runTransaction(async (transaction) => {
        // Leer estado del fondo
        const fundSnap = await transaction.get(fundDocRef);
        if (!fundSnap.exists) {
            throw new Error("El documento de estado del fondo ('fund_state/current') no existe.");
        }

        const fundData = fundSnap.data();
        const totalShares = fundData.total_shares ? parseFloat(fundData.total_shares) : 0;
        let navUsd = fundData.nav_usd ? parseFloat(fundData.nav_usd) : 1.0;

        if (totalShares <= 0) {
            throw new Error("No hay cuotapartes emitidas en el fondo. No se pueden procesar comisiones.");
        }

        if (navUsd <= 0) navUsd = 1.0;

        // Leer el inversor fondo
        const fundInvestorSnap = await transaction.get(fundInvestorRef);
        let fundInvestorShares = 0;
        if (fundInvestorSnap.exists) {
            fundInvestorShares = parseFloat(fundInvestorSnap.data().current_shares || 0);
        }

        // Leer todos los inversores
        const investorsSnap = await db.collection('investors').get();
        const details = [];
        let totalCommissionUsd = 0;
        let totalSharesTransferred = 0;

        const investorUpdates = [];

        investorsSnap.forEach(invDoc => {
            const invData = invDoc.data();
            const invId = invDoc.id;
            const shares = parseFloat(invData.current_shares || 0);
            const commissionRate = parseFloat(invData.commission_rate || 0);

            // Solo inversores activos (con cuotapartes > 0) y que no sean el inversor fondo
            if (shares <= 0 || invId === fundInvestorId) return;
            // Solo inversores con comisión configurada
            if (commissionRate <= 0) return;

            // Calcular participación del inversor
            const participation = shares / totalShares;

            // Calcular su parte de la comisión
            const investorCommissionPortion = amountUsd * participation;

            // Calcular el monto a cobrar como comisión de servicio
            const commissionUsd = investorCommissionPortion * commissionRate;

            // Convertir a cuotapartes
            const sharesToTransfer = commissionUsd / navUsd;

            const newInvestorShares = shares - sharesToTransfer;

            investorUpdates.push({
                invId,
                invRef: invDoc.ref,
                sharesBefore: shares,
                sharesAfter: newInvestorShares,
                sharesToTransfer,
                commissionUsd,
                commissionRate,
                participation,
            });

            totalCommissionUsd += commissionUsd;
            totalSharesTransferred += sharesToTransfer;

            details.push({
                investor_id: invId,
                participation,
                commission_rate: commissionRate,
                commission_usd: commissionUsd,
                shares_transferred: sharesToTransfer,
            });
        });

        // Aplicar actualizaciones a cada inversor
        for (const update of investorUpdates) {
            // Actualizar cuotapartes del inversor
            transaction.set(update.invRef, {
                current_shares: update.sharesAfter,
            }, { merge: true });

            // Registrar operación COMMISSION en el inversor
            const opRef = update.invRef.collection('operations').doc(`${Date.now()}_${update.invId}`);
            transaction.set(opRef, {
                timestamp: new Date().toISOString(),
                type: 'COMMISSION',
                commission_usd: update.commissionUsd,
                shares_transferred: -update.sharesToTransfer,
                shares_before: update.sharesBefore,
                shares_after: update.sharesAfter,
                commission_rate: update.commissionRate,
                participation: update.participation,
                price_wbtc: prices.WBTC,
                price_weth: prices.WETH,
                nav_usd_applied: navUsd,
            });
        }

        // Sumar cuotapartes al inversor fondo
        const newFundInvestorShares = fundInvestorShares + totalSharesTransferred;
        transaction.set(fundInvestorRef, {
            current_shares: newFundInvestorShares,
        }, { merge: true });

        // Registrar operación COMMISSION_INCOME en el inversor fondo
        if (totalSharesTransferred > 0) {
            const fundOpRef = fundInvestorRef.collection('operations').doc(`${Date.now()}_fund`);
            transaction.set(fundOpRef, {
                timestamp: new Date().toISOString(),
                type: 'COMMISSION_INCOME',
                total_commission_usd: totalCommissionUsd,
                shares_received: totalSharesTransferred,
                shares_before: fundInvestorShares,
                shares_after: newFundInvestorShares,
                price_wbtc: prices.WBTC,
                price_weth: prices.WETH,
                nav_usd_applied: navUsd,
            });
        }

        // Registrar documento global de comisiones
        const commissionDocRef = db.collection('commissions').doc(`${Date.now()}`);
        transaction.set(commissionDocRef, {
            timestamp: new Date().toISOString(),
            amount_usd: amountUsd,
            amount_wbtc: amountWbtc,
            amount_weth: amountWeth,
            price_wbtc: prices.WBTC,
            price_weth: prices.WETH,
            nav_usd: navUsd,
            total_shares_at_time: totalShares,
            total_commission_charged_usd: totalCommissionUsd,
            total_shares_transferred: totalSharesTransferred,
            details,
        });

        return `[Success] Comisiones procesadas: $${amountUsd.toFixed(2)} cargados. Comisión de servicio cobrada: $${totalCommissionUsd.toFixed(4)} (${totalSharesTransferred.toFixed(4)} cuotapartes transferidas al fondo).`;
    });

    console.log(resultMsg);
    return resultMsg;
}

module.exports = {
    processCommissions
};
