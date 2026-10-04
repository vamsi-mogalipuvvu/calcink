/**
 * CalcInk – Math Engine
 * src/math/evaluator.ts
 *
 * Hand-written tokenizer + shunting-yard parser + evaluator.
 * Supports: + − × ÷ * / -, multi-digit ints, decimals, unary minus,
 *           parentheses, BODMAS/PEMDAS precedence.
 * Never uses eval(). Never throws – returns an EvalResult instead.
 */

// ── Types ─────────────────────────────────────────────────────

/** The token types we recognise */
export type TokenKind =
  | 'NUMBER'
  | 'PLUS'
  | 'MINUS'
  | 'MUL'
  | 'DIV'
  | 'LPAREN'
  | 'RPAREN'
  | 'EQUALS'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string; // raw source text of this token
}

/** Result returned by evaluate() – never throws */
export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

// ── Tokenizer ─────────────────────────────────────────────────

/**
 * Convert a raw expression string into a flat array of tokens.
 * Accepts both Unicode math symbols (× ÷ −) and ASCII equivalents (* / -).
 * Unknown characters produce an error token that the parser will reject.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Numbers (integer or decimal)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let numStr = '';
      let hasDot = false;
      while (i < input.length && (/[0-9]/.test(input[i]) || (input[i] === '.' && !hasDot))) {
        if (input[i] === '.') hasDot = true;
        numStr += input[i++];
      }
      tokens.push({ kind: 'NUMBER', value: numStr });
      continue;
    }

    // Operators and grouping
    switch (ch) {
      case '+':  tokens.push({ kind: 'PLUS',   value: ch }); i++; break;
      case '-':
      case '−':  tokens.push({ kind: 'MINUS',  value: ch }); i++; break;
      case '*':
      case '×':  tokens.push({ kind: 'MUL',    value: ch }); i++; break;
      case '/':
      case '÷':  tokens.push({ kind: 'DIV',    value: ch }); i++; break;
      case '(':  tokens.push({ kind: 'LPAREN', value: ch }); i++; break;
      case ')':  tokens.push({ kind: 'RPAREN', value: ch }); i++; break;
      case '=':  tokens.push({ kind: 'EQUALS', value: ch }); i++; break;
      default:
        // Unknown character – skip but let parser catch the gap
        i++;
        break;
    }
  }

  tokens.push({ kind: 'EOF', value: '' });
  return tokens;
}

// ── Shunting-Yard parser ───────────────────────────────────────

/**
 * Operator metadata used by the shunting-yard algorithm.
 */
interface OpInfo {
  precedence: number;
  rightAssoc: boolean;
}

const OP_INFO: Partial<Record<TokenKind, OpInfo>> = {
  PLUS:  { precedence: 1, rightAssoc: false },
  MINUS: { precedence: 1, rightAssoc: false },
  MUL:   { precedence: 2, rightAssoc: false },
  DIV:   { precedence: 2, rightAssoc: false },
};

/**
 * Represents a node in the resulting RPN (Reverse Polish Notation) queue.
 * Either a numeric operand or a binary/unary operator.
 */
type RPNItem =
  | { type: 'NUM'; value: number }
  | { type: 'BINOP'; op: TokenKind }
  | { type: 'UNARY_NEG' };

/**
 * Parse tokens via Dijkstra's shunting-yard algorithm, handling unary minus.
 * Returns an RPN queue, or a string error message on failure.
 */
function toRPN(tokens: Token[]): RPNItem[] | string {
  const output: RPNItem[] = [];
  const opStack: Array<TokenKind | 'UNARY_NEG'> = [];

  /**
   * Pop operators from the op stack to output according to precedence rules.
   */
  function popHigherPrecedence(currentPrec: number, rightAssoc: boolean): void {
    while (opStack.length > 0) {
      const top = opStack[opStack.length - 1];
      if (top === 'LPAREN') break;
      if (top === 'UNARY_NEG') {
        opStack.pop();
        output.push({ type: 'UNARY_NEG' });
        continue;
      }
      const topInfo = OP_INFO[top as TokenKind];
      if (!topInfo) break;
      const shouldPop = rightAssoc
        ? topInfo.precedence > currentPrec
        : topInfo.precedence >= currentPrec;
      if (!shouldPop) break;
      opStack.pop();
      output.push({ type: 'BINOP', op: top as TokenKind });
    }
  }

  /** Track whether the previous meaningful token could be an operand/right-paren,
   *  so we know if a '-' is unary or binary. */
  let prevWasOperand = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.kind === 'EOF' || tok.kind === 'EQUALS') break;

    if (tok.kind === 'NUMBER') {
      const n = parseFloat(tok.value);
      if (Number.isNaN(n)) return `Invalid number: "${tok.value}"`;
      output.push({ type: 'NUM', value: n });
      prevWasOperand = true;
      continue;
    }

    if (tok.kind === 'LPAREN') {
      opStack.push('LPAREN');
      prevWasOperand = false;
      continue;
    }

    if (tok.kind === 'RPAREN') {
      // Pop until matching LPAREN
      let foundLParen = false;
      while (opStack.length > 0) {
        const top = opStack.pop()!;
        if (top === 'LPAREN') { foundLParen = true; break; }
        if (top === 'UNARY_NEG') { output.push({ type: 'UNARY_NEG' }); }
        else { output.push({ type: 'BINOP', op: top as TokenKind }); }
      }
      if (!foundLParen) return 'Mismatched parentheses: missing "("';
      prevWasOperand = true;
      continue;
    }

    // Binary or unary operator
    if (tok.kind === 'MINUS' && !prevWasOperand) {
      // Unary minus – higher precedence than binary, right-associative
      opStack.push('UNARY_NEG');
      prevWasOperand = false;
      continue;
    }

    const info = OP_INFO[tok.kind];
    if (!info) return `Unknown operator: "${tok.value}"`;

    popHigherPrecedence(info.precedence, info.rightAssoc);
    opStack.push(tok.kind);
    prevWasOperand = false;
  }

  // Drain remaining operators
  while (opStack.length > 0) {
    const top = opStack.pop()!;
    if (top === 'LPAREN') return 'Mismatched parentheses: missing ")"';
    if (top === 'UNARY_NEG') { output.push({ type: 'UNARY_NEG' }); }
    else { output.push({ type: 'BINOP', op: top as TokenKind }); }
  }

  return output;
}

