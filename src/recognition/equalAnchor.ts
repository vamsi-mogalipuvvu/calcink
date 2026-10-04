import { groupStrokes } from './grouper';
import { classifyOperator } from './operatorClassifier';
import type { Stroke } from '../canvas/stroke';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function findEqualAnchor(strokes: Stroke[]): BoundingBox | null {
  if (strokes.length === 0) return null;
  
  const groups = groupStrokes(strokes);
  let bestAnchor: BoundingBox | null = null;
  
  for (const group of groups) {
    if (group.strokes.length !== 2) continue;
    
    // Pass median height as 100 as a fallback, or we could compute it properly
    const res = classifyOperator(group, 100);
    if (res && res.symbol === '=' && res.confidence >= 0.8) {
      bestAnchor = {
        minX: group.bbox.minX,
        minY: group.bbox.minY,
        maxX: group.bbox.maxX,
        maxY: group.bbox.maxY
      };
    }
  }
  
  return bestAnchor;
}
