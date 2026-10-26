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
 * ids のルールを delta だけずらす（Alt+↑/↓ 用）。選択が飛び飛びでも間隔を保つ。
 * 端に達したルールはそこで止まり、そのすぐ隣の選択ルールも止まる。
 */
export function moveRulesBy(order: readonly string[], ids: readonly string[], delta: number): string[] {
  const moving = new Set(ids);
  const out = [...order];
  const steps = Math.abs(Math.trunc(delta));
  for (let s = 0; s < steps; s++) {
    if (delta < 0) {
      for (let i = 1; i < out.length; i++) {
        if (moving.has(out[i]!) && !moving.has(out[i - 1]!)) {
          [out[i - 1], out[i]] = [out[i]!, out[i - 1]!];
        }
      }
    } else {
      for (let i = out.length - 2; i >= 0; i--) {
        if (moving.has(out[i]!) && !moving.has(out[i + 1]!)) {
          [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
        }
      }
    }
  }
  return out;
}

/**
 * 「最小の移動数」で数えた、移動したルールの ID（SPEC §5.7）。
 * 元の順序を保つ最長の部分列（LIS）に入らないルールを「移動した」とする。
 * 同じ長さの候補が複数あるときは、元の番号の並びが辞書順で最小の候補を「動いていない側」とする。
 */
export function movedRuleIds(originalOrder: readonly string[], order: readonly string[]): Set<string> {
  const originalIndex = new Map(originalOrder.map((id, i) => [id, i]));
  const seq = order.map((id) => originalIndex.get(id) ?? -1);
  const n = seq.length;

  // longest[i]: 位置 i から始まる増加部分列の最大長
  const longest = new Array<number>(n).fill(1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) {
      if (seq[j]! > seq[i]! && longest[j]! + 1 > longest[i]!) longest[i] = longest[j]! + 1;
    }
  }

  // 先頭から、残りの長さを満たせる候補のうち元の番号が最小のものを選ぶ
  const kept = new Set<string>();
  let pos = -1;
  let prev = -Infinity;
  for (let remaining = n === 0 ? 0 : Math.max(...longest); remaining > 0; remaining--) {
    let best = -1;
    for (let p = pos + 1; p < n; p++) {
      if (seq[p]! > prev && longest[p]! >= remaining && (best < 0 || seq[p]! < seq[best]!)) best = p;
    }
    kept.add(order[best]!);
    pos = best;
    prev = seq[best]!;
  }
  return new Set(order.filter((id) => !kept.has(id)));
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
