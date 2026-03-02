const { db } = require('../config/firebase');

/**
 * Actualiza la wallet del fondo en Firestore.
 * Valida que sea una dirección Ethereum válida (0x + 40 caracteres hexadecimales)
 * y la almacena normalizada en minúsculas.
 *
 * @param {string} walletAddress - Dirección de la wallet (formato 0x...).
 * @returns {Promise<string>} Mensaje de confirmación.
 */
async function updateFundWallet(walletAddress) {
    if (!walletAddress) {
        throw new Error('Falta el parámetro requerido: walletAddress.');
    }

    const ethAddressRegex = /^0x[0-9a-fA-F]{40}$/;
    if (!ethAddressRegex.test(walletAddress)) {
        throw new Error('La dirección proporcionada no es una wallet válida. Debe ser una dirección Ethereum (0x + 40 caracteres hexadecimales).');
    }

    const normalized = walletAddress.toLowerCase();
    const configRef = db.collection("config").doc("fund");
    await configRef.set({ walletAddress: normalized }, { merge: true });

    return `Wallet actualizada correctamente: ${normalized}`;
}

module.exports = {
    updateFundWallet
};
