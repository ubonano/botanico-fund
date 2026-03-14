/**
 * Bot de Liquidez Botanico-Fund.
 * Gestiona posiciones de liquidez concentrada en Uniswap V3 (Polygon).
 * 
 * Lógica de negocio:
 * - FASE 1: Evaluación unificada de capital (invertido + ocioso)
 * - FASE 2: Apertura de posición (usa rango precalculado o calcula nuevo)
 */

const { db } = require("../config/firebase");
const {
    VAULT_ADDRESS,
    TICK_SPACING,
    GRID_WIDTH,
    MAX_WIDTH_MULTIPLIER,
    COOLDOWN_MINUTES
} = require("../config/botConstants");
const {
    getProvider,
    getWallet,
    getVaultContract,
    getPoolContract,
    getNpmContract,
    getErc20Contract
} = require("./botBlockchain");

// Timeout máximo para esperar confirmación de una TX (en ms)
const TX_WAIT_TIMEOUT = 45000; // 45 segundos

// ==========================================
// UTILIDADES
// ==========================================

/**
 * Espera la confirmación de una TX con timeout.
 * Si el timeout se alcanza, loguea advertencia pero no bloquea el ciclo.
 * 
 * @param {object} tx - Transacción enviada (ethers TransactionResponse).
 * @param {string} label - Etiqueta para el log.
 * @param {Function} elapsed - Función que retorna el tiempo transcurrido.
 * @returns {Promise<object|null>} Receipt de la TX o null si timeout.
 */
async function waitForTx(tx, label, elapsed) {
    return Promise.race([
        tx.wait(1).then(receipt => {
            console.log(`[⏱️ ${elapsed()}] ✅ ${label} confirmada. TX: ${tx.hash}`);
            return receipt;
        }),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`TIMEOUT esperando ${label}`)), TX_WAIT_TIMEOUT)
        )
    ]).catch(err => {
        console.warn(`[⏱️ ${elapsed()}] ⚠️ ${err.message}. TX: ${tx.hash}. La TX fue enviada pero no se confirmó a tiempo.`);
        return null;
    });
}

// ==========================================
// FUNCIÓN PRINCIPAL DEL CICLO DEL BOT
// ==========================================

/**
 * Ejecuta un ciclo completo de vigilancia y gestión de liquidez.
 * 
 * @param {string} hotWalletPrivateKey - Clave privada de la hot wallet (desde Firebase Secrets).
 */
