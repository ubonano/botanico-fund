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
const GRID_WIDTH = 60;      // 5 tick spacings para mayor estabilidad en rango
const COOLDOWN_MINUTES = 1; // Minutos de espera antes de permitir otro desarme destructivo

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
    "function slot0() view returns (uint160, int24 tick, uint16, uint16, uint16, uint8, bool)"
];

const NPM_ABI = [
    "function positions(uint256) view returns (uint96, address, address, address, uint24, int24 tL, int24 tU, uint128, uint256, uint256, uint128, uint128)"
];

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)"
];

module.exports = {
    VAULT_ADDRESS,
    POOL_ADDRESS,
    NPM_ADDRESS,
    TICK_SPACING,
    GRID_WIDTH,
    COOLDOWN_MINUTES,
    VAULT_ABI,
    POOL_ABI,
    NPM_ABI,
    ERC20_ABI
};
