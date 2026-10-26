import type { ConditionStatus, RuleAnalysis, RuleWarningKind, WarningTargetKind } from '../core';

export type WarningFilter = 'all' | 'warnings' | 'unreachable';

export const FILTER_LABELS: Record<WarningFilter, string> = {
  all: 'すべて',
  warnings: '警告あり',
  unreachable: '到達不能のみ',
};

type Badge = { label: string; className: string; title: string };

const KIND_BADGES: Partial<Record<RuleWarningKind, Badge>> = {
  unreachable: {
    label: '到達不能',
    className: 'badge badge-strong',
    title: 'すべての条件が先行ルールに覆われ、少なくとも 1 つは別の振り分け先に先に当たります',
  },
  'partially-unreachable': {
    label: '一部到達不能',
    className: 'badge badge-warn',
    title: '一部の条件が、別の振り分け先の先行ルールに先に当たります',
  },
  'redundant-rule': {
    label: '冗長',
    className: 'badge badge-quiet',
    title: 'すべての条件が、同じ振り分け先の先行ルールに覆われています',
  },
  'partially-redundant': {
    label: '一部冗長',
    className: 'badge badge-quiet',
    title: '一部の条件が、同じ振り分け先の先行ルールに覆われています',
  },
};

const DUPLICATE_BADGE: Badge = {
  label: '重複',
  className: 'badge badge-quiet',
  title: '同じルールの中に、同一の条件が複数あります',
};

/** 警告の件数サマリーで、クリックして順次選択できる種類のバッジ */
export const WARNING_TARGET_BADGES: Record<WarningTargetKind, Badge> = {
  unreachable: KIND_BADGES.unreachable!,
  'partially-unreachable': KIND_BADGES['partially-unreachable']!,
  'redundant-rule': KIND_BADGES['redundant-rule']!,
  'partially-redundant': KIND_BADGES['partially-redundant']!,
  duplicate: DUPLICATE_BADGE,
};

/** 行に表示するバッジ（色だけに頼らずラベルを出す） */
export function badgesOf(analysis: RuleAnalysis | undefined): Badge[] {
  if (!analysis) return [];
  const badges: Badge[] = [];
  const kind = KIND_BADGES[analysis.kind];
  if (kind) badges.push(kind);
  if (analysis.duplicates.length > 0) badges.push(DUPLICATE_BADGE);
  return badges;
}

export function matchesFilter(analysis: RuleAnalysis | undefined, filter: WarningFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unreachable') return analysis?.kind === 'unreachable';
  return badgesOf(analysis).length > 0;
}

/**
 * ジャンプしたあとの絞り込み。移動先が表示中なら今の絞り込みのまま、非表示なら「すべて」に戻す。
 * visibleIds は絞り込みの条件に合う行の集合で、「（絞り込み外）」として残している選択行は含めない。
 */
export function filterAfterJump(
  current: WarningFilter,
  targetId: string,
  visibleIds: ReadonlySet<string>,
): WarningFilter {
  return current === 'all' || visibleIds.has(targetId) ? current : 'all';
}

/** 警告の種類から順次選択したときの、スクリーンリーダー向けの通知文 */
export function warningJumpMessage(kind: WarningTargetKind, index: number, total: number): string {
  return `${WARNING_TARGET_BADGES[kind].label} ${total}件中${index}件目を選択しました`;
}

export const STATUS_LABELS: Record<ConditionStatus['kind'], string> = {
  free: '自由',
  shadowed: '遮蔽',
  redundant: '冗長',
};

export const ESTIMATE_NOTE = '警告は Becky! の仕様の推測にもとづく目安です';
