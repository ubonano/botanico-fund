const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { executeMarketSnapshot } = require("./services/snapshot");

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

