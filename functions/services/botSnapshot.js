/**
 * Servicio de Snapshot del Bot de Liquidez.
 * Lee el estado completo del capital del bot desglosado en 3 componentes:
 *   - idle:  Balance líquido (tokens ociosos en el vault)
 *   - fees:  Comisiones pendientes (uncollected fees del NFT)
 *   - pool:  Liquidez activa en el pool (calculada con fórmulas V3)
 *
 * Calcula PnL bimonetario: rentabilidad neta valorizada en WETH y en WBTC.
 */

const { ethers } = require("ethers");
const { RPC_POLYGON } = require("../secret/keys");
const {
    VAULT_ADDRESS,
    POOL_ADDRESS,
    NPM_ADDRESS,
    WETH_ADDRESS,
    WBTC_ADDRESS,
    WETH_DECIMALS,
    WBTC_DECIMALS,
    VAULT_ABI,
    POOL_ABI,
    NPM_ABI,
    ERC20_ABI
} = require("../config/botConstants");

/**
 * Lee el snapshot completo del bot con las 3 cajas desglosadas.
 *
 * @returns {Promise<Object>} Objeto con idle, fees, pool, totales, precio del par y metadata.
 */
async function getBotSnapshotData() {
    const provider = new ethers.JsonRpcProvider(RPC_POLYGON);

    const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);
    const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);
    const npm = new ethers.Contract(NPM_ADDRESS, NPM_ABI, provider);
    const wethToken = new ethers.Contract(WETH_ADDRESS, ERC20_ABI, provider);
    const wbtcToken = new ethers.Contract(WBTC_ADDRESS, ERC20_ABI, provider);

    // -------------------------------------------------------
    // Caja A: Balance Líquido (tokens ociosos en el vault)
    // -------------------------------------------------------
    const [wethBalRaw, wbtcBalRaw] = await Promise.all([
        wethToken.balanceOf(VAULT_ADDRESS),
        wbtcToken.balanceOf(VAULT_ADDRESS)
    ]);

    const idleWeth = Number(wethBalRaw) / (10 ** WETH_DECIMALS);
    const idleWbtc = Number(wbtcBalRaw) / (10 ** WBTC_DECIMALS);

    // -------------------------------------------------------
    // Leer estado del pool y posición activa
    // -------------------------------------------------------
    const [slot0, activeTokenId] = await Promise.all([
        pool.slot0(),
        vault.activeTokenId()
    ]);

    const sqrtPriceX96 = slot0.sqrtPriceX96;
    const currentTick = Number(slot0.tick);

    // Precio WBTC/WETH derivado del sqrtPriceX96
    // En este pool: token0 = WBTC, token1 = WETH
    // price = (sqrtPriceX96 / 2^96)^2 da el precio de token0 en términos de token1
    // Ajustado por decimales: price_wbtc_in_weth = price_raw * (10^WBTC_DECIMALS) / (10^WETH_DECIMALS)
    // Nota: el token con menor dirección es token0. WBTC < WETH en Polygon.
    const sqrtPriceNum = Number(sqrtPriceX96);
    const Q96 = Number(2n ** 96n);
    const priceRaw = (sqrtPriceNum / Q96) ** 2;
    const poolPriceWbtcInWeth = priceRaw * (10 ** WBTC_DECIMALS) / (10 ** WETH_DECIMALS);

    // -------------------------------------------------------
    // Caja B: Comisiones Pendientes (uncollected fees)
    // Caja C: Liquidez Activa en el Pool
    // -------------------------------------------------------
    let feesWeth = 0;
    let feesWbtc = 0;
    let poolWeth = 0;
    let poolWbtc = 0;

    if (activeTokenId !== 0n) {
        // Caja B: staticCall a collect() para leer fees sin gastar gas
        const MAX_UINT128 = 2n ** 128n - 1n;
        try {
            const feesResult = await npm.collect.staticCall({
                tokenId: activeTokenId,
                recipient: VAULT_ADDRESS,
                amount0Max: MAX_UINT128,
                amount1Max: MAX_UINT128
            });

            // token0 = WBTC, token1 = WETH en este pool
            feesWbtc = Number(feesResult.amount0) / (10 ** WBTC_DECIMALS);
            feesWeth = Number(feesResult.amount1) / (10 ** WETH_DECIMALS);
        } catch (err) {
            console.warn("[Bot Snapshot] Error leyendo fees pendientes:", err.message);
        }

        // Caja C: Calcular liquidez activa con la matemática de V3
        try {
            const pos = await npm.positions(activeTokenId);
            const tL = Number(pos.tL);
            const tU = Number(pos.tU);
            const liquidity = Number(pos[7]); // uint128 liquidity

            const amounts = getPositionAmounts(currentTick, tL, tU, liquidity);

            // token0 = WBTC, token1 = WETH
            poolWbtc = amounts.amount0 / (10 ** WBTC_DECIMALS);
            poolWeth = amounts.amount1 / (10 ** WETH_DECIMALS);
        } catch (err) {
            console.warn("[Bot Snapshot] Error calculando liquidez activa:", err.message);
        }
    }

    // -------------------------------------------------------
    // Totales
    // -------------------------------------------------------
    const totalWeth = idleWeth + feesWeth + poolWeth;
    const totalWbtc = idleWbtc + feesWbtc + poolWbtc;

    return {
        idle: { weth: idleWeth, wbtc: idleWbtc },
        fees: { weth: feesWeth, wbtc: feesWbtc },
        pool: { weth: poolWeth, wbtc: poolWbtc },
        totalWeth,
        totalWbtc,
        poolPriceWbtcInWeth,
        hasActivePosition: activeTokenId !== 0n
    };
}

// ==========================================
// FUNCIÓN MATEMÁTICA V3 (idéntica a botLiquidity.js)
// ==========================================

/**
 * Calcula los montos de token0 y token1 reales en una posición LP.
 * Retorna valores en unidades RAW (sin dividir por decimales).
 *
 * @param {number} currentTick - Tick actual del pool.
 * @param {number} tL - Tick lower de la posición.
 * @param {number} tU - Tick upper de la posición.
 * @param {number} liquidity - Liquidez de la posición.
 * @returns {{amount0: number, amount1: number}} Montos raw de token0 y token1.
 */
function getPositionAmounts(currentTick, tL, tU, liquidity) {
    const sqrt_c = Math.sqrt(Math.pow(1.0001, currentTick));
    const sqrt_l = Math.sqrt(Math.pow(1.0001, tL));
    const sqrt_u = Math.sqrt(Math.pow(1.0001, tU));

    let amount0 = 0, amount1 = 0;

    if (currentTick <= tL) {
        amount0 = liquidity * (sqrt_u - sqrt_l) / (sqrt_l * sqrt_u);
    } else if (currentTick >= tU) {
        amount1 = liquidity * (sqrt_u - sqrt_l);
    } else {
        amount0 = liquidity * (sqrt_u - sqrt_c) / (sqrt_c * sqrt_u);
        amount1 = liquidity * (sqrt_c - sqrt_l);
    }

    return { amount0, amount1 };
}

module.exports = {
    getBotSnapshotData
};
