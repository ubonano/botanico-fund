const normalizeAddress = (addr) => addr.toLowerCase();
const strip0x = (hex) => hex.replace(/^0x/i, '');
const pad32 = (hex) => hex.padStart(64, '0');
const encodeAddress = (addr) => pad32(strip0x(addr).toLowerCase());
const encodeUint256 = (num) => pad32(num.toString(16));

const getSqrtRatioAtTick = (tick) => Math.pow(1.0001, tick / 2);

const decodeInt24 = (hex) => {
    if (!hex) return 0;
    let val = parseInt(hex, 16);
    if (val & 0x800000) val -= 0x1000000;
    return val;
};

const decodeUint256 = (hex) => {
    if (!hex || hex === '0x') return 0n;
    return BigInt(hex.startsWith('0x') ? hex : '0x' + hex);
};

module.exports = {
    normalizeAddress,
    strip0x,
    pad32,
    encodeAddress,
    encodeUint256,
    getSqrtRatioAtTick,
    decodeInt24,
    decodeUint256
};
