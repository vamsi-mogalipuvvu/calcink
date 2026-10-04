import { describe, it, expect } from 'vitest';
import { normalizeLatexExpression } from '../src/recognition/latexNormalize.js';

describe('normalizeLatexExpression', () => {
  it('handles basic arithmetic with \\times and =', () => {
    const result = normalizeLatexExpression('18+4\\times3=');
    expect(result).toEqual({ ok: true, expression: '18+4×3' });
  });

  it('handles \\div and division by zero', () => {
    const result = normalizeLatexExpression('6\\div0=');
    expect(result).toEqual({ ok: true, expression: '6÷0' });
  });

  it('handles decimals', () => {
    const result = normalizeLatexExpression('3.5+2.1=');
    expect(result).toEqual({ ok: true, expression: '3.5+2.1' });
  });

  it('handles negative numbers', () => {
    const result = normalizeLatexExpression('-5+3=');
    expect(result).toEqual({ ok: true, expression: '-5+3' });
  });

  it('handles simple fractions', () => {
    const result = normalizeLatexExpression('\\frac{6}{2}=');
    expect(result).toEqual({ ok: true, expression: '(6)/(2)' });
  });

  it('handles \\left and \\right parentheses', () => {
    const result = normalizeLatexExpression('\\left(4+2\\right)\\times3=');
    expect(result).toEqual({ ok: true, expression: '(4+2)×3' });
  });

  it('handles \\cdot and spaces', () => {
    const result = normalizeLatexExpression('18 + 4 \\cdot 3 =');
    expect(result).toEqual({ ok: true, expression: '18+4×3' });
  });

  it('normalizes unicode minus', () => {
    const result = normalizeLatexExpression('8−3=');
    expect(result).toEqual({ ok: true, expression: '8-3' });
  });

  it('rejects unsupported commands like \\sqrt', () => {
    const result = normalizeLatexExpression('\\sqrt{4}');
    expect(result.ok).toBe(false);
  });

  it('rejects variables like x', () => {
    const result = normalizeLatexExpression('x+1');
    expect(result.ok).toBe(false);
  });

  it('rejects empty input', () => {
    const result = normalizeLatexExpression('');
    expect(result.ok).toBe(false);
  });
});
