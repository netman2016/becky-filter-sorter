import { describe, expect, it } from 'vitest';
import { movedRuleIds, moveRules, moveRulesBy } from '../src/core';
import { seededRandom, shuffle } from './helpers';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `#${i + 1}`);
const sorted = (s: Set<string>) => [...s].sort();

describe('movedRuleIds（最小の移動数）', () => {
  it('変更なしなら 0 件', () => {
    expect(movedRuleIds(ids(5), ids(5)).size).toBe(0);
    expect(movedRuleIds([], []).size).toBe(0);
  });

  it('1 件を末尾から先頭へ → 1 件', () => {
    const order = moveRules(ids(5), ['#5'], 0);
    expect(sorted(movedRuleIds(ids(5), order))).toEqual(['#5']);
  });

  it('反転 → n−1 件', () => {
    expect(movedRuleIds(ids(6), [...ids(6)].reverse()).size).toBe(5);
  });

  describe('タイブレーク: 元の番号が小さいほうを「動いていない側」に残す', () => {
    it('2 件の入れ替え: 元 #1 を残し、元 #2 を移動とする', () => {
      expect(sorted(movedRuleIds(ids(2), ['#2', '#1']))).toEqual(['#2']);
    });

    it('元 #3,#4,#1,#2 の順: #1,#2 を残し、#3,#4 を移動とする', () => {
      expect(sorted(movedRuleIds(ids(4), ['#3', '#4', '#1', '#2']))).toEqual(['#3', '#4']);
    });

    it('反転では元 #1 だけを残す', () => {
      const moved = movedRuleIds(ids(6), [...ids(6)].reverse());
      expect(moved.has('#1')).toBe(false);
    });

    it('同じ入力なら何度呼んでも同じ結果（決定的）', () => {
      const rand = seededRandom(7);
      for (let n = 0; n < 20; n++) {
        const order = shuffle(ids(30), rand);
        const first = sorted(movedRuleIds(ids(30), order));
        for (let k = 0; k < 3; k++) expect(sorted(movedRuleIds(ids(30), order))).toEqual(first);
      }
    });
  });

  it('残す側は元の順序で増加し、件数は総当たりの LIS と一致する', () => {
    const rand = seededRandom(11);
    for (let t = 0; t < 30; t++) {
      const original = ids(9);
      const order = shuffle(original, rand);
      const moved = movedRuleIds(original, order);
      const kept = order.filter((id) => !moved.has(id)).map((id) => original.indexOf(id));
      expect(kept).toEqual([...kept].sort((a, b) => a - b));
      expect(kept.length).toBe(bruteForceLis(order.map((id) => original.indexOf(id))));
    }
  });
});

function bruteForceLis(seq: number[]): number {
  let best = 0;
  for (let mask = 0; mask < 1 << seq.length; mask++) {
    const sub = seq.filter((_, i) => mask & (1 << i));
    if (sub.every((v, i) => i === 0 || sub[i - 1]! < v)) best = Math.max(best, sub.length);
  }
  return best;
}

describe('moveRulesBy', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('1 件を上下に 1 つずつ', () => {
    expect(moveRulesBy(order, ['c'], -1)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(moveRulesBy(order, ['c'], 1)).toEqual(['a', 'b', 'd', 'c', 'e']);
  });

  it('飛び飛びの選択は間隔を保ってずらす', () => {
    expect(moveRulesBy(order, ['b', 'd'], -1)).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(moveRulesBy(order, ['b', 'd'], 1)).toEqual(['a', 'c', 'b', 'e', 'd']);
  });

  it('端では止まり、隣接する選択も止まる', () => {
    expect(moveRulesBy(order, ['a'], -1)).toEqual(order);
    expect(moveRulesBy(order, ['a', 'b'], -1)).toEqual(order);
    expect(moveRulesBy(order, ['a', 'c'], -1)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(moveRulesBy(order, ['e'], 1)).toEqual(order);
  });

  it('delta が 2 以上なら繰り返す。元の配列は変更しない', () => {
    const copy = [...order];
    expect(moveRulesBy(order, ['e'], -3)).toEqual(['a', 'e', 'b', 'c', 'd']);
    expect(order).toEqual(copy);
  });
});

describe('moveRulesBy（|delta| ≥ 2: 1 つずつの移動のくり返し）', () => {
  /** 定義どおりの参照実装: delta=±1 を最大 |delta| 回くり返し、変化しなくなったら止める */
  function stepwise(order: string[], ids: string[], delta: number): string[] {
    let cur = order;
    for (let s = 0; s < Math.abs(delta); s++) {
      const next = moveRulesBy(cur, ids, Math.sign(delta));
      if (next.every((id, i) => id === cur[i])) break;
      cur = next;
    }
    return cur;
  }

  it('ランダムな順序・選択（飛び飛び・端を含む）で、くり返しと一致する', () => {
    const rand = seededRandom(20261027);
    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + Math.floor(rand() * 30);
      const order = shuffle(
        Array.from({ length: n }, (_, i) => `r${i}`),
        rand,
      );
      const ids = order.filter(() => rand() < 0.25);
      if (ids.length === 0) ids.push(order[Math.floor(rand() * n)]!);
      for (const delta of [-n - 3, -10, -5, -2, 2, 5, 10, n + 3]) {
        expect(moveRulesBy(order, ids, delta)).toEqual(stepwise(order, ids, delta));
      }
    }
  });

  it('端に当たったらそこで止まり、飛び飛びの選択は止まらなかった行だけ進む', () => {
    const order = Array.from({ length: 15 }, (_, i) => `r${i + 1}`);
    // 2 件目を 10 件上 → 先頭で止まる
    expect(moveRulesBy(order, ['r2'], -10)[0]).toBe('r2');
    // 末尾から 5 件目を 10 件下 → 末尾で止まる
    expect(moveRulesBy(order, ['r11'], 10).at(-1)).toBe('r11');
    // 先頭と 4 件目を 10 件上 → 先頭は動かず、4 件目はその直後まで詰まる
    expect(moveRulesBy(order, ['r1', 'r4'], -10).slice(0, 3)).toEqual(['r1', 'r4', 'r2']);
    // 間隔があれば保ったまま 10 件動く
    const moved = moveRulesBy(order, ['r12', 'r14'], -10);
    expect([moved.indexOf('r12'), moved.indexOf('r14')]).toEqual([1, 3]);
  });

  it('1 件も動かせないときは順序が変わらない', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(moveRulesBy(order, ['a', 'b'], -10)).toEqual(order);
    expect(moveRulesBy(order, ['c', 'd'], 10)).toEqual(order);
    expect(moveRulesBy(order, [], 10)).toEqual(order);
  });
});
