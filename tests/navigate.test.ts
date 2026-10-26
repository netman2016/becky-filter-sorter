import { describe, expect, it } from 'vitest';
import {
  analyzeRules,
  hasWarningKind,
  nextWarningTarget,
  parseIFilter,
  WARNING_TARGET_KINDS,
  warningPosition,
  warningTargets,
  type RuleAnalysis,
  type RuleWarningKind,
} from '../src/core';
import { readSample } from './helpers';

/** 架空の判定結果を組み立てる（kind と、重複の有無だけを指定） */
function analysis(kind: RuleWarningKind, duplicate = false): RuleAnalysis {
  return {
    kind,
    severity: null,
    notApplicableReason: null,
    conditions: [],
    duplicates: duplicate ? [{ index: 1, firstIndex: 0 }] : [],
  };
}

// a b c d e f: 到達不能は b・d・f、重複は d・e（d は種類と重複の両方）
const order = ['a', 'b', 'c', 'd', 'e', 'f'];
const byId = new Map<string, RuleAnalysis>([
  ['a', analysis('none')],
  ['b', analysis('unreachable')],
  ['c', analysis('none')],
  ['d', analysis('unreachable', true)],
  ['e', analysis('partially-redundant', true)],
  ['f', analysis('unreachable')],
]);

describe('nextWarningTarget', () => {
  const next = (anchor: string | null, dir: 1 | -1 = 1) => nextWarningTarget(order, byId, 'unreachable', anchor, dir);

  it('anchor より後ろの最初の該当ルール（先頭・中間・末尾）', () => {
    expect(next('a')).toBe('b');
    expect(next('b')).toBe('d');
    expect(next('d')).toBe('f');
  });

  it('最後の該当の次は先頭へ循環する', () => {
    expect(next('f')).toBe('b');
  });

  it('前へは逆方向で、先頭の前は末尾へ循環する', () => {
    expect(next('d', -1)).toBe('b');
    expect(next('b', -1)).toBe('f');
    expect(next('a', -1)).toBe('f');
  });

  it('選択なし・anchor が順序に無いときは、先頭（前へなら末尾）から', () => {
    expect(next(null)).toBe('b');
    expect(next(null, -1)).toBe('f');
    expect(next('zz')).toBe('b');
    expect(next('zz', -1)).toBe('f');
  });

  it('anchor がその種類に該当しなければ、その位置から数える', () => {
    expect(next('c')).toBe('d');
    expect(next('e')).toBe('f');
    expect(next('c', -1)).toBe('b');
  });

  it('該当が 1 件だけなら自分自身へ循環し、0 件なら null', () => {
    expect(nextWarningTarget(order, byId, 'partially-redundant', 'e', 1)).toBe('e');
    expect(nextWarningTarget(order, byId, 'partially-redundant', 'a', -1)).toBe('e');
    expect(nextWarningTarget(order, byId, 'redundant-rule', 'a', 1)).toBeNull();
    expect(nextWarningTarget([], byId, 'unreachable', null, 1)).toBeNull();
  });

  it('重複は種類と独立で、両方に該当するルールは両方の対象になる', () => {
    expect(nextWarningTarget(order, byId, 'duplicate', null, 1)).toBe('d');
    expect(nextWarningTarget(order, byId, 'duplicate', 'd', 1)).toBe('e');
    expect(hasWarningKind(byId.get('d'), 'unreachable')).toBe(true);
    expect(hasWarningKind(byId.get('d'), 'duplicate')).toBe(true);
  });

  it('並び替えで順序が変わると、新しい順序で次が決まる', () => {
    const reordered = ['f', 'a', 'd', 'b', 'c', 'e'];
    expect(nextWarningTarget(reordered, byId, 'unreachable', 'a', 1)).toBe('d');
    expect(nextWarningTarget(reordered, byId, 'unreachable', 'b', 1)).toBe('f');
    expect(warningPosition(reordered, byId, 'unreachable', 'b')).toEqual({ index: 3, total: 3 });
  });
});

describe('warningPosition', () => {
  it('該当するルールは 1 始まりの番号、該当しない・選択なしは null', () => {
    expect(warningPosition(order, byId, 'unreachable', 'b')).toEqual({ index: 1, total: 3 });
    expect(warningPosition(order, byId, 'unreachable', 'f')).toEqual({ index: 3, total: 3 });
    expect(warningPosition(order, byId, 'unreachable', 'c')).toEqual({ index: null, total: 3 });
    expect(warningPosition(order, byId, 'unreachable', null)).toEqual({ index: null, total: 3 });
    expect(warningPosition(order, byId, 'redundant-rule', 'a')).toEqual({ index: null, total: 0 });
  });
});

describe('架空サンプルでの件数', () => {
  it('warningTargets の件数は analyzeRules の counts と一致する', () => {
    const { doc } = parseIFilter(readSample());
    const ids = doc.rules.map((r) => r.id);
    const result = analyzeRules(doc.rules, ids);
    for (const kind of WARNING_TARGET_KINDS) {
      expect(warningTargets(ids, result.byId, kind).length).toBe(result.counts[kind]);
    }
  });
});
