const { RPC_POLYGON } = require('../secret/keys');
const { DEXSCREENER_API, TOKENS, Q96 } = require('../config/constants');
const {
    normalizeAddress,
    encodeAddress,
    encodeUint256,
    decodeInt24,
    decodeUint256,
    pad32,
    getSqrtRatioAtTick
} = require('../utils/helpers');

/**
 * Realiza una llamada JSON-RPC nativa hacia el nodo de la blockchain de Polygon configurado.
 * Atrapa y graba los errores por consola delegándolos al usuario como null en caso de fallo.
 * 
 * @param {string} method - Método JSON-RPC a ejecutar (Ej. 'eth_call').
 * @param {Array<any>} params - Parámetros requeridos por el método en orden de argumentos.
 * @returns {Promise<any|null>} Respuesta 'result' de JSON-RPC devuelta por el nodo, o null.
 */
async function rpcCall(method, params) {
    try {
        const res = await fetch(RPC_POLYGON, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
        });
        const data = await res.json();
        return data.result;
    } catch (err) {
        console.error(`RPC Error (${method}):`, err);
        return null;
    }
}

/**
 * Abstracción estandarizada para una llamada 'eth_call' de solo lectura a un Smart Contract.
 * Útil para consultar variables de estado publicas o funciones determinísticas 'view' y 'pure'.
 * 
 * @param {string} to - Dirección (address) del contrato de destino en formato hexadecimal.
 * @param {string} data - Payload de datos en formato ABI encoded (Function Selector + parameters).
 * @returns {Promise<string>} Dato retornado codificado en formato hexadecimal o null.
 */
async function ethCall(to, data) {
    return rpcCall('eth_call', [{ to, data }, 'latest']);
}

// --- BLOCKCHAIN READS ---

/**
 * Obtiene las cotizaciones más recientes de los pares objetivo definidos en la API utilizando Dexscreener.
 * Utilizado para valorar el portafolio en términos de fiat USD.
 * 
 * @returns {Promise<Object>} Un diccionario con los símbolos de los tokens como claves y el precio USD como valores. Identificador (ej. { WETH: 2500.5, WBTC: 59000.0 })
 */
async function getMarketPrices() {
    const res = await fetch(DEXSCREENER_API);
    const data = await res.json();
    const prices = {};
    data.pairs.forEach(p => { prices[p.baseToken.symbol] = parseFloat(p.priceUsd); });
    return prices;
}

/**
 * Consulta el balance de un token ERC-20 específico en la billetera de un usuario.
 * Se encarga automáticamente de convertir el valor descodificado BigInt considerando 
 * la precisión decimal del contrato para devolver un valor en denominación base humana.
 * 
 * @param {string} tokenAddress - Dirección del contrato ERC20 a consultar.
 * @param {string} walletAddress - Dirección de la billtera que es dueña del saldo.
 * @param {number} decimals - Cantidad de decimales manejados por el contrato inteligente (ej: 18 o 6).
 * @returns {Promise<number>} Número decimal representando la cantidad visible de tokens.
 */
async function getERC20Balance(tokenAddress, walletAddress, decimals) {
    const data = `0x70a08231${encodeAddress(walletAddress)}`;
    const result = await ethCall(tokenAddress, data);
    return Number(decodeUint256(result)) / (10 ** decimals);
}

/**
 * Obtiene el total consolidado de saldos estáticos en la billetera de un fondo/usuario.
 * En resumen, consulta simultáneamente los contratos de WETH, WBTC y USDT para optimizar red.
 * 
 * @param {string} walletAddress - Dirección que se evaluará (Ej. Billetera multisig central del fondo).
 * @returns {Promise<{weth: number, wbtc: number, usdt: number}>} Balances formatedos de WETH, WBTC y USDT.
 */
async function getWalletBalances(walletAddress) {
    const [weth, wbtc, usdt] = await Promise.all([
        getERC20Balance(TOKENS.WETH.address, walletAddress, TOKENS.WETH.decimals),
        getERC20Balance(TOKENS.WBTC.address, walletAddress, TOKENS.WBTC.decimals),
        getERC20Balance(TOKENS.USDT.address, walletAddress, TOKENS.USDT.decimals)
    ]);
    return { weth, wbtc, usdt };
}

