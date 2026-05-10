// Gridcoin addresses are 34-char base58 strings (alphabet excludes
// 0, O, I, l). Shared between the wallet creation Joi schema and any
// route that does shape validation before a DB lookup, so a single
// rule defines what "looks like an address" everywhere in grcpay.
export const GRC_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{34}$/;
