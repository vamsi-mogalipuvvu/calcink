"use strict";
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
        constructor(w, h) {
            Object.defineProperty(this, "width", {
                enumerable: true,
                configurable: true,
                writable: true,
                value: void 0
            });
            Object.defineProperty(this, "height", {
                enumerable: true,
                configurable: true,
                writable: true,
                value: void 0
            });
            this.width = w;
            this.height = h;
        }
        getContext(_type) {
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
                fillRect: () => { },
                beginPath: () => { },
                moveTo: () => { },
                lineTo: () => { },
                arc: () => { },
                fill: () => { },
                stroke: () => { },
                quadraticCurveTo: () => { },
                drawImage: () => { },
                getImageData: (_x, _y, w, h) => ({
                    data: new Uint8ClampedArray(w * h * 4), // all zeros (black)
                }),
            };
        }
    }
    // @ts-expect-error — polyfill
    globalThis.OffscreenCanvas = OffscreenCanvasStub;
}
