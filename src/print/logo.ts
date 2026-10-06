/**
 * The logo, turned into something a thermal printer will accept.
 *
 * QZ Tray rasterises an image to ESC/POS itself (`format: 'image'`,
 * `language: 'ESCPOS'`), so **none of the per-model raster code is ours** —
 * which is the only reason a logo is safe to print on hardware nobody here has
 * tested against. What QZ does *not* do is resize: an image wider than the roll
 * is what tears a logo across two lines, so the width is the one thing that has
 * to be right, and it is the one thing we control here.
 *
 * Three decisions:
 *
 *  - **The width is in dots, not millimetres.** A 203-dpi head — which is
 *    almost all of them — prints 576 dots across an 80mm roll and 384 across a
 *    58mm one. Those two numbers are the whole sizing model; a printer with a
 *    different head prints the logo slightly smaller or wider, not wrapped.
 *  - **It is reduced to black and white here**, by threshold. A thermal head
 *    has one ink and no greys, and letting the printer's own driver decide
 *    produces a muddy dithered wordmark on some models and a clean one on
 *    others. A wordmark thresholded at the midpoint is legible on all of them.
 *  - **A logo that cannot be prepared is skipped, never fatal.** The receipt is
 *    the point; the logo is the header. Anything that throws in here returns
 *    null and the docket prints without it.
 */

/**
 * Dots across the head, by roll width. 203 dpi, which is the common case.
 *
 * `percent` is how much of that the owner wants the logo to take. The roll is
 * the only ruler that means anything: a size in millimetres or pixels would
 * come out different on each of the two paper widths, where "70% of the paper"
 * is the same thing on both.
 *
 * Clamped at both ends, because both ends are a wasted receipt: wider than the
 * paper tears the logo across two lines, and much under a fifth is a mark
 * nobody can identify and ink spent on nothing.
 */
export function logoDotWidth(paperWidth: number, percent = 100): number {
  const full = paperWidth === 58 ? 384 : 576;
  const bounded = Number.isFinite(percent) ? Math.min(100, Math.max(20, percent)) : 100;
  return Math.round((full * bounded) / 100);
}

/**
 * Black-and-white in place, by threshold, and **transparent pixels become
 * white**.
 *
 * A PNG logo on a transparent background is the ordinary case, and an alpha
 * channel a thermal printer does not understand is read as black on some
 * drivers — which prints the whole rectangle around the wordmark solid, using
 * a strip of the roll and a lot of ink.
 */
export function threshold(data: Uint8ClampedArray, cutoff = 160): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 255;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    // Perceptual grey: a mid-blue and a mid-yellow are not the same darkness
    // to a human eye, and a logo is read by one.
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    const on = alpha > 128 && grey < cutoff;
    const value = on ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
}

/** Scaled-to-fit height, capped so a tall logo cannot eat the roll. */
export function logoHeight(
  naturalWidth: number,
  naturalHeight: number,
  targetWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: targetWidth, height: Math.min(targetWidth, maxHeight) };
  }
  const height = Math.round((naturalHeight / naturalWidth) * targetWidth);
  if (height <= maxHeight) {
    return { width: targetWidth, height };
  }
  // Too tall for the header: keep the aspect ratio and give up the width.
  return { width: Math.round((naturalWidth / naturalHeight) * maxHeight), height: maxHeight };
}

const MAX_LOGO_HEIGHT_DOTS = 240;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // The bundled logo is same-origin; an owner's uploaded artwork is served by
    // the API, which allows this app's origin. Without it a cross-origin image
    // taints the canvas and `toDataURL` throws — a failure that reads as "the
    // logo just doesn't print".
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The logo image could not be loaded.'));
    image.src = src;
  });
}

/**
 * Base64 PNG, sized and thresholded for the roll — or **null**, which means
 * print the docket without a logo.
 */
export async function prepareLogo(
  src: string,
  paperWidth: number,
  widthPercent = 100,
): Promise<string | null> {
  try {
    const image = await loadImage(src);
    const target = logoDotWidth(paperWidth, widthPercent);
    const { width, height } = logoHeight(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      target,
      MAX_LOGO_HEIGHT_DOTS,
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    // White behind it: the roll is white and the printer has no concept of
    // "no ink here" beyond leaving the paper alone.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height);
    threshold(pixels.data);
    context.putImageData(pixels, 0, 0);

    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  } catch {
    // Never fatal. A missing logo is a plainer receipt; a thrown error here
    // would be a receipt that did not print at all.
    return null;
  }
}

/** Where the artwork comes from: the owner's, or the one the app ships with. */
export const BUNDLED_LOGO_URL = '/logo.jpeg';

export function logoSource(logoImageUrl: string | null | undefined): string {
  return logoImageUrl && logoImageUrl.trim().length > 0 ? logoImageUrl : BUNDLED_LOGO_URL;
}
