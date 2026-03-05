const { admin, db } = require('../config/firebase');

/**
 * Genera una contraseña numérica de 8 dígitos derivada del email.
 * Usa la suma de los char codes del email como semilla y aplica módulo 10^8.
 *
 * @param {string} email - Email del inversor.
 * @returns {string} Contraseña numérica de 8 dígitos.
 */
function generatePassword(email) {
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
        hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
    }
    const numeric = hash % 100000000;
    return numeric.toString().padStart(8, '0');
}

/**
 * Crea un nuevo inversor en el sistema.
 * 
 * 1. Genera un email a partir de la inicial del nombre + apellido + @botanico.fund.
 * 2. Genera una contraseña numérica de 8 dígitos derivada del email.
 * 3. Crea el usuario en Firebase Auth.
 * 4. Crea el documento del inversor en la colección `investors/{uid}`.
 * 5. Crea el documento del usuario en la colección `users/{uid}` con role "investor".
 *
 * @param {string} name - Nombre del inversor.
 * @param {string} lastName - Apellido del inversor.
 * @returns {Promise<string>} Mensaje de confirmación con el email y uid creado.
 */
async function createInvestor(name, lastName) {
    if (!name || !lastName) {
        throw new Error('Faltan parámetros requeridos: name y lastName.');
    }

    const initial = name.trim().charAt(0).toLowerCase();
    const last = lastName.trim().toLowerCase().replace(/\s+/g, '');
    const email = `${initial}${last}@botanico.fund`;

    const password = generatePassword(email);

    const userRecord = await admin.auth().createUser({
        email,
        password,
    });

    const uid = userRecord.uid;

    const batch = db.batch();

    const investorRef = db.collection('investors').doc(uid);
    batch.set(investorRef, {
        name: name.trim(),
        last_name: lastName.trim(),
        email,
        user_id: uid,
        current_shares: 0,
        net_investment_usd: 0,
        net_investment_wbtc: 0,
        net_investment_weth: 0,
        avg_purchase_nav_usd: 0,
        avg_purchase_nav_wbtc: 0,
        avg_purchase_nav_weth: 0,
        total_realized_pnl_usd: 0,
        total_realized_pnl_wbtc: 0,
        total_realized_pnl_weth: 0,
        commission_rate: 0,
    });

    const userRef = db.collection('users').doc(uid);
    batch.set(userRef, {
        email,
        password,
        role: 'investor',
    });

    await batch.commit();

    return `Inversor creado exitosamente: ${email} (uid: ${uid})`;
}

module.exports = {
    createInvestor
};
