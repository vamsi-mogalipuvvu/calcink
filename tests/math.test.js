/**
 * CalcInk – Math Engine Unit Tests
 * tests/math.test.ts
 *
 * Covers: precedence, decimals, negatives, division by zero,
 *         malformed syntax, empty input, edge cases.
 */
import { describe, it, expect } from 'vitest';
import { evaluate, formatResult, tokenize } from '../src/math/evaluator.js';
// ── Tokenizer ─────────────────────────────────────────────────
describe('tokenize', () => {
    it('tokenises a simple expression', () => {
        const tokens = tokenize('3+4');
        expect(tokens.map(t => t.kind)).toEqual(['NUMBER', 'PLUS', 'NUMBER', 'EOF']);
    });
    it('tokenises Unicode operators ×, ÷, −', () => {
        const tokens = tokenize('2×3÷1−0');
        expect(tokens.map(t => t.kind)).toEqual([
            'NUMBER', 'MUL', 'NUMBER', 'DIV', 'NUMBER', 'MINUS', 'NUMBER', 'EOF',
        ]);
    });
    it('tokenises decimal numbers', () => {
        const tokens = tokenize('3.14+2.71');
        expect(tokens[0]).toEqual({ kind: 'NUMBER', value: '3.14' });
        expect(tokens[2]).toEqual({ kind: 'NUMBER', value: '2.71' });
    });
    it('tokenises parentheses', () => {
        const tokens = tokenize('(2+3)');
        expect(tokens.map(t => t.kind)).toEqual(['LPAREN', 'NUMBER', 'PLUS', 'NUMBER', 'RPAREN', 'EOF']);
    });
    it('strips trailing = sign', () => {
        // evaluate() removes '=' before tokenising – tokenize itself keeps it
        const tokens = tokenize('5=');
        expect(tokens.some(t => t.kind === 'EQUALS')).toBe(true);
    });
});
// ── Basic arithmetic ──────────────────────────────────────────
describe('evaluate – basic arithmetic', () => {
    it('adds two numbers', () => {
        expect(evaluate('2+3')).toEqual({ ok: true, value: 5 });
    });
    it('subtracts', () => {
        expect(evaluate('10-4')).toEqual({ ok: true, value: 6 });
    });
    it('multiplies', () => {
        expect(evaluate('6*7')).toEqual({ ok: true, value: 42 });
    });
    it('divides', () => {
        expect(evaluate('15/3')).toEqual({ ok: true, value: 5 });
    });
    it('accepts Unicode × operator', () => {
        expect(evaluate('4×5')).toEqual({ ok: true, value: 20 });
    });
    it('accepts Unicode ÷ operator', () => {
        expect(evaluate('20÷4')).toEqual({ ok: true, value: 5 });
    });
    it('accepts Unicode − operator', () => {
        expect(evaluate('10−3')).toEqual({ ok: true, value: 7 });
    });
});
// ── BODMAS / PEMDAS Precedence ────────────────────────────────
describe('evaluate – BODMAS / precedence', () => {
    it('respects multiplication before addition', () => {
        expect(evaluate('2+3*4')).toEqual({ ok: true, value: 14 });
    });
    it('respects division before subtraction', () => {
        expect(evaluate('10-6/2')).toEqual({ ok: true, value: 7 });
    });
    it('handles mixed +−×÷ with correct precedence', () => {
        // 18 + 4×3 − 6÷2  =  18 + 12 − 3  = 27
        expect(evaluate('18+4×3−6÷2')).toEqual({ ok: true, value: 27 });
    });
    it('parentheses override precedence', () => {
        // (2+3)*4 = 20
        expect(evaluate('(2+3)*4')).toEqual({ ok: true, value: 20 });
    });
    it('nested parentheses', () => {
        // ((2+3)*2)+1 = 11
        expect(evaluate('((2+3)*2)+1')).toEqual({ ok: true, value: 11 });
    });
    it('strips trailing = and evaluates', () => {
        expect(evaluate('6×7=')).toEqual({ ok: true, value: 42 });
    });
    it('strips trailing = with spaces', () => {
        expect(evaluate('5+5 =')).toEqual({ ok: true, value: 10 });
    });
});
// ── Decimals ──────────────────────────────────────────────────
describe('evaluate – decimals', () => {
    it('adds decimals', () => {
        const r = evaluate('1.5+2.5');
        expect(r).toEqual({ ok: true, value: 4 });
    });
    it('multiplies decimals', () => {
        const r = evaluate('2.5*4');
        expect(r).toEqual({ ok: true, value: 10 });
    });
    it('divides to produce decimal', () => {
        const r = evaluate('1/4');
        expect(r).toEqual({ ok: true, value: 0.25 });
    });
    it('handles multi-decimal arithmetic', () => {
        const r = evaluate('3.14*2');
        expect(r.ok).toBe(true);
        if (r.ok)
            expect(r.value).toBeCloseTo(6.28, 5);
    });
});
// ── Negative numbers / unary minus ────────────────────────────
describe('evaluate – negative / unary minus', () => {
    it('handles leading unary minus', () => {
        expect(evaluate('-5+3')).toEqual({ ok: true, value: -2 });
    });
    it('handles unary minus in expression', () => {
        expect(evaluate('10+-3')).toEqual({ ok: true, value: 7 });
    });
    it('handles double negation', () => {
        // --5 = +5
        expect(evaluate('--5')).toEqual({ ok: true, value: 5 });
    });
    it('handles unary minus with multiplication', () => {
        expect(evaluate('-3*4')).toEqual({ ok: true, value: -12 });
    });
    it('handles unary minus in parentheses', () => {
        expect(evaluate('(-4+2)*3')).toEqual({ ok: true, value: -6 });
    });
    it('handles negative result', () => {
        expect(evaluate('3-10')).toEqual({ ok: true, value: -7 });
    });
});
// ── Division by zero ──────────────────────────────────────────
describe('evaluate – division by zero', () => {
    it('returns Undefined for n÷0', () => {
        const r = evaluate('5÷0');
        expect(r).toEqual({ ok: false, error: 'Undefined' });
    });
    it('returns Undefined for 0÷0', () => {
        const r = evaluate('0/0');
        expect(r).toEqual({ ok: false, error: 'Undefined' });
    });
    it('returns Undefined for expression containing ÷0', () => {
        const r = evaluate('10+5/0');
        expect(r).toEqual({ ok: false, error: 'Undefined' });
    });
});
// ── Malformed / edge-case input ───────────────────────────────
describe('evaluate – malformed / edge cases', () => {
    it('empty string returns error', () => {
        const r = evaluate('');
        expect(r.ok).toBe(false);
    });
    it('whitespace-only returns error', () => {
        const r = evaluate('   ');
        expect(r.ok).toBe(false);
    });
    it('double operator "3++" returns error', () => {
        const r = evaluate('3++');
        expect(r.ok).toBe(false);
    });
    it('"5÷" (trailing operator) returns error', () => {
        const r = evaluate('5÷');
        expect(r.ok).toBe(false);
    });
    it('"*5" (leading binary op) returns error', () => {
        const r = evaluate('*5');
        expect(r.ok).toBe(false);
    });
    it('mismatched paren "((3+4)" returns error', () => {
        const r = evaluate('((3+4)');
        expect(r.ok).toBe(false);
    });
    it('mismatched paren "3+4)" returns error', () => {
        const r = evaluate('3+4)');
        expect(r.ok).toBe(false);
    });
    it('solo operator "-" returns error', () => {
        const r = evaluate('-');
        expect(r.ok).toBe(false);
    });
    it('only equals sign returns error', () => {
        const r = evaluate('=');
        expect(r.ok).toBe(false);
    });
    it('never throws – safety net', () => {
        // These should all return an EvalResult, never throw
        const inputs = ['', '=', '÷', '/', '***', '((((', '1e', null];
        for (const inp of inputs) {
            expect(() => evaluate(inp)).not.toThrow();
        }
    });
});
// ── formatResult ─────────────────────────────────────────────
describe('formatResult', () => {
    it('formats integers without decimal point', () => {
        expect(formatResult(42)).toBe('42');
    });
    it('formats negative integers', () => {
        expect(formatResult(-7)).toBe('-7');
    });
    it('strips trailing zeros from decimals', () => {
        // 1.50000 → "1.5"
        expect(formatResult(1.5)).toBe('1.5');
    });
    it('formats Infinity as Undefined', () => {
        expect(formatResult(Infinity)).toBe('Undefined');
    });
    it('formats NaN as Undefined', () => {
        expect(formatResult(NaN)).toBe('Undefined');
    });
    it('formats pi-like values to 8 sig figs', () => {
        const s = formatResult(Math.PI);
        // Should not have more than 8 significant digits
        expect(s.replace(/[^0-9]/g, '').length).toBeLessThanOrEqual(8);
    });
});
// ── Coordinate conversion helpers (canvas utils) ──────────────
// These are simple pure-function helpers we'll add to a coords utility.
// For now we test the coordinate math inline.
describe('coordinate conversion helpers', () => {
    /**
     * canvasToLogical: convert physical pixel → CSS pixel using DPR.
     */
    function canvasToLogical(physX, physY, dpr) {
        return { x: physX / dpr, y: physY / dpr };
    }
    /**
     * logicalToCanvas: convert CSS pixel → physical pixel using DPR.
     */
    function logicalToCanvas(cssX, cssY, dpr) {
        return { x: cssX * dpr, y: cssY * dpr };
    }
    it('canvasToLogical with DPR=2 halves coordinates', () => {
        expect(canvasToLogical(200, 400, 2)).toEqual({ x: 100, y: 200 });
    });
    it('logicalToCanvas with DPR=2 doubles coordinates', () => {
        expect(logicalToCanvas(100, 200, 2)).toEqual({ x: 200, y: 400 });
    });
    it('round-trips logical→canvas→logical', () => {
        const dpr = 3;
        const css = { x: 150, y: 75 };
        const phys = logicalToCanvas(css.x, css.y, dpr);
        const back = canvasToLogical(phys.x, phys.y, dpr);
        expect(back).toEqual(css);
    });
    it('DPR=1 is identity', () => {
        expect(canvasToLogical(123, 456, 1)).toEqual({ x: 123, y: 456 });
        expect(logicalToCanvas(123, 456, 1)).toEqual({ x: 123, y: 456 });
    });
});