// ── RPN Evaluator ─────────────────────────────────────────────

/**
 * Evaluate a Reverse Polish Notation queue and return a numeric result.
 * Returns an error string on stack underflow / division by zero.
 */
function evalRPN(rpn: RPNItem[]): number | string {
  const stack: number[] = [];

  for (const item of rpn) {
    if (item.type === 'NUM') {
      stack.push(item.value);
      continue;
    }

    if (item.type === 'UNARY_NEG') {
      if (stack.length < 1) return 'Malformed expression (unary minus with no operand)';
      stack.push(-stack.pop()!);
      continue;
    }

    // Binary operator – needs two operands
    if (stack.length < 2) return 'Malformed expression (not enough operands)';
    const b = stack.pop()!;
    const a = stack.pop()!;

    switch (item.op) {
      case 'PLUS':  stack.push(a + b); break;
      case 'MINUS': stack.push(a - b); break;
      case 'MUL':   stack.push(a * b); break;
      case 'DIV':
        if (b === 0) return 'Undefined'; // Division by zero
        stack.push(a / b);
        break;
      default:
        return `Unknown operator in RPN: ${item.op}`;
    }
  }

  if (stack.length !== 1) return 'Malformed expression (leftover operands)';
  return stack[0];
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Evaluate a math expression string.
 *
 * @param input - Raw expression, e.g. "18+4×3" or "3.5 * -2"
 * @returns EvalResult: { ok: true, value } on success,
 *                      { ok: false, error } on any failure.
 *
 * Examples:
 *   evaluate("2+3")       → { ok:true, value:5 }
 *   evaluate("10÷0")      → { ok:false, error:"Undefined" }
 *   evaluate("3++")       → { ok:false, error:"Malformed expression ..." }
 *   evaluate("")          → { ok:false, error:"Empty expression" }
 */
export function evaluate(input: string): EvalResult {
  try {
    // Strip trailing equals sign(s) and surrounding whitespace
    const expr = input.replace(/=+\s*$/, '').trim();

    if (expr === '') return { ok: false, error: 'Empty expression' };

    const tokens = tokenize(expr);

    // Check for at least one numeric token (guard against symbol-only input)
    const hasNumber = tokens.some(t => t.kind === 'NUMBER');
    if (!hasNumber) return { ok: false, error: 'No numbers in expression' };

    const rpn = toRPN(tokens);
    if (typeof rpn === 'string') return { ok: false, error: rpn };

    if (rpn.length === 0) return { ok: false, error: 'Empty expression after parsing' };

    const result = evalRPN(rpn);
    if (typeof result === 'string') {
      // Special-case "Undefined" (division by zero) vs general errors
      if (result === 'Undefined') return { ok: false, error: 'Undefined' };
      return { ok: false, error: result };
    }

    if (!Number.isFinite(result)) return { ok: false, error: 'Undefined' };

    return { ok: true, value: result };
  } catch (_err) {
    // Safety net – should never reach here by design
    return { ok: false, error: 'Unexpected parse error' };
  }
}

/**
 * Format a number for display on the canvas.
 * - Integers: no decimal point
 * - Decimals: up to 8 significant digits, trailing zeros stripped
 * - Very large/small: exponential notation
 */
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return 'Undefined';

  // Integer check
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return String(value);
  }

  // Use toPrecision to limit sig figs, then strip trailing zeros
  const str = value.toPrecision(8).replace(/\.?0+$/, '');
  return str;
}
