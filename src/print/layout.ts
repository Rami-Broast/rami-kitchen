/**
 * Laying text out on a narrow roll — the part both printed documents share.
 *
 * Every line that reaches the printer goes through here. A thermal printer
 * wraps an overlong line itself, at the column, mid-word and hard against the
 * left margin, so a note or a long dish name breaks in a way that reads as a
 * new item and a cook loses which line they were on. Nothing may be handed to
 * it unwrapped.
 *
 * Pure and tested, and shared by the kitchen ticket and the customer docket so
 * a fix to the wrapping cannot land on one and not the other.
 */
import { OrderItem, OrderItemModifier } from '../api/types';

export function rule(width: number, ch = '-'): string {
  return ch.repeat(width);
}

export function itemLine(qty: number, name: string): string {
  return `${String(qty).padStart(2, ' ')} x ${name}`;
}

/**
 * Wraps to the roll width, carrying `indent` onto every continued line.
 *
 * Nothing may reach the printer unwrapped. A thermal printer wraps an
 * overlong line itself, at the column, mid-word and hard against the left
 * edge — so a note or a long dish name breaks in a way that reads as a new
 * item and a cook loses which line they were on.
 */
export function wrapTo(text: string, width: number, indent = ''): string[] {
  const limit = Math.max(1, width);
  // The leading spaces are the line's own indent (an add-on sits under its
  // item), and are kept on the first line; `indent` is what continued lines
  // carry, so a wrapped add-on still reads as part of the item above it.
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const prefix = lines.length === 0 ? lead : indent;
    const candidate = current.length === 0 ? `${prefix}${word}` : `${current} ${word}`;

    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
      current = '';
    }
    // A single word longer than the roll (a URL, a run of digits) is cut
    // rather than left to the printer, which would drop it against the margin.
    let rest = word;
    const head = lines.length === 0 ? lead : indent;
    while (head.length + rest.length > limit) {
      lines.push(`${head}${rest.slice(0, Math.max(1, limit - head.length))}`);
      rest = rest.slice(Math.max(1, limit - head.length));
    }
    current = `${head}${rest}`;
  }

  if (current.length > 0) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

/**
 * A left label and a right-aligned amount on one line.
 *
 * The label wraps if it has to, and the amount lands on the last line it fits
 * on — never overtyped, never pushed off the roll.
 */
export function amountLine(label: string, amount: string | null, width: number, indent = ''): string[] {
  if (amount === null) {
    return wrapTo(label, width, indent);
  }
  const lines = wrapTo(label, Math.max(1, width - amount.length - 1), indent);
  const last = lines[lines.length - 1] ?? '';
  const gap = width - last.length - amount.length;

  if (gap >= 1) {
    lines[lines.length - 1] = `${last}${' '.repeat(gap)}${amount}`;
  } else {
    lines.push(`${' '.repeat(Math.max(0, width - amount.length))}${amount}`);
  }
  return lines;
}

/**
 * The placing time, to the second, in a fixed `DD/MM/YYYY HH:MM:SS`.
 *
 * Deliberately not `toLocaleString()`: that renders in whatever locale the
 * counter machine happens to carry, which on a default install is US
 * month-first — so 09/10 is read as one date by the till and another by the
 * branch, and nothing on the ticket says which. Seconds are printed because
 * two orders a minute apart is an ordinary evening.
 */
export function orderTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function itemLabel(item: OrderItem): string {
  return item.variantName ? `${item.productName} (${item.variantName})` : item.productName;
}

export function modifierLabel(mod: OrderItemModifier): string {
  return `+ ${mod.quantity > 1 ? `${mod.quantity}x ` : ''}${mod.addonName}`;
}


/** Centres a line on the roll. Left-aligned when it is too long to centre. */
export function center(text: string, width: number): string {
  const pad = Math.floor((width - text.length) / 2);
  return pad > 0 ? `${' '.repeat(pad)}${text}` : text;
}

/** Centres each line of a wrapped block. */
export function centerBlock(text: string, width: number): string[] {
  return wrapTo(text, width).map((line) => center(line.trim(), width));
}
