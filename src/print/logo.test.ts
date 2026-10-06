import { describe, expect, it } from 'vitest';

import { BUNDLED_LOGO_URL, logoDotWidth, logoHeight, logoSource, threshold } from './logo';

describe('logoDotWidth', () => {
  it('sizes to the head, because QZ does not resize', () => {
    // The one thing that has to be right. An image wider than the roll is what
    // tears a logo across two lines — and it is not visible until it prints.
    expect(logoDotWidth(80)).toBe(576);
    expect(logoDotWidth(58)).toBe(384);
  });

  it('takes the owner’s size as a share of the paper, not a number of pixels', () => {
    // The roll is the only ruler that means anything: a size in millimetres or
    // pixels comes out different on each paper width, where "70% of the paper"
    // is the same thing on both.
    expect(logoDotWidth(80, 50)).toBe(288);
    expect(logoDotWidth(58, 50)).toBe(192);
    expect(logoDotWidth(80, 70)).toBe(403);
  });

  it('clamps both ends, because both are a wasted receipt', () => {
    // Wider than the paper tears the logo across two lines; much under a fifth
    // is a mark nobody can identify and ink spent on nothing.
    expect(logoDotWidth(80, 500)).toBe(576);
    expect(logoDotWidth(80, 0)).toBe(logoDotWidth(80, 20));
    expect(logoDotWidth(80, -10)).toBe(logoDotWidth(80, 20));
  });

  it('falls back to full width for a size that is not a number', () => {
    // An older template, or a hand-edited one. Printing nothing would be worse.
    expect(logoDotWidth(80, Number.NaN)).toBe(576);
    expect(logoDotWidth(80, undefined)).toBe(576);
  });
});

describe('logoHeight', () => {
  it('keeps the wordmark’s proportions', () => {
    // The brand mark is a 1600x384 lockup.
    expect(logoHeight(1600, 384, 576, 240)).toEqual({ width: 576, height: 138 });
  });

  it('gives up width rather than let a tall logo eat the roll', () => {
    const { width, height } = logoHeight(400, 800, 576, 240);

    expect(height).toBe(240);
    expect(width).toBe(120);
  });

  it('does not divide by a zero-sized image', () => {
    expect(logoHeight(0, 0, 576, 240)).toEqual({ width: 576, height: 240 });
  });
});

describe('threshold', () => {
  function pixel(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
    return new Uint8ClampedArray([r, g, b, a]);
  }

  it('is black and white and nothing between', () => {
    // A thermal head has one ink. Leaving greys for the driver to dither
    // produces a muddy wordmark on some models and a clean one on others.
    const dark = pixel(20, 20, 20);
    threshold(dark);
    expect([...dark]).toEqual([0, 0, 0, 255]);

    const light = pixel(240, 240, 240);
    threshold(light);
    expect([...light]).toEqual([255, 255, 255, 255]);
  });

  it('turns a transparent pixel white, not black', () => {
    // A logo on a transparent background is the ordinary case, and an alpha
    // channel the printer does not understand reads as black on some drivers —
    // which prints the whole rectangle around the wordmark solid.
    const clear = pixel(0, 0, 0, 0);
    threshold(clear);
    expect([...clear]).toEqual([255, 255, 255, 255]);
  });

  it('weighs colour the way an eye does', () => {
    // Mid-blue is darker to a reader than mid-yellow at the same RGB level;
    // a flat average prints one of them wrong.
    const blue = pixel(0, 0, 200);
    const yellow = pixel(200, 200, 0);
    threshold(blue);
    threshold(yellow);

    expect(blue[0]).toBe(0);
    expect(yellow[0]).toBe(255);
  });
});

describe('logoSource', () => {
  it('falls back to the bundled brand mark, which is what makes it print on day one', () => {
    expect(logoSource(null)).toBe(BUNDLED_LOGO_URL);
    expect(logoSource('')).toBe(BUNDLED_LOGO_URL);
    expect(logoSource('   ')).toBe(BUNDLED_LOGO_URL);
    expect(logoSource('https://cdn.example.test/brand.png')).toBe('https://cdn.example.test/brand.png');
  });
});
