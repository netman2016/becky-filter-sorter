// 並び順による警告判定（SPEC §5.6）。Becky! の仕様の推測にもとづく目安。
// 結果にはテキストやフォルダ名を持たせず、ルール id と条件の index で参照する。
// パース警告（ParseWarning）とは別の仕組み。
import type { Condition, Rule } from './types';

/** フィールド集合。names は小文字化した名前で、"*" と "[body]" は含めない */
export type FieldSet = { star: boolean; body: boolean; names: ReadonlySet<string> };

export type ConditionStatus =
  | { kind: 'free' }
  | { kind: 'shadowed' | 'redundant'; byRuleId: string; byConditionIndex: number };

export type RuleWarningKind =
  | 'unreachable'
  | 'redundant-rule'
  | 'partially-unreachable'
  | 'partially-redundant'
  | 'none'
  /** 条件 0 件、または振り分け先なし */
  | 'not-applicable';

export type RuleAnalysis = {
  kind: RuleWarningKind;
  /** 到達不能・一部到達不能 = warning、冗長系 = info */
  severity: 'warning' | 'info' | null;
  notApplicableReason: 'no-conditions' | 'no-destination' | null;
  /** 条件の index に対応する状態。判定対象外のルールでは空 */
  conditions: ConditionStatus[];
  /** 同一ルール内の重複。index の条件は firstIndex の条件と同一 */
  duplicates: { index: number; firstIndex: number }[];
};

export type WarningCounts = Record<Exclude<RuleWarningKind, 'none'>, number> & { duplicate: number };

export type RuleWarnings = { byId: ReadonlyMap<string, RuleAnalysis>; counts: WarningCounts };

const BODY = '[body]';
const STAR = '*';

export function parseFieldSet(field: string): FieldSet {
  let star = false;
  let body = false;
  const names = new Set<string>();
  for (const part of field.split(',')) {
    const name = part.trim().toLowerCase();
    if (name === '') continue;
    if (name === STAR) star = true;
    else if (name === BODY) body = true;
    else names.add(name);
  }
  return { star, body, names };
}

/** a が b を包含するか（"*" は本文以外のすべてのヘッダ、"[body]" は本文だけ） */
export function fieldSetCovers(a: FieldSet, b: FieldSet): boolean {
  if (b.body && !a.body) return false;
  if (b.star && !a.star) return false;
  if (a.star) return true;
  for (const name of b.names) if (!a.names.has(name)) return false;
  return true;
}

type Prepared = { fields: FieldSet; text: string };

function prepare(c: Condition): Prepared {
  return { fields: parseFieldSet(c.field), text: c.text.toLowerCase() };
}

function preparedCovers(a: Prepared, b: Prepared): boolean {
  // テキストが空の条件は覆う側として使わない
  return a.text !== '' && b.text.includes(a.text) && fieldSetCovers(a.fields, b.fields);
}

/** 条件 a が条件 b を覆うか（a のテキストが b の部分文字列、かつ a のフィールド集合が b を包含） */
export function conditionCovers(a: Condition, b: Condition): boolean {
  return preparedCovers(prepare(a), prepare(b));
}

function sameFieldSet(a: FieldSet, b: FieldSet): boolean {
  return a.star === b.star && a.body === b.body && a.names.size === b.names.size && [...a.names].every((n) => b.names.has(n));
}

function findDuplicates(prepared: Prepared[]): { index: number; firstIndex: number }[] {
  const out: { index: number; firstIndex: number }[] = [];
  prepared.forEach((c, index) => {
    const firstIndex = prepared.findIndex((d) => d.text === c.text && sameFieldSet(d.fields, c.fields));
    if (firstIndex < index) out.push({ index, firstIndex });
  });
  return out;
}

function classify(statuses: ConditionStatus[]): RuleWarningKind {
  const shadowed = statuses.some((s) => s.kind === 'shadowed');
  const redundant = statuses.some((s) => s.kind === 'redundant');
  const free = statuses.some((s) => s.kind === 'free');
  if (!free && shadowed) return 'unreachable';
  if (!free && redundant) return 'redundant-rule';
  if (free && shadowed) return 'partially-unreachable';
  if (free && redundant) return 'partially-redundant';
  return 'none';
}

const SEVERITY: Record<RuleWarningKind, RuleAnalysis['severity']> = {
  unreachable: 'warning',
  'partially-unreachable': 'warning',
  'redundant-rule': 'info',
  'partially-redundant': 'info',
  none: null,
  'not-applicable': null,
};

/**
 * order の順で全ルールの警告を判定する。並び替えのたびに呼び直す前提の純関数。
 * order に無いルール id は無視する。
 */
export function analyzeRules(rules: readonly Rule[], order: readonly string[]): RuleWarnings {
  const byRuleId = new Map(rules.map((r) => [r.id, r]));
  const ordered = order.map((id) => byRuleId.get(id)).filter((r): r is Rule => r !== undefined);

  // 事前計算: フィールド集合と小文字化したテキスト
  const prepared = ordered.map((r) => r.conditions.map(prepare));
  const applicable = ordered.map((r) => r.conditions.length > 0 && r.destFolder + r.destMailbox !== '');

  const counts: WarningCounts = {
    unreachable: 0,
    'redundant-rule': 0,
    'partially-unreachable': 0,
    'partially-redundant': 0,
    'not-applicable': 0,
    duplicate: 0,
  };
  const byId = new Map<string, RuleAnalysis>();

  ordered.forEach((rule, j) => {
    const conds = prepared[j]!;
    const duplicates = findDuplicates(conds);
    if (duplicates.length > 0) counts.duplicate++;

    if (!applicable[j]) {
      counts['not-applicable']++;
      byId.set(rule.id, {
        kind: 'not-applicable',
        severity: null,
        notApplicableReason: rule.conditions.length === 0 ? 'no-conditions' : 'no-destination',
        conditions: [],
        duplicates,
      });
      return;
    }

    const statuses = conds.map((b): ConditionStatus => {
      for (let i = 0; i < j; i++) {
        if (!applicable[i]) continue;
        const k = prepared[i]!.findIndex((a) => preparedCovers(a, b));
        if (k < 0) continue;
        const coverer = ordered[i]!;
        const sameDest = coverer.destMailbox === rule.destMailbox && coverer.destFolder === rule.destFolder;
        return { kind: sameDest ? 'redundant' : 'shadowed', byRuleId: coverer.id, byConditionIndex: k };
      }
      return { kind: 'free' };
    });

    const kind = classify(statuses);
    if (kind !== 'none') counts[kind]++;
    byId.set(rule.id, { kind, severity: SEVERITY[kind], notApplicableReason: null, conditions: statuses, duplicates });
  });

  return { byId, counts };
}
