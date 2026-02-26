const { db } = require("../config/firebase");

// Data provista en el prompt
const csvData = [
    { fecha: "8/2/2026 1:28:22", inversor: "Uriel", tipo: "DEPOSITO", montoUsd: "$16.502,21", nav: "$1,00", shares: "16.502,21", pWbtc: "69.141,84", pWeth: "2.080,96", mWbtc: "0,2386718374865350", mWeth: "7,9300947639551000" },
    { fecha: "9/2/2026 13:58:48", inversor: "Uriel", tipo: "DEPOSITO", montoUsd: "$101,00", nav: "$1,02", shares: "99,42", pWbtc: "69.825,43", pWeth: "2.096,12", mWbtc: "0,0014464644184791", mWeth: "0,0481842642596798" },
    { fecha: "9/2/2026 15:50:32", inversor: "Nerea", tipo: "DEPOSITO", montoUsd: "$6.800,00", nav: "$1,03", shares: "6.627,94", pWbtc: "70.390,05", pWeth: "2.130,64", mWbtc: "0,0966045627187365", mWeth: "3,1915293057485100" },
    { fecha: "9/2/2026 15:56:01", inversor: "Nerea", tipo: "DEPOSITO", montoUsd: "$79,00", nav: "$1,02", shares: "77,16", pWbtc: "70.185,30", pWeth: "2.128,94", mWbtc: "0,0011255918262086", mWeth: "0,0371076686050335" },
    { fecha: "23/2/2026 11:11:21", inversor: "Uriel", tipo: "DEPOSITO", montoUsd: "$1.028,00", nav: "$0,97", shares: "1.055,65", pWbtc: "66.096,29", pWeth: "1.923,40", mWbtc: "0,0155530665942067", mWeth: "0,5344702090048870" },
    { fecha: "23/2/2026 16:19:02", inversor: "Uriel", tipo: "DEPOSITO", montoUsd: "$689,00", nav: "$0,94", shares: "732,07", pWbtc: "64.476,86", pWeth: "1.856,24", mWbtc: "0,0106860042502070", mWeth: "0,3711804508037750" },
    { fecha: "24/2/2026 10:19:45", inversor: "Uriel", tipo: "DEPOSITO", montoUsd: "$690,00", nav: "$0,93", shares: "743,97", pWbtc: "62.894,25", pWeth: "1.824,34", mWbtc: "0,0109707962174603", mWeth: "0,3782189723406820" },
    { fecha: "24/2/2026 11:02:18", inversor: "Nerea", tipo: "DEPOSITO", montoUsd: "$1.372,00", nav: "$0,92", shares: "1.483,79", pWbtc: "62.822,88", pWeth: "1.815,98", mWbtc: "0,0218391770641524", mWeth: "0,7555149285785090" },
    { fecha: "25/2/2026 12:40:28", inversor: "Nerea", tipo: "DEPOSITO", montoUsd: "$1.356,00", nav: "$1,00", shares: "1.354,84", pWbtc: "67.211,53", pWeth: "2.016,50", mWbtc: "0,0201751098360653", mWeth: "0,6724522687825440" }
];

function parseNum(str) {
    if (!str) return 0;
    const cleanStr = str.replace(/\$|\s/g, '').replace(/\./g, '').replace(/,/g, '.');
    return parseFloat(cleanStr);
}

function parseDate(dateStr) {
    const [datePart, timePart] = dateStr.split(' ');
    const [day, month, year] = datePart.split('/');
    const [hours, minutes, seconds] = timePart.split(':');
    // Using UTC or a specific timezone doesn't matter much as long as it's ordered correctly
    // But since it's local time string, let's just make it lexicographically sortable ISO string
    // month is 0-indexed in Date
    const d = new Date(year, month - 1, day, hours, minutes, seconds);
    return d.toISOString();
}

async function runHistoricalMigration() {
    console.log("[Migration] Iniciando el procesamiento de depósitos históricos...");

    const batch = db.batch();
    const investorsMap = {};
    let fundTotalShares = 0;

    for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i];

        const timestampIso = parseDate(row.fecha);
        // We use slightly incrementing IDs or just the Date parsing for the doc name. Let's use timestamp + index to ensure uniqueness if items are precisely at the same ms
        const operationId = new Date(timestampIso).getTime().toString() + "_" + i;

        const invName = row.inversor;
        const amountUsd = parseNum(row.montoUsd);
        const navOperation = parseNum(row.nav);
        const sharesOperated = parseNum(row.shares);
        const pWbtc = parseNum(row.pWbtc);
        const pWeth = parseNum(row.pWeth);
        const mWbtc = parseNum(row.mWbtc);
        const mWeth = parseNum(row.mWeth);

        if (!investorsMap[invName]) {
            investorsMap[invName] = {
                currentShares: 0,
                netUsd: 0,
                netWbtc: 0,
                netWeth: 0,
                pnlUsd: 0,
                pnlWbtc: 0,
                pnlWeth: 0
            };
        }

        const inv = investorsMap[invName];

        const sharesBefore = inv.currentShares;
        const netUsdBefore = inv.netUsd;

        // Apply movement
        inv.currentShares += sharesOperated;
        inv.netUsd += amountUsd;
        inv.netWbtc += mWbtc;
        inv.netWeth += mWeth;
        fundTotalShares += sharesOperated;

        // Prepare operations sub-document
        const opRef = db.collection('investors').doc(invName).collection('operations').doc(operationId);
        batch.set(opRef, {
            timestamp: timestampIso,
            type: 'DEPOSIT',
            amount_usd: amountUsd,
            amount_wbtc: mWbtc,
            amount_weth: mWeth,
            price_wbtc: pWbtc,
            price_weth: pWeth,
            nav_usd_applied: navOperation,
            shares_operated: sharesOperated,
            shares_before: sharesBefore,
            shares_after: inv.currentShares,
            net_usd_before: netUsdBefore,
            net_usd_after: inv.netUsd,
            realized_pnl_usd: 0,
            realized_pnl_wbtc: 0,
            realized_pnl_weth: 0
        });
    }

    // Now write the final states for the investors
    for (const [invName, invData] of Object.entries(investorsMap)) {
        const avgUsd = invData.currentShares > 0 ? invData.netUsd / invData.currentShares : 0;
        const avgWbtc = invData.currentShares > 0 ? invData.netWbtc / invData.currentShares : 0;
        const avgWeth = invData.currentShares > 0 ? invData.netWeth / invData.currentShares : 0;

        const invRef = db.collection('investors').doc(invName);
        batch.set(invRef, {
            name: invName,
            current_shares: invData.currentShares,
            net_investment_usd: invData.netUsd,
            net_investment_wbtc: invData.netWbtc,
            net_investment_weth: invData.netWeth,
            avg_purchase_nav_usd: avgUsd,
            avg_purchase_nav_wbtc: avgWbtc,
            avg_purchase_nav_weth: avgWeth,
            total_realized_pnl_usd: invData.pnlUsd,
            total_realized_pnl_wbtc: invData.pnlWbtc,
            total_realized_pnl_weth: invData.pnlWeth,
            // rois we set to 0, they will auto adapt in next snapshot
            roi_usd: 0,
            roi_wbtc: 0,
            roi_weth: 0
        }, { merge: true });
    }

    // Update fund total_shares
    const fundRef = db.collection('fund_state').doc('current');
    batch.set(fundRef, {
        total_shares: fundTotalShares
    }, { merge: true });

    await batch.commit();
    return `Migración exitosa. ${csvData.length} registros insertados. Total Shares del fondo actualizadas a: ${fundTotalShares}`;
}

module.exports = {
    runHistoricalMigration
};
