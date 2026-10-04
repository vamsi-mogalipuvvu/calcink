/**
 * A decimal point only makes sense BETWEEN two digits, so stray "." symbols
 * (accidental pen taps) anywhere else are dropped.
 * Returns a mask: true = keep the symbol at that index.
 */
export function strayDotMask(symbols) {
    const isDigit = (s) => s !== undefined && s.length === 1 && s >= '0' && s <= '9';
    return symbols.map((s, i) => s !== '.' || (isDigit(symbols[i - 1]) && isDigit(symbols[i + 1])));
}