async function executeBotCycle(hotWalletPrivateKey) {
    const cycleStart = Date.now();
    const elapsed = () => `${((Date.now() - cycleStart) / 1000).toFixed(1)}s`;

    const provider = getProvider();
    const wallet = getWallet(hotWalletPrivateKey, provider);
    const vault = getVaultContract(wallet);
    const pool = getPoolContract(provider);
    const npm = getNpmContract(provider);

    try {
        console.log(`[⏱️ ${elapsed()}] Iniciando ciclo...`);

        // Obtener fee data de la red para asegurar gas suficiente
        const feeData = await provider.getFeeData();
        const gasOverrides = {};
        if (feeData.maxFeePerGas) {
            gasOverrides.maxFeePerGas = feeData.maxFeePerGas * 120n / 100n;
            gasOverrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas * 150n / 100n;
        }

        // Gestión explícita de nonce para evitar cola de TXs atascadas
        const confirmedNonce = await provider.getTransactionCount(wallet.address, "latest");
        const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");
        gasOverrides.nonce = confirmedNonce; // Forzar nonce al último confirmado → reemplaza TXs stuck

        if (pendingNonce > confirmedNonce) {
            console.warn(`[⏱️ ${elapsed()}] ⚠️ NONCE JAM detectado: confirmed=${confirmedNonce}, pending=${pendingNonce}. Hay ${pendingNonce - confirmedNonce} TX(s) atascada(s). Reemplazando...`);
        }
        console.log(`[⏱️ ${elapsed()}] Gas: maxFee=${gasOverrides.maxFeePerGas} | priority=${gasOverrides.maxPriorityFeePerGas} | nonce=${confirmedNonce}`);

        const slot0 = await pool.slot0();
        const currentTick = Number(slot0.tick);
        let activeTokenId = await vault.activeTokenId();
        const deadline = Math.floor(Date.now() / 1000) + 300;

        console.log(`[⏱️ ${elapsed()}] Tick: ${currentTick} | TokenId: ${activeTokenId}`);

        // ---------------------------------------------------------
        // MÓDULO DE MEMORIA: tickHistory (volatilidad reciente)
        // ---------------------------------------------------------
        const volRef = db.collection('botanico_state').doc('volatility');
        const volDoc = await volRef.get();
        let tickHistory = volDoc.exists ? (volDoc.data()?.tickHistory || []) : [];
        tickHistory.push(currentTick);
        while (tickHistory.length > 30) tickHistory.shift();
        // Escritura no bloqueante (sin await)
        volRef.set({ tickHistory }, { merge: true });

        // ---------------------------------------------------------
        // CÁLCULO DE ANCHO DINÁMICO
        // ---------------------------------------------------------
        const { finalWidth: dynamicWidth, tickRange, multiplier } = calculateDynamicWidth(tickHistory, GRID_WIDTH, TICK_SPACING);
        console.log(`[📊 Volatilidad] Rango 1h: ${tickRange} ticks | Multiplicador: ${multiplier.toFixed(2)}x | Ancho Dinámico: ${dynamicWidth}`);

        // ---------------------------------------------------------
        // LECTURA DE MEMORIA (ESTADO DE COOLDOWN)
        // ---------------------------------------------------------
        const stateRef = db.collection('botanico_state').doc('cooldown');
        const stateDoc = await stateRef.get();
        let lastRebalanceTime = 0;

        if (stateDoc.exists) {
            lastRebalanceTime = stateDoc.data()?.lastRebalanceTime || 0;
        }

        let shouldUpdateCooldown = false;
        let precalculatedRange = null;

        // ---------------------------------------------------------
        // FASE 1: EVALUACIÓN UNIFICADA DE CAPITAL
        // ---------------------------------------------------------
        if (activeTokenId !== 0n) {
            const pos = await npm.positions(activeTokenId);
            const tL = Number(pos.tL);
            const tU = Number(pos.tU);
            const isOutOfRange = (currentTick < tL || currentTick >= tU);

            console.log(`[⏱️ ${elapsed()}] Posición: [${tL}, ${tU}] | ${isOutOfRange ? 'FUERA DE RANGO' : 'EN RANGO'}`);

            // Leer balances ociosos del vault
            const token0 = getErc20Contract(await vault.token0(), provider);
            const token1 = getErc20Contract(await vault.token1(), provider);
            const bal0 = Number(await token0.balanceOf(VAULT_ADDRESS));
            const bal1 = Number(await token1.balanceOf(VAULT_ADDRESS));

            console.log(`[⏱️ ${elapsed()}] Ocioso: bal0=${bal0} | bal1=${bal1}`);

            // Calcular capital invertido en la posición actual
            const liquidity = Number(pos[7]);
            const posAmounts = getPositionAmounts(currentTick, tL, tU, liquidity);

            // Capital total = invertido + ocioso
            const totalBal0 = posAmounts.amount0 + bal0;
            const totalBal1 = posAmounts.amount1 + bal1;

            console.log(`[⏱️ ${elapsed()}] Capital total: bal0=${totalBal0.toFixed(0)} | bal1=${totalBal1.toFixed(0)} | Liq: ${liquidity}`);

            // ¿Qué rango sería óptimo con TODO el capital?
            const optimal = findOptimalRangeAndAmounts(currentTick, totalBal0, totalBal1, TICK_SPACING, dynamicWidth);
            let rangeChanged = (optimal.tickLower !== tL || optimal.tickUpper !== tU);

            // --- FILTRO DE TOLERANCIA (HISTÉRESIS) ---
            if (rangeChanged && !isOutOfRange) {
                const currentWidth = tU - tL;
                const proposedWidth = optimal.tickUpper - optimal.tickLower;

                // CASO A: La volatilidad baja y propone achicar el rango
                if (proposedWidth < currentWidth) {
                    // Solo aceptamos achicar si el nuevo rango es significativamente menor (al menos 30% más chico)
                    const isSignificantShrink = proposedWidth <= (currentWidth * 0.70);

                    if (!isSignificantShrink) {
                        console.log(`[🛡️ TOLERANCIA] Contracción menor (Actual: ${currentWidth} -> Propuesto: ${proposedWidth}). Ignorando para ahorrar gas.`);
                        rangeChanged = false;
                    }
                }
                // CASO B: El ancho es el mismo o similar, pero propone un recentrado
                else if (proposedWidth === currentWidth || proposedWidth > currentWidth) {
                    const shiftDistance = Math.abs(optimal.tickLower - tL);
                    // Solo aceptamos recentrar si el movimiento es mayor a 2 veces el TICK_SPACING (evita micro-ajustes)
                    if (shiftDistance <= (TICK_SPACING * 2)) {
                        console.log(`[🎯 TOLERANCIA] Micro-centrado de ${shiftDistance} ticks. Ignorando para ahorrar gas.`);
                        rangeChanged = false;
                    }
                }
            }
            // ------------------------------------------------

            console.log(`[⏱️ ${elapsed()}] Rango óptimo: [${optimal.tickLower}, ${optimal.tickUpper}] | Cambió: ${rangeChanged}`);

            if (!rangeChanged) {
                if (isOutOfRange) {
                    console.log(`[⏭️ REBALANCEO OMITIDO] Fuera de rango, pero [${tL}, ${tU}] sigue siendo el rango óptimo. Ahorrando gas.`);
                    return null;
                } else {
                    if (bal0 > 0 || bal1 > 0) {
                        const inj = calculateInjection(currentTick, tL, tU, bal0, bal1);
                        if (inj.exp0 > 100000 || inj.exp1 > 100000) {
                            console.log(`[⏱️ ${elapsed()}] Inyectando capital ocioso...`);
                            const minAmt0Inj = BigInt(Math.floor(inj.exp0 * 0.99));
                            const minAmt1Inj = BigInt(Math.floor(inj.exp1 * 0.99));
                            const txInj = await vault.increasePositionLiquidity(minAmt0Inj, minAmt1Inj, deadline, gasOverrides);
                            console.log(`[⏱️ ${elapsed()}] TX Inyección enviada: ${txInj.hash}`);
                            await waitForTx(txInj, 'Inyección', elapsed);
                        }
                    }
                    return null;
                }
            } else {
                // Cooldown se evalúa SIEMPRE antes de closePosition (parche de seguridad)
                const currentTime = Date.now();
                const minutesPassed = (currentTime - lastRebalanceTime) / (1000 * 60);

                if (minutesPassed < COOLDOWN_MINUTES) {
                    console.log(`[🛡️ COOLDOWN ACTIVO] ${minutesPassed.toFixed(1)}/${COOLDOWN_MINUTES} min. Rango óptimo: [${optimal.tickLower}, ${optimal.tickUpper}]. ${isOutOfRange ? 'Fuera de rango.' : 'En rango.'}`);
                    return null;
                }

                precalculatedRange = optimal;

                console.log(`[⏱️ ${elapsed()}] [🔄 REARMADO] [${tL}, ${tU}] → [${optimal.tickLower}, ${optimal.tickUpper}]. ${isOutOfRange ? 'Fuera de rango.' : 'Optimización.'}`);
                console.log(`[⏱️ ${elapsed()}] Enviando closePosition...`);
                const closedAmounts = getPositionAmounts(currentTick, tL, tU, liquidity);
                const minAmt0Close = BigInt(Math.floor(closedAmounts.amount0 * 0.99));
                const minAmt1Close = BigInt(Math.floor(closedAmounts.amount1 * 0.99));
                const txClose = await vault.closePosition(minAmt0Close, minAmt1Close, deadline, gasOverrides);
                console.log(`[⏱️ ${elapsed()}] TX Close enviada: ${txClose.hash}`);
                const closeReceipt = await waitForTx(txClose, 'Close', elapsed);

                if (!closeReceipt) {
                    console.error(`[⏱️ ${elapsed()}] ❌ Close no confirmado. Abortando ciclo para evitar estado inconsistente.`);
                    return null;
                }

                activeTokenId = 0n;
                shouldUpdateCooldown = true;
                gasOverrides.nonce = confirmedNonce + 1; // Incrementar para la TX de apertura
            }
        }

        // ---------------------------------------------------------
        // FASE 2: APERTURA DE POSICIÓN
        // ---------------------------------------------------------
        if (activeTokenId === 0n) {
            console.log(`[⏱️ ${elapsed()}] Fase 2: Leyendo balances...`);
            const token0 = getErc20Contract(await vault.token0(), provider);
            const token1 = getErc20Contract(await vault.token1(), provider);
            const bal0 = await token0.balanceOf(VAULT_ADDRESS);
            const bal1 = await token1.balanceOf(VAULT_ADDRESS);

            console.log(`[⏱️ ${elapsed()}] Balances: bal0=${bal0} | bal1=${bal1}`);

            if (bal0 === 0n && bal1 === 0n) return null;

            const optimal = precalculatedRange || findOptimalRangeAndAmounts(currentTick, Number(bal0), Number(bal1), TICK_SPACING, dynamicWidth);

            console.log(`[⏱️ ${elapsed()}] ${precalculatedRange ? '[📐 Precalculado]' : '[📐 Calculado]'} Abriendo [${optimal.tickLower}, ${optimal.tickUpper}]...`);
            const minAmt0Open = BigInt(Math.floor(optimal.expectedAmount0 * 0.99));
            const minAmt1Open = BigInt(Math.floor(optimal.expectedAmount1 * 0.99));
            const txOpen = await vault.openPosition(optimal.tickLower, optimal.tickUpper, minAmt0Open, minAmt1Open, deadline, gasOverrides);
            console.log(`[⏱️ ${elapsed()}] TX Open enviada: ${txOpen.hash}`);
            const openReceipt = await waitForTx(txOpen, 'Open', elapsed);

            if (!openReceipt) {
                console.error(`[⏱️ ${elapsed()}] ❌ Open no confirmado. El próximo ciclo verificará el estado.`);
            }

            shouldUpdateCooldown = true;
        }

        // ---------------------------------------------------------
        // ACTUALIZAR MEMORIA SI HUBO MOVIMIENTO MAYOR
        // ---------------------------------------------------------
        if (shouldUpdateCooldown) {
            await stateRef.set({ lastRebalanceTime: Date.now() }, { merge: true });
            console.log(`[⏱️ ${elapsed()}] ⏱️ Cooldown reiniciado.`);
        }

        console.log(`[⏱️ ${elapsed()}] Ciclo completado.`);

    } catch (error) {
        console.error(`[⏱️ ${elapsed()}] Error BotanicoBot:`, error);
    }

    return null;
}

