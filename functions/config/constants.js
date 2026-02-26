const POOLS = {
    WETH_USDT: '0xbb98b3d2b18aef63a3178023a920971cf5f29be4', // Fee 0.05%
    WBTC_USDT: '0xa1cfb393607d1a6888d273b762832ed14c8b56b1'  // Fee 0.3%
};

const TOKENS = {
    WETH: { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
    WBTC: { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8 },
    USDT: { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
    POS_MANAGER: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    FACTORY: '0x1F98431c8aD98523631AE4a59f267346ea31F984'
};

const Q96 = BigInt(2) ** BigInt(96);

module.exports = {
    POOLS,
    TOKENS,
    Q96
};
