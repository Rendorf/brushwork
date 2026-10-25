import { describe, expect, it } from 'vitest';
import { BLEND_MODES, blendFromPsd, blendIndex, blendPremul, blendToPsd, OP_ERASE, type RGBA } from './blendModes';

const close = (a: RGBA, b: RGBA, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('blendPremul', () => {
  const red: RGBA = [1, 0, 0, 1];
  const halfBlue: RGBA = [0, 0, 0.5, 0.5];
  const gray: RGBA = [0.5, 0.5, 0.5, 1];
  const clear: RGBA = [0, 0, 0, 0];

  it('normal is source-over', () => {
    expect(close(blendPremul(red, halfBlue, 0), [0.5, 0, 0.5, 1])).toBe(true);
  });

  it('every mode leaves the backdrop unchanged under a transparent source', () => {
    BLEND_MODES.forEach((_, m) => {
      expect(close(blendPremul(gray, clear, m), gray)).toBe(true);
    });
  });

  it('every mode shows the source over a transparent backdrop', () => {
    BLEND_MODES.forEach((_, m) => {
      expect(close(blendPremul(clear, halfBlue, m), halfBlue)).toBe(true);
    });
  });

  it('multiply and screen match their definitions on opaque colors', () => {
    expect(close(blendPremul(gray, gray, blendIndex('multiply')), [0.25, 0.25, 0.25, 1])).toBe(true);
    expect(close(blendPremul(gray, gray, blendIndex('screen')), [0.75, 0.75, 0.75, 1])).toBe(true);
  });

  it('difference of identical colors is black', () => {
    expect(close(blendPremul(red, red, blendIndex('difference')), [0, 0, 0, 1])).toBe(true);
  });

  it('luminosity keeps the backdrop hue', () => {
    const out = blendPremul(red, gray, blendIndex('luminosity'));
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeCloseTo(out[2]);
  });

  it('atop keeps the backdrop alpha (clipping / alpha lock)', () => {
    const half: RGBA = [0.25, 0.25, 0.25, 0.5];
    const out = blendPremul(half, red, 0, true);
    expect(out[3]).toBeCloseTo(0.5);
    expect(out[0]).toBeCloseTo(0.5);
    expect(blendPremul(clear, red, 0, true)).toEqual([0, 0, 0, 0]);
  });

  it('erase removes by source alpha', () => {
    expect(close(blendPremul(gray, halfBlue, OP_ERASE), [0.25, 0.25, 0.25, 0.5])).toBe(true);
  });

  it('results stay premultiplied (color <= alpha)', () => {
    const samples: RGBA[] = [red, halfBlue, gray, [0.1, 0.4, 0.2, 0.4], [0.9, 0.2, 0.6, 0.95]];
    BLEND_MODES.forEach((_, m) => {
      for (const b of samples) for (const s of samples) {
        const o = blendPremul(b, s, m);
        for (let i = 0; i < 3; i++) expect(o[i]).toBeLessThanOrEqual(o[3] + 1e-6);
      }
    });
  });
});

describe('PSD blend names', () => {
  it('round-trip for every non-glow mode', () => {
    for (const m of BLEND_MODES) {
      if (m.id === 'addGlow' || m.id === 'colorDodgeGlow') continue;
      expect(blendFromPsd(blendToPsd(m.id))).toBe(m.id);
    }
    expect(blendFromPsd(blendToPsd('passthrough'))).toBe('passthrough');
  });
});
