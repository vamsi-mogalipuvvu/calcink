export interface ClientRectLike {
  left: number;
  top: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasBackingSize {
  width: number;
  height: number;
}

export function clientToCanvasPoint(clientX: number, clientY: number, rect: ClientRectLike): CanvasPoint {
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function cssToPhysical(value: number, dpr: number): number {
  return value * dpr;
}

export function physicalToCss(value: number, dpr: number): number {
  return value / dpr;
}

export function canvasBackingSize(cssWidth: number, cssHeight: number, dpr: number): CanvasBackingSize {
  return {
    width: Math.round(cssToPhysical(cssWidth, dpr)),
    height: Math.round(cssToPhysical(cssHeight, dpr)),
  };
}
