// 警告の種類ごとに、該当ルールを順に選ぶための純関数（SPEC §5.6）。
// 位置（並び順の中の場所）から毎回求めるので、並び替え・Undo/Redo・再計算で「何番目」を持ち回らない。
import type { RuleAnalysis } from './warnings';

/** クリックで順次選択できる警告の種類（判定対象外は含めない） */
export type WarningTargetKind =
  | 'unreachable'
  | 'partially-unreachable'
  | 'redundant-rule'
  | 'partially-redundant'
  | 'duplicate';

export const WARNING_TARGET_KINDS: readonly WarningTargetKind[] = [
  'unreachable',
  'partially-unreachable',
  'redundant-rule',
  'partially-redundant',
  'duplicate',
];

/** ルールがその種類に該当するか。duplicate（同一ルール内の重複）は種類（kind）と独立に判定する */
export function hasWarningKind(analysis: RuleAnalysis | undefined, kind: WarningTargetKind): boolean {
  if (!analysis) return false;
  return kind === 'duplicate' ? analysis.duplicates.length > 0 : analysis.kind === kind;
}

/** 該当ルールの ID（全体の並び順）。件数は analyzeRules の counts[kind] と一致する */
export function warningTargets(
  order: readonly string[],
  byId: ReadonlyMap<string, RuleAnalysis>,
  kind: WarningTargetKind,
): string[] {
  return order.filter((id) => hasWarningKind(byId.get(id), kind));
}

/**
 * 次（direction=1）/ 前（-1）の該当ルール。anchorId の位置より厳密に後ろ（前）にある最初の該当ルールで、
 * 無ければ循環して先頭（末尾）の該当ルール。anchorId が null か order に無いときは、先頭（前なら末尾）から数える。
 * 該当が 0 件なら null。
 */
export function nextWarningTarget(
  order: readonly string[],
  byId: ReadonlyMap<string, RuleAnalysis>,
  kind: WarningTargetKind,
  anchorId: string | null,
  direction: 1 | -1,
): string | null {
  const n = order.length;
  if (n === 0) return null;
  const anchor = anchorId === null ? -1 : order.indexOf(anchorId);
  // anchor が無いときは、先頭の手前（前へなら末尾の後ろ）にあるものとして数える
  const start = anchor >= 0 ? anchor : direction === 1 ? -1 : n;
  for (let step = 1; step <= n; step++) {
    const i = (((start + direction * step) % n) + n) % n;
    const id = order[i]!;
    if (hasWarningKind(byId.get(id), kind)) return id;
  }
  return null;
}

/**
 * 位置表示「k / N」。currentId がその種類に該当すれば index は 1 始まりの番号、
 * 該当しないか null なら index は null（画面では「- / N」）。
 */
export function warningPosition(
  order: readonly string[],
  byId: ReadonlyMap<string, RuleAnalysis>,
  kind: WarningTargetKind,
  currentId: string | null,
): { index: number | null; total: number } {
  const targets = warningTargets(order, byId, kind);
  const at = currentId === null ? -1 : targets.indexOf(currentId);
  return { index: at >= 0 ? at + 1 : null, total: targets.length };
}