/**
 * Resuelve y calcula la denominación base de los tokens bloqueados 
 * en una posición específica de liquidez concentrada en Uniswap V3.
 * Usa las fórmulas matemáticas subyacentes de UniV3 SDK adaptadas para Vanilla JS.
 * 
 * @param {number} tickLower - Tick menor activo de la posición.
 * @param {number} tickUpper - Tick mayor activo de la posición.
 * @param {BigInt|string|number} liquidity - Liquidez real codificada de la posición activa.
 * @param {number} sqrtP - Cuadrante Raíz de proporción del Tick actual de la Pool global a la que pertenece la posición.
 * @returns {Promise<{amount0: number, amount1: number}>} Valores brutos sin formato decimal para Token0 y Token1.
 */
async function getUniswapV3Amounts(tickLower, tickUpper, liquidity, sqrtP) {
    const sqrtL = getSqrtRatioAtTick(tickLower);
    const sqrtU = getSqrtRatioAtTick(tickUpper);
    const liqNum = Number(liquidity);

    let amount0 = 0, amount1 = 0;
    if (sqrtP <= sqrtL) {
        amount0 = liqNum * (sqrtU - sqrtL) / (sqrtL * sqrtU);
    } else if (sqrtP < sqrtU) {
        amount0 = liqNum * (sqrtU - sqrtP) / (sqrtP * sqrtU);
        amount1 = liqNum * (sqrtP - sqrtL);
    } else {
        amount1 = liqNum * (sqrtU - sqrtL);
    }
    return { amount0, amount1 };
}

/**
 * Explora y consolida los balances invertidos en todas las posiciones LP activas
 * de una billetera sobre Uniswap v3 mediante el contrato NonfungiblePositionManager.
 * Itera a lo largo del total de NFTs poseidos, extrayendo las métricas del pool y aplicando
 * las formulas matemáticas de cálculo de denominación base según la liquidez.
 * 
 * @param {string} walletAddress - Dirección de la billetera proveedora de la liquidez.
 * @returns {Promise<{poolWeth: number, poolWbtc: number}>} Tokens WETH y WBTC formatedos invertidos en las pools de riesgo.
 */
async function getPoolBalances(walletAddress) {
    let poolWeth = 0;
    let poolWbtc = 0;

    const nftCountHex = await ethCall(TOKENS.POS_MANAGER, `0x70a08231${encodeAddress(walletAddress)}`);
    const nftCount = parseInt(nftCountHex, 16) || 0;

    for (let i = 0; i < nftCount; i++) {
        const tokenIdHex = await ethCall(TOKENS.POS_MANAGER, `0x2f745c59${encodeAddress(walletAddress)}${encodeUint256(i)}`);
        const tokenId = decodeUint256(tokenIdHex);

        const poolRes = await ethCall(TOKENS.POS_MANAGER, `0x99fbab88${encodeUint256(tokenId)}`);
        if (!poolRes || poolRes === '0x') continue;

        const token0 = '0x' + poolRes.slice(154, 194).toLowerCase();
        const token1 = '0x' + poolRes.slice(218, 258).toLowerCase();
        const feeHex = poolRes.slice(258, 322).slice(-6);
        const tickLower = decodeInt24(poolRes.slice(322, 386).slice(-6));
        const tickUpper = decodeInt24(poolRes.slice(386, 450).slice(-6));
        const liquidity = decodeUint256(poolRes.slice(450, 514));

        if (liquidity === 0n) continue;

        const poolAddrRes = await ethCall(TOKENS.FACTORY, `0x1698ee82${encodeAddress(token0)}${encodeAddress(token1)}${pad32(feeHex)}`);
        const poolAddr = '0x' + poolAddrRes.slice(-40);

        const slot0 = await ethCall(poolAddr, '0x3850c7bd');
        const sqrtP = Number(decodeUint256(slot0.slice(2, 66))) / Number(Q96);

        const { amount0, amount1 } = await getUniswapV3Amounts(tickLower, tickUpper, liquidity, sqrtP);

        const formatWeth = (amount) => amount / (10 ** TOKENS.WETH.decimals);
        const formatWbtc = (amount) => amount / (10 ** TOKENS.WBTC.decimals);

        if (token0 === normalizeAddress(TOKENS.WETH.address)) poolWeth += formatWeth(amount0);
        else if (token1 === normalizeAddress(TOKENS.WETH.address)) poolWeth += formatWeth(amount1);

        if (token0 === normalizeAddress(TOKENS.WBTC.address)) poolWbtc += formatWbtc(amount0);
        else if (token1 === normalizeAddress(TOKENS.WBTC.address)) poolWbtc += formatWbtc(amount1);
    }

    return { poolWeth, poolWbtc };
}

module.exports = {
    getMarketPrices,
    getWalletBalances,
    getPoolBalances
};
