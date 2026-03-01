const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { executeMarketSnapshot } = require("./services/snapshot");
const { processCapitalMovement } = require("./services/movements");
const { runHistoricalMigration } = require("./services/migration");

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
 * Cloud Function expuesta por HTTP para permitir la ejecución manual del snapshot.
 */
exports.marketSnapshotManual = onRequest(async (req, res) => {
    try {
        const msg = await executeMarketSnapshot();
        console.log("Ejecución manual exitosa:", msg);
        res.status(200).send(msg);
    } catch (error) {
        console.error("Error en la ejecución manual de market snapshot:", error);
        res.status(500).send(`Error interno: ${error.message}`);
    }
});

/**
 * Cloud Function callable para procesar depósitos o retiros (DEPOSIT o WITHDRAWAL).
 * Data esperada: { "investorId": "string", "type": "DEPOSIT" | "WITHDRAWAL", "amountUsd": number }
 */
exports.processMovement = onCall(async (request) => {
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
 * Cloud Function expuesta por HTTP para procesar la migración histórica inicial.
 * Sólo debe ser llamada una vez.
 */
exports.migrateHistorical = onRequest(async (req, res) => {
    try {
        const msg = await runHistoricalMigration();
        res.status(200).send(msg);
    } catch (error) {
        console.error(`Error en migracion:`, error);
        res.status(500).send(`Error interno: ${error.message}`);
    }
});
