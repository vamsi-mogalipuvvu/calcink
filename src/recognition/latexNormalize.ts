export type LatexNormalizeResult =
  | { ok: true; expression: string }
  | { ok: false; error: string };

export function normalizeLatexExpression(input: string): LatexNormalizeResult {
  if (!input || input.trim() === '') {
    return { ok: false, error: 'Empty input' };
  }

  let expr = input.trim();

  // Remove common wrapping
  if (expr.startsWith('\\(') && expr.endsWith('\\)')) {
    expr = expr.substring(2, expr.length - 2).trim();
  }
  
  // Remove wrapping \left and \right
  expr = expr.replace(/\\left/g, '').replace(/\\right/g, '');

  // Reject unsupported constructs immediately
  if (/[a-zA-Z]/.test(expr.replace(/\\times|\\cdot|\\div|\\frac/g, ''))) {
    return { ok: false, error: 'Contains unsupported characters or variables' };
  }
  if (expr.includes('^')) {
    return { ok: false, error: 'Powers (^) not supported' };
  }
  if (expr.includes('\\sqrt') || expr.includes('\\int') || expr.includes('\\sum')) {
    return { ok: false, error: 'Unsupported math commands' };
  }

  // Remove spacing
  expr = expr.replace(/\\,/g, '').replace(/\s+/g, '');

  // Remove trailing =
  if (expr.endsWith('=')) {
    expr = expr.substring(0, expr.length - 1);
  }

  // Replace commands with basic operators
  expr = expr.replace(/\\times/g, '×');
  expr = expr.replace(/\\cdot/g, '×');
  expr = expr.replace(/\\div/g, '÷');
  
  // Normalize minus
  expr = expr.replace(/−/g, '-');

  // Handle simple fractions \frac{a}{b} -> (a)/(b)
  // We use a simple regex for single-level fractions that just contain numbers/basic operators.
  // This avoids a full recursive parser since we only support simple arithmetic.
  let prevExpr;
  do {
    prevExpr = expr;
    // Match \frac{...}{...} where the contents do not contain nested {} 
    expr = expr.replace(/\\frac{([^{}]+)}{([^{}]+)}/g, '($1)/($2)');
  } while (expr !== prevExpr);

  // If there are still \frac left with nested braces, reject
  if (expr.includes('\\frac')) {
    return { ok: false, error: 'Nested or complex fractions not supported' };
  }

  // Convert { } to ( ) if they were just used for grouping, and make sure no unknown commands remain
  if (expr.includes('\\')) {
    return { ok: false, error: 'Unknown LaTeX command remains' };
  }
  expr = expr.replace(/{/g, '(').replace(/}/g, ')');

  // Verify that only supported characters remain
  // Allowed: digits, + - × ÷ * / ( ) .
  if (!/^[\d+\-×÷*/().]+$/.test(expr)) {
    return { ok: false, error: 'Contains unsupported characters after normalization' };
  }

  if (expr.trim() === '') {
    return { ok: false, error: 'Empty after normalization' };
  }

  return { ok: true, expression: expr };
}
