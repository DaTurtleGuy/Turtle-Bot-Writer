import { claimDailyQuota, getMyQuota } from './newPixai.js';

function verifyTokens() {
    let newTokens = [];
    if (!pixaiTokens || pixaiTokens.length === 0) {
        console.error('No PixAI tokens provided.');
        process.exit(1);
    }
    for (const token of pixaiTokens) {
        if (!token || token.length === 0) {
            console.error('Invalid PixAI token:', token);
            continue;
        }
        newTokens.push(token);
    }
    if (newTokens.length === 0) {
        console.error('No valid PixAI tokens provided.');
        process.exit(1);
    }
    pixaiTokens = newTokens;
}

function getValidTokens(tokens) {
    let validTokens = [];
    if (!tokens || tokens.length === 0) {
        console.error('No tokens provided.');
        return validTokens;
    }
    for (const token of tokens) {
        if (!token || token.length === 0) {
            console.error('Invalid token:', token);
            continue;
        }
        if (validTokens.includes(token)) {
            console.error('Duplicate token:', token);
            continue;
        }
        validTokens.push(token.trim());
    }
    return validTokens;
}

async function claimQuotas(tokens) {
    let report = '';
    for (const token of tokens) {
        const result = await claimDailyQuota(token);
        const tokenIndex = tokens.indexOf(token) + 1;
        report += `Token Number ${tokenIndex}, Result: ${result ? 'Success' : 'Failed'}\n`;
        const credits = await getMyQuota(token);
        report += `Credits: ${credits}\n\n`;
    }
    return report;
}

export { getValidTokens, claimQuotas };
