const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./config/firebase");
const { executeMarketSnapshot } = require("./services/snapshot");
const { processCapitalMovement } = require("./services/movements");
const { runHistoricalMigration } = require("./services/migration");
const { updateFundWallet } = require("./services/config");
const { createInvestor } = require("./services/investors");

/**
 * Verifica que el usuario esté autenticado y tenga rol 'admin'.
 * Lanza HttpsError('unauthenticated') si no está autenticado.
 * Lanza HttpsError('permission-denied') si no tiene rol admin.
 *
 * @param {object} request - El objeto request de una Cloud Function onCall.
 */
async function requireAdmin(request) {
    if (!request.auth) {
        throw new HttpsError('unauthenticated',
            'Debe estar autenticado para ejecutar esta función.');
    }

    const userDoc = await db.collection('users').doc(request.auth.uid).get();

    if (!userDoc.exists || userDoc.data().role !== 'admin') {
        throw new HttpsError('permission-denied',
            'Se requiere rol de administrador para ejecutar esta función.');
    }
}

/**
 * Cloud Function programada (Pub/Sub) encargada de recolectar un pantallazo 
 * instantáneo (snapshot) de forma recurrente cada 5 minutos.
 */
exports.marketSnapshotScheduled = onSchedule("every 5 minutes", async (event) => {
    try {
        const msg = await executeMarketSnapshot();
        console.log("Ejecución programada exitosa:", msg);
    } catch (error) {
        console.error("Error en la ejecución programada de market snapshot:", error);
    }
});

/**
 * Cloud Function callable para ejecutar manualmente un snapshot del mercado.
 * Requiere autenticación.
 */
exports.manualSnapshot = onCall(async (request) => {
    await requireAdmin(request);

    try {
        const msg = await executeMarketSnapshot();
        console.log("Ejecución manual exitosa:", msg);
        return { message: msg };
    } catch (error) {
        console.error("Error en la ejecución manual de market snapshot:", error);
        throw new HttpsError('internal', `Error interno: ${error.message}`);
    }
});

/**
 * Cloud Function callable para procesar depósitos o retiros (DEPOSIT o WITHDRAWAL).
 * Requiere autenticación.
 * Data esperada: { "investorId": "string", "type": "DEPOSIT" | "WITHDRAWAL", "amountUsd": number }
 */
exports.processMovement = onCall(async (request) => {
    await requireAdmin(request);

    const { investorId, type, amountUsd } = request.data;

    if (!investorId || !type || amountUsd === undefined) {
        throw new HttpsError('invalid-argument',
            'Faltan parámetros requeridos: investorId, type, amountUsd.');
    }

    try {
        const msg = await processCapitalMovement(investorId, type, amountUsd);
        return { message: msg };
    } catch (error) {
        console.error('Error procesando movimiento:', error);
        throw new HttpsError('internal', `Error interno: ${error.message}`);
    }
});

/**
 * Cloud Function callable para ejecutar la migración histórica inicial.
 * Requiere autenticación. Sólo debe ser llamada una vez.
 */
exports.migrateHistorical = onCall(async (request) => {
    await requireAdmin(request);

    try {
        const msg = await runHistoricalMigration();
        return { message: msg };
    } catch (error) {
        console.error(`Error en migración:`, error);
        throw new HttpsError('internal', `Error interno: ${error.message}`);
    }
});

/**
 * Cloud Function callable para actualizar la wallet del fondo.
 * Requiere autenticación.
 * Data esperada: { "walletAddress": "0x..." }
 */
exports.updateWallet = onCall(async (request) => {
    await requireAdmin(request);

    const { walletAddress } = request.data;

    try {
        const msg = await updateFundWallet(walletAddress);
        return { message: msg };
    } catch (error) {
        console.error('Error actualizando wallet:', error);
        throw new HttpsError('internal', `Error interno: ${error.message}`);
    }
});

/**
 * Cloud Function callable para crear un nuevo inversor.
 * Requiere autenticación.
 * Data esperada: { "name": "string", "lastName": "string" }
 */
exports.createInvestor = onCall(async (request) => {
    await requireAdmin(request);

    const { name, lastName } = request.data;

    if (!name || !lastName) {
        throw new HttpsError('invalid-argument',
            'Faltan parámetros requeridos: name, lastName.');
    }

    try {
        const msg = await createInvestor(name, lastName);
        return { message: msg };
    } catch (error) {
        console.error('Error creando inversor:', error);
        throw new HttpsError('internal', `Error interno: ${error.message}`);
    }
});