// ==========================================
// FUNCIONES MATEMÁTICAS (LÓGICA PURA)
// ==========================================

/**
 * Calcula los montos de token0 y token1 invertidos en una posición NFT activa.
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

/**
 * Calcula cuánto del saldo ocioso encaja en el NFT ya abierto.
 */
function calculateInjection(currentTick, tL, tU, bal0, bal1) {
    const sqrt_c = Math.sqrt(Math.pow(1.0001, currentTick));
    const sqrt_l = Math.sqrt(Math.pow(1.0001, tL));
    const sqrt_u = Math.sqrt(Math.pow(1.0001, tU));

    let amt0_per_L = 0, amt1_per_L = 0;

    if (currentTick <= tL) {
        amt0_per_L = (sqrt_u - sqrt_l) / (sqrt_l * sqrt_u);
    } else if (currentTick >= tU) {
        amt1_per_L = sqrt_u - sqrt_l;
    } else {
        amt0_per_L = (sqrt_u - sqrt_c) / (sqrt_c * sqrt_u);
        amt1_per_L = sqrt_c - sqrt_l;
    }

    let L0 = amt0_per_L > 0 ? bal0 / amt0_per_L : Infinity;
    let L1 = amt1_per_L > 0 ? bal1 / amt1_per_L : Infinity;
    let L = Math.min(L0, L1);

    if (L === Infinity) L = 0;

    return { exp0: L * amt0_per_L, exp1: L * amt1_per_L };
}

