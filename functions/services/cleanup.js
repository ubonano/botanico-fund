const { db } = require('../config/firebase');

/**
 * Agrupa documentos de snapshots por día y elimina los duplicados,
 * conservando solo el último snapshot de cada día.
 * 
 * Procesa tanto la colección principal 'snapshots' como las
 * subcolecciones 'snapshots' dentro de cada inversor.
 * 
 * @returns {Promise<string>} Resumen de la limpieza realizada.
 */
async function cleanupDuplicateSnapshots() {
    let totalDeleted = 0;

    // 1. Limpiar colección principal 'snapshots'
    const fundDeleted = await cleanupCollection(db.collection('snapshots'), 'snapshots');
    totalDeleted += fundDeleted;
    console.log(`[Cleanup] Colección 'snapshots': ${fundDeleted} documentos eliminados.`);

    // 2. Limpiar subcolecciones de cada inversor
    const investorsSnap = await db.collection('investors').get();
    console.log(`[Cleanup] Procesando ${investorsSnap.size} inversores...`);

    for (const invDoc of investorsSnap.docs) {
        const subCollection = invDoc.ref.collection('snapshots');
        const invDeleted = await cleanupCollection(subCollection, `investors/${invDoc.id}/snapshots`);
        totalDeleted += invDeleted;

        if (invDeleted > 0) {
            console.log(`[Cleanup] investors/${invDoc.id}/snapshots: ${invDeleted} documentos eliminados.`);
        }
    }

    const summary = `[Cleanup Complete] Total de documentos eliminados: ${totalDeleted}`;
    console.log(summary);
    return summary;
}

/**
 * Limpia una colección de snapshots eliminando duplicados por día.
 * Conserva solo el documento con el timestamp más reciente de cada día.
 * Usa batches de máximo 500 operaciones para respetar los límites de Firestore.
 * 
 * @param {FirebaseFirestore.CollectionReference} collectionRef - Referencia a la colección.
 * @param {string} collectionName - Nombre de la colección (para logging).
 * @returns {Promise<number>} Cantidad de documentos eliminados.
 */
async function cleanupCollection(collectionRef, collectionName) {
    const allDocs = await collectionRef.get();

    if (allDocs.empty) {
        return 0;
    }

    console.log(`[Cleanup] ${collectionName}: ${allDocs.size} documentos encontrados.`);

    // Agrupar documentos por día
    const docsByDay = {};

    allDocs.forEach(doc => {
        const data = doc.data();
        const timestamp = data.timestamp;

        if (!timestamp) {
            // Documentos sin timestamp no se pueden clasificar; se ignoran
            console.warn(`[Cleanup] ${collectionName}/${doc.id}: sin campo 'timestamp', ignorado.`);
            return;
        }

        // Convertir el timestamp de Firestore a Date
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD

        if (!docsByDay[dayKey]) {
            docsByDay[dayKey] = [];
        }

        docsByDay[dayKey].push({
            ref: doc.ref,
            id: doc.id,
            date: date,
        });
    });

    // Identificar documentos a eliminar (todos excepto el más reciente de cada día)
    const refsToDelete = [];

    for (const [dayKey, docs] of Object.entries(docsByDay)) {
        if (docs.length <= 1) {
            continue; // Solo hay uno, nada que limpiar
        }

        // Ordenar por fecha descendente (más reciente primero)
        docs.sort((a, b) => b.date.getTime() - a.date.getTime());

        // Conservar el primero (más reciente), marcar el resto para eliminar
        const toDelete = docs.slice(1);
        refsToDelete.push(...toDelete.map(d => d.ref));

        console.log(`[Cleanup] ${collectionName} día ${dayKey}: conservando 1, eliminando ${toDelete.length} de ${docs.length}.`);
    }

    if (refsToDelete.length === 0) {
        return 0;
    }

    // Eliminar en batches de 500 (límite de Firestore)
    const BATCH_SIZE = 500;
    let deleted = 0;

    for (let i = 0; i < refsToDelete.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = refsToDelete.slice(i, i + BATCH_SIZE);

        chunk.forEach(ref => batch.delete(ref));

        await batch.commit();
        deleted += chunk.length;
        console.log(`[Cleanup] ${collectionName}: batch eliminado ${deleted}/${refsToDelete.length}`);
    }

    return deleted;
}

module.exports = {
    cleanupDuplicateSnapshots,
};
