import { ParseError } from './errors';

const CR = 0x0d;
const LF = 0x0a;

export type LineSpan = {
  /** 行頭のオフセット */
  start: number;
  /** 行末（CRLF を含まない）のオフセット */
  end: number;
  /** 次の行頭のオフセット（CRLF を含む行末） */
  next: number;
};

/**
 * CRLF で行に分割する。単独の LF / CR があれば ParseError。
 * CP932 では CR / LF が 2 バイト目に現れないため、バイト列上で分割してよい。
 * 末尾に CRLF が無い最終行は end === next となる。
 */
export function splitLinesCRLF(bytes: Uint8Array): LineSpan[] {
  const lines: LineSpan[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === LF) throw new ParseError('bare-lf', lines.length + 1);
    if (b === CR) {
      if (bytes[i + 1] !== LF) throw new ParseError('bare-cr', lines.length + 1);
      lines.push({ start, end: i, next: i + 2 });
      i++;
      start = i + 1;
    }
  }
  if (start < bytes.length) lines.push({ start, end: bytes.length, next: bytes.length });
  return lines;
}

export function endsWithCRLF(bytes: Uint8Array): boolean {
  const n = bytes.length;
  return n >= 2 && bytes[n - 2] === CR && bytes[n - 1] === LF;
}

/** bytes の offset 位置から ASCII 文字列 prefix が始まるか */
export function startsWithAscii(bytes: Uint8Array, offset: number, prefix: string): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** 最初に異なるオフセット。完全一致なら -1（長さだけ違う場合は短い方の長さ） */
export function firstMismatch(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return firstMismatch(a, b) === -1;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

export const CRLF_BYTES: Uint8Array = new Uint8Array([CR, LF]);
