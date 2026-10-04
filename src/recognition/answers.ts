import { AnswerOverlay } from '../canvas/answerOverlay.js';
import type { AnswerEntry, ConfidenceMark } from '../canvas/answerOverlay.js';
import { confidenceLevel } from '../canvas/answerOverlay.js';
import { evaluate, formatResult } from '../math/evaluator.js';
import type { DebugGroup } from './index.js';
import { bboxHeight, bboxWidth, splitIntoLines } from './grouper.js';
import type { SymbolGroup } from './grouper.js';

export interface ComputedAnswers {
  answers: AnswerEntry[];
  marks: ConfidenceMark[];
}

export function computeAnswers(
  groups: SymbolGroup[],
  debug: DebugGroup[],
  penWidth: number,
): ComputedAnswers {
  const lines = splitIntoLines(groups);
  const answers: AnswerEntry[] = [];
  const marks: ConfidenceMark[] = [];

  for (const lineGroups of lines) {
    const lineGroupsSorted = [...lineGroups].sort((a, b) => a.cx - b.cx);
    const allGroupsSorted  = [...groups].sort((a, b) => a.cx - b.cx);

    let equalsGroup: SymbolGroup | null = null;
    const lineSymbols: string[] = [];
    const lineItems: Array<{ group: SymbolGroup; debug: DebugGroup }> = [];

    for (const lineGroup of lineGroupsSorted) {
      const gIdx = allGroupsSorted.indexOf(lineGroup);
      const dbg  = gIdx >= 0 && gIdx < debug.length ? debug[gIdx] : undefined;
      if (dbg?.dropped) continue;
      const sym = dbg ? dbg.symbol : '?';
      lineSymbols.push(sym);
      if (dbg) lineItems.push({ group: lineGroup, debug: dbg });
      if (sym === '=') equalsGroup = lineGroup;
    }

    const equalsIdx = lineSymbols.lastIndexOf('=');
    if (!equalsGroup || equalsIdx <= 0) continue;

    const exprForLine = lineSymbols.slice(0, equalsIdx).join('');
    const evalResult  = evaluate(exprForLine);
    const answerText  = evalResult.ok
      ? formatResult(evalResult.value)
      : (evalResult.error === 'Undefined' ? 'Undefined' : '?');

    const heights = lineGroupsSorted.map(g => bboxHeight(g.bbox)).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] ?? 30;
    const pos = AnswerOverlay.answerPosition(equalsGroup.bbox, penWidth);

    answers.push({ x: pos.x, y: pos.y, text: answerText, symbolHeight: medianH });

    for (const item of lineItems) {
      const bb = item.group.bbox;
      marks.push({
        x: (bb.minX + bb.maxX) / 2,
        y: bb.maxY + 8,
        w: Math.min(bboxWidth(bb), 40),
        level: confidenceLevel(item.debug.confidence ?? 0.5),
      });
    }
  }

  return { answers, marks };
}
