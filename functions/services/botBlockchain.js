/**
 * Servicio de blockchain para el bot de liquidez.
 * Wraps ethers.js para interactuar con los contratos del vault y Uniswap V3.
 */

const { ethers } = require("ethers");
const { RPC_POLYGON } = require("../secret/keys");
const {
    VAULT_ADDRESS,
    POOL_ADDRESS,
    NPM_ADDRESS,
    VAULT_ABI,
    POOL_ABI,
    NPM_ABI,
    ERC20_ABI
} = require("../config/botConstants");

/**
 * Crea un provider JSON-RPC hacia Polygon.
 * @returns {ethers.JsonRpcProvider}
 */
function getProvider() {
    return new ethers.JsonRpcProvider(RPC_POLYGON);
}

/**
 * Crea un wallet signer conectado al provider.
 * @param {string} privateKey - Private key de la hot wallet.
 * @param {ethers.JsonRpcProvider} provider
 * @returns {ethers.Wallet}
 */
function getWallet(privateKey, provider) {
    return new ethers.Wallet(privateKey, provider);
}

/**
 * Instancia el contrato del Vault con capacidad de escritura (signer).
 * @param {ethers.Wallet} wallet
 * @returns {ethers.Contract}
 */
function getVaultContract(wallet) {
    return new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);
}

/**
 * Instancia el contrato del Pool de Uniswap V3 (solo lectura).
 * @param {ethers.Provider} provider
 * @returns {ethers.Contract}
 */
function getPoolContract(provider) {
    return new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);
}

/**
 * Instancia el contrato NonfungiblePositionManager (solo lectura).
 * @param {ethers.Provider} provider
 * @returns {ethers.Contract}
 */
function getNpmContract(provider) {
    return new ethers.Contract(NPM_ADDRESS, NPM_ABI, provider);
}

/**
 * Instancia un contrato ERC-20 genérico (solo lectura).
 * @param {string} address - Dirección del token ERC-20.
 * @param {ethers.Provider} provider
 * @returns {ethers.Contract}
 */
function getErc20Contract(address, provider) {
    return new ethers.Contract(address, ERC20_ABI, provider);
}

module.exports = {
    getProvider,
    getWallet,
    getVaultContract,
    getPoolContract,
    getNpmContract,
    getErc20Contract
};
