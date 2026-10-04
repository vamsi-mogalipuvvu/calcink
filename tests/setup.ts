/**
 * Vitest global setup
 * tests/setup.ts
 *
 * Polyfills for Node.js test environment:
 * - OffscreenCanvas (used by preprocessor, not available in Node)
 * - Worker (used by bridge, not available in Node – tests mock this)
 */

// Minimal OffscreenCanvas stub so preprocessor can be imported
// The actual drawing is not tested here (integration test territory)
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  class OffscreenCanvasStub {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext(_type: string) {
      return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        lineCap: 'round',
        lineJoin: 'round',
        shadowColor: '',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        fillRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        quadraticCurveTo: () => {},
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4), // all zeros (black)
        }),
      };
    }
  }
  // @ts-expect-error — polyfill
  globalThis.OffscreenCanvas = OffscreenCanvasStub;
}
