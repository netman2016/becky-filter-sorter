import { describe, expect, it } from 'vitest';
import type { RuleAnalysis } from '../../src/core';
import { badgesOf, matchesFilter } from '../../src/ui/warnings';

const analysis = (kind: RuleAnalysis['kind'], dup = false): RuleAnalysis => ({
  kind,
  severity: null,
  notApplicableReason: null,
  conditions: [],
  duplicates: dup ? [{ index: 1, firstIndex: 0 }] : [],
});

describe('バッジと絞り込み', () => {
  it('種類ごとにテキストのラベルを出し、重複は別バッジ', () => {
    expect(badgesOf(analysis('unreachable')).map((b) => b.label)).toEqual(['到達不能']);
    expect(badgesOf(analysis('partially-redundant', true)).map((b) => b.label)).toEqual(['一部冗長', '重複']);
    expect(badgesOf(analysis('none'))).toEqual([]);
    expect(badgesOf(analysis('not-applicable'))).toEqual([]);
  });

  it('警告あり = 何らかのバッジ。到達不能のみ = unreachable だけ', () => {
    expect(matchesFilter(analysis('none', true), 'warnings')).toBe(true);
    expect(matchesFilter(analysis('none'), 'warnings')).toBe(false);
    expect(matchesFilter(analysis('partially-unreachable'), 'unreachable')).toBe(false);
    expect(matchesFilter(analysis('unreachable'), 'unreachable')).toBe(true);
    expect(matchesFilter(undefined, 'all')).toBe(true);
  });
});
