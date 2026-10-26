import { bytesEqual, compareBytes } from './bytes';
import { parseIFilter } from './parse';
import { serialize } from './serialize';
import type { FilterDocument } from './types';

/**
 * ids のルールをまとめて移動する。移動するルール同士の相対順は保つ。
 * toIndex は移動後の配列で先頭の移動ルールが置かれる位置（範囲外は丸める）。
 */
export function moveRules(order: readonly string[], ids: readonly string[], toIndex: number): string[] {
  const moving = new Set(ids);
  const picked = order.filter((id) => moving.has(id));
  const rest = order.filter((id) => !moving.has(id));
  const at = Math.max(0, Math.min(Math.trunc(toIndex), rest.length));
  return [...rest.slice(0, at), ...picked, ...rest.slice(at)];
}

/**
 * 保存前の検証（SPEC §5.7）。次の両方を満たすとき true。
 * - 読み込み順で出力すると、元のファイルとバイト完全一致する
 * - order で出力したものを再パースすると、ヘッダ・trailing が同一で、ルールの raw の多重集合が元と一致する
 *   （末尾 CRLF を補ったルールは、補った CRLF を除いて比較する）
 */
export function isOnlyReordered(
  original: Uint8Array,
  doc: FilterDocument,
  order: readonly string[],
): boolean {
  if (!bytesEqual(serialize(doc), original)) return false;

  let reparsed: FilterDocument;
  try {
    reparsed = parseIFilter(serialize(doc, order)).doc;
  } catch {
    return false;
  }
  if (reparsed.rules.length !== doc.rules.length) return false;
  if (!bytesEqual(serialize({ ...reparsed, rules: [] }), serialize({ ...doc, rules: [] }))) {
    return false;
  }

  const strip = (raw: Uint8Array) => stripFinalCRLF(raw);
  const before = doc.rules.map((r) => strip(r.raw)).sort(compareBytes);
  const after = reparsed.rules.map((r) => strip(r.raw)).sort(compareBytes);
  return before.every((raw, i) => bytesEqual(raw, after[i]!));
}

function stripFinalCRLF(raw: Uint8Array): Uint8Array {
  const n = raw.length;
  return n >= 2 && raw[n - 2] === 0x0d && raw[n - 1] === 0x0a ? raw.subarray(0, n - 2) : raw;
}
