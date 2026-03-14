/**
 * Constantes específicas del Bot de Liquidez Uniswap V3.
 * Direcciones de contratos, ABIs y parámetros de operación.
 */

// ==========================================
// DIRECCIONES DE CONTRATOS
// ==========================================
const VAULT_ADDRESS = "0x34De387EC8a65c7F784ed060bB7eC6422072426A";
const POOL_ADDRESS = "0x50eaEDB835021E4A108B7290636d62E9765cc6d7"; // WBTC/WETH 0.05% fee Polygon (verificado on-chain)
const NPM_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

// ==========================================
// PARÁMETROS DE OPERACIÓN (Pool 0.05% fee)
// ==========================================
const TICK_SPACING = 10;    // Para el pool de 0.05%
const GRID_WIDTH = 50;
const MAX_WIDTH_MULTIPLIER = 6; // Multiplicador máximo para el ancho dinámico (ej. 4 = hasta 4x GRID_WIDTH)
const COOLDOWN_MINUTES = 5; // Minutos de espera antes de permitir otro desarme destructivo

// ==========================================
// TOKENS (direcciones y decimales en Polygon)
// ==========================================
const WETH_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const WBTC_ADDRESS = "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6";
const WETH_DECIMALS = 18;
const WBTC_DECIMALS = 8;

// ==========================================
// ABIs MÍNIMOS (human-readable)
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

module.exports = {
    VAULT_ADDRESS,
    POOL_ADDRESS,
    NPM_ADDRESS,
    WETH_ADDRESS,
    WBTC_ADDRESS,
    WETH_DECIMALS,
    WBTC_DECIMALS,
    TICK_SPACING,
    GRID_WIDTH,
    MAX_WIDTH_MULTIPLIER,
    COOLDOWN_MINUTES,
    VAULT_ABI,
    POOL_ABI,
    NPM_ABI,
    ERC20_ABI
};
