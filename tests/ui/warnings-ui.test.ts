import { describe, expect, it } from 'vitest';
import type { RuleAnalysis } from '../../src/core';
import { badgesOf, filterAfterJump, matchesFilter, warningJumpMessage } from '../../src/ui/warnings';

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

describe('ジャンプ後の絞り込み（filterAfterJump）', () => {
  // 絞り込みの条件に合う行（「（絞り込み外）」として残している選択行は含めない）
  const matching = new Set(['b', 'd']);

  it('移動先が表示中なら絞り込みを保ち、非表示なら「すべて」に戻す', () => {
    expect(filterAfterJump('unreachable', 'b', matching)).toBe('unreachable');
    expect(filterAfterJump('warnings', 'c', matching)).toBe('all');
    expect(filterAfterJump('all', 'c', matching)).toBe('all');
  });

  it('「（絞り込み外）」として表示中の選択行へのジャンプも「すべて」に戻す（既存の #N ジャンプと同じ）', () => {
    // 'e' は選択中のため一覧には残っているが、条件には合わない
    expect(filterAfterJump('unreachable', 'e', matching)).toBe('all');
  });

  it('既存の #N ジャンプの判定（matchesFilter）と同じ結果になる', () => {
    const byId = new Map([
      ['b', analysis('unreachable')],
      ['c', analysis('redundant-rule')],
      ['d', analysis('none', true)],
      ['e', analysis('none')],
    ]);
    for (const filter of ['all', 'warnings', 'unreachable'] as const) {
      const set = new Set([...byId].filter(([, a]) => matchesFilter(a, filter)).map(([id]) => id));
      for (const [id, a] of byId) {
        const before = matchesFilter(a, filter) ? filter : 'all';
        expect(filterAfterJump(filter, id, set)).toBe(before);
      }
    }
  });
});

describe('警告ジャンプの通知文', () => {
  it('種類・件数・何件目かを含む', () => {
    expect(warningJumpMessage('unreachable', 2, 3)).toBe('到達不能 3件中2件目を選択しました');
    expect(warningJumpMessage('duplicate', 1, 1)).toBe('重複 1件中1件目を選択しました');
  });
});