/**
 * Encuentra el rango óptimo maximizando CAPITAL DESPLEGADO y proximidad.
 */
function findOptimalRangeAndAmounts(currentTick, bal0, bal1, tickSpacing, width) {
    if (bal1 < 1000) {
        let lower = Math.ceil(currentTick / tickSpacing) * tickSpacing;
        if (lower <= currentTick) lower += tickSpacing;
        return { tickLower: lower, tickUpper: lower + width, expectedAmount0: bal0, expectedAmount1: 0 };
    }

    if (bal0 < 1000) {
        let upper = Math.floor(currentTick / tickSpacing) * tickSpacing;
        if (upper >= currentTick) upper -= tickSpacing;
        return { tickLower: upper - width, tickUpper: upper, expectedAmount0: 0, expectedAmount1: bal1 };
    }

    const price = Math.pow(1.0001, currentTick);
    const sqrt_c = Math.sqrt(Math.pow(1.0001, currentTick));
    const startLower = Math.floor((currentTick - width) / tickSpacing) * tickSpacing - (tickSpacing * 2);
    const endLower = Math.ceil(currentTick / tickSpacing) * tickSpacing + (tickSpacing * 2);

    let bestLower = 0;
    let maxValue = -1;
    let bestDistance = Infinity;
    let finalAmt0 = 0, finalAmt1 = 0;

    for (let lower = startLower; lower <= endLower; lower += tickSpacing) {
        const upper = lower + width;
        const sqrt_l = Math.sqrt(Math.pow(1.0001, lower));
        const sqrt_u = Math.sqrt(Math.pow(1.0001, upper));
        let amt0_per_L = 0, amt1_per_L = 0;

        if (currentTick <= lower) {
            amt0_per_L = (sqrt_u - sqrt_l) / (sqrt_l * sqrt_u);
        } else if (currentTick >= upper) {
            amt1_per_L = sqrt_u - sqrt_l;
        } else {
            amt0_per_L = (sqrt_u - sqrt_c) / (sqrt_c * sqrt_u);
            amt1_per_L = sqrt_c - sqrt_l;
        }

        let L0 = amt0_per_L > 0 ? bal0 / amt0_per_L : Infinity;
        let L1 = amt1_per_L > 0 ? bal1 / amt1_per_L : Infinity;
        let possibleL = Math.min(L0, L1);
        if (possibleL === Infinity || possibleL <= 0) continue;

        const exp0 = amt0_per_L * possibleL;
        const exp1 = amt1_per_L * possibleL;

        const totalValue = exp0 * price + exp1;

        const rangeCenter = lower + width / 2;
        const distance = Math.abs(currentTick - rangeCenter);

        const isBetterValue = totalValue > maxValue * 1.001;
        const isSimilarValue = totalValue >= maxValue * 0.999;
        const isCloser = distance < bestDistance;

        if (isBetterValue || (isSimilarValue && isCloser)) {
            maxValue = totalValue;
            bestLower = lower;
            bestDistance = distance;
            finalAmt0 = exp0;
            finalAmt1 = exp1;
        }
    }

    return { tickLower: bestLower, tickUpper: bestLower + width, expectedAmount0: finalAmt0, expectedAmount1: finalAmt1 };
}

/**
 * Calcula el ancho dinámico del rango basado en la volatilidad histórica.
 * @param {number[]} tickHistory - Historial de ticks recientes (máx 30).
 * @param {number} baseWidth - Ancho base (GRID_WIDTH).
 * @param {number} tickSpacing - Tick spacing del pool.
 * @returns {{ finalWidth: number, tickRange: number, multiplier: number }}
 */
function calculateDynamicWidth(tickHistory, baseWidth, tickSpacing) {
    if (tickHistory.length < 5) {
        return { finalWidth: baseWidth, tickRange: 0, multiplier: 1.0 };
    }

    const maxTick = Math.max(...tickHistory);
    const minTick = Math.min(...tickHistory);
    const tickRange = maxTick - minTick;

    let multiplier = 1.0;
    if (tickRange > baseWidth) {
        multiplier = Math.min(tickRange / baseWidth, MAX_WIDTH_MULTIPLIER);
    }

    const targetWidth = baseWidth * multiplier;
    let finalWidth = Math.ceil(targetWidth / tickSpacing) * tickSpacing;
    if (finalWidth < baseWidth) finalWidth = baseWidth;

    return { finalWidth, tickRange, multiplier };
}

module.exports = {
    executeBotCycle,
    calculateDynamicWidth
};
