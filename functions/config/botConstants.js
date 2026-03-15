/**
 * Constantes específicas del Bot de Liquidez Uniswap V3.
 * 
 * - Constantes ESTÁTICAS: direcciones, ABIs, tick spacing (no cambian en runtime).
 * - Configuración DINÁMICA: se lee de Firestore (botanico_state/bot_config).
 *   Si el documento no existe, se crea con los valores por defecto.
 */

const { db } = require("./firebase");

// ==========================================
// DIRECCIONES DE CONTRATOS (estáticas)
// ==========================================
const VAULT_ADDRESS = "0x34De387EC8a65c7F784ed060bB7eC6422072426A";
const POOL_ADDRESS = "0x50eaEDB835021E4A108B7290636d62E9765cc6d7"; // WBTC/WETH 0.05% fee Polygon
const NPM_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

// ==========================================
// CONSTANTES FIJAS DEL POOL (estáticas)
// ==========================================
const TICK_SPACING = 10; // Fijo para pool 0.05% fee

// ==========================================
// TOKENS (estáticos)
// ==========================================
const WETH_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const WBTC_ADDRESS = "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6";
const WETH_DECIMALS = 18;
const WBTC_DECIMALS = 8;

// ==========================================
// ABIs MÍNIMOS (human-readable, estáticos)
// ==========================================
const VAULT_ABI = [
    "function activeTokenId() view returns (uint256)",
    "function closePosition(uint256 a0, uint256 a1, uint256 dl)",
    "function openPosition(int24 tL, int24 tU, uint256 a0, uint256 a1, uint256 dl)",
    "function increasePositionLiquidity(uint256 a0, uint256 a1, uint256 dl)",
    "function token0() view returns(address)",
    "function token1() view returns(address)"
];

const POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)"
];

const NPM_ABI = [
    "function positions(uint256) view returns (uint96, address, address, address, uint24, int24 tL, int24 tU, uint128, uint256, uint256, uint128, uint128)",
    "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)"
];

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)"
];

// ==========================================
// CONFIGURACIÓN DINÁMICA (defaults)
// Se lee de Firestore: botanico_state/bot_config
// ==========================================
const BOT_CONFIG_DEFAULTS = {
    enabled: true,                    // Bot encendido/apagado
    gridWidth: 50,                    // Ancho base del rango (GRID_WIDTH)
    maxWidthMultiplier: 6,            // Multiplicador máximo para ancho dinámico
    cooldownMinutes: 5,               // Minutos de cooldown entre rebalanceos
    tickHistorySize: 120,             // Ticks a conservar (120 × 2min = 4h)
    txWaitTimeoutMs: 45000,           // Timeout de confirmación de TX (ms)
    txDeadlineSeconds: 300,           // Deadline on-chain para TXs (s)
    slippageTolerance: 0.99,          // Tolerancia de slippage (0.99 = 1%)
    shrinkThreshold: 0.70,            // Umbral para achicar rango (70%)
    recenterMinTicks: 2,              // Mín. desplazamiento para recentrar (× TICK_SPACING)
    minInjectionAmount: 100000,       // Monto mínimo (raw) para inyectar capital ocioso
    minHistoryForVolatility: 5,       // Datapoints mínimos para calcular volatilidad
};

/**
 * Obtiene la configuración dinámica del bot desde Firestore.
 * Si el documento no existe, lo crea con los valores por defecto.
 * Cualquier campo faltante se completa con el default correspondiente.
 * 
 * @returns {Promise<object>} Configuración completa del bot.
 */
async function getBotConfig() {
    const configRef = db.collection('botanico_state').doc('bot_config');
    const configDoc = await configRef.get();

    if (!configDoc.exists) {
        // Primera ejecución: crear documento con defaults
        await configRef.set(BOT_CONFIG_DEFAULTS);
        console.log('[⚙️ CONFIG] Documento bot_config creado con valores por defecto.');
        return { ...BOT_CONFIG_DEFAULTS };
    }

    // Merge: defaults + lo que haya en Firestore (Firestore gana)
    const stored = configDoc.data();
    const merged = { ...BOT_CONFIG_DEFAULTS, ...stored };

    // Si faltan campos nuevos en Firestore, actualizarlos
    const missingKeys = Object.keys(BOT_CONFIG_DEFAULTS).filter(k => !(k in stored));
    if (missingKeys.length > 0) {
        const patch = {};
        missingKeys.forEach(k => { patch[k] = BOT_CONFIG_DEFAULTS[k]; });
        await configRef.set(patch, { merge: true });
        console.log(`[⚙️ CONFIG] Campos nuevos agregados a bot_config: ${missingKeys.join(', ')}`);
    }

    return merged;
}

module.exports = {
    // Estáticas
    VAULT_ADDRESS,
    POOL_ADDRESS,
    NPM_ADDRESS,
    WETH_ADDRESS,
    WBTC_ADDRESS,
    WETH_DECIMALS,
    WBTC_DECIMALS,
    TICK_SPACING,
    VAULT_ABI,
    POOL_ABI,
    NPM_ABI,
    ERC20_ABI,
    // Dinámicas
    BOT_CONFIG_DEFAULTS,
    getBotConfig
};
