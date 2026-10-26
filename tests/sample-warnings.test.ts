import { describe, expect, it } from 'vitest';
import { analyzeRules, parseIFilter } from '../src/core';
import { readSample } from './helpers';

describe('架空サンプルの警告', () => {
  const { doc } = parseIFilter(readSample());
  const ids = doc.rules.map((r) => r.id);
  const result = analyzeRules(doc.rules, ids);
  const kindAt = (no: number) => result.byId.get(ids[no - 1]!)!;

  it('各ルールの種類（番号は 1 始まり）', () => {
    expect(ids.map((_, i) => kindAt(i + 1).kind)).toEqual([
      'none', // 1
      'none', // 2
      'none', // 3
      'unreachable', // 4: From が 3 番（別の振り分け先）に遮蔽
      'none', // 5
      'none', // 6
      'unreachable', // 7: 6 番の @example.com に遮蔽
      'partially-redundant', // 8: From は 6 番と同じ振り分け先、To は自由
      'none', // 9
      'none', // 10
      'redundant-rule', // 11: 3 番と同じ振り分け先（大文字の From と [body]）
      'partially-unreachable', // 12: 5 番の Subject に遮蔽 + 自由
      'none', // 13: 同一ルール内の重複のみ
      'none', // 14
      'partially-unreachable', // 15: From は 14 番の * に遮蔽、[body] は * に覆われない
    ]);
  });

  it('覆う最初のルールと条件の index', () => {
    expect(kindAt(4).conditions).toEqual([{ kind: 'shadowed', byRuleId: ids[2], byConditionIndex: 0 }]);
    expect(kindAt(11).conditions).toEqual([
      { kind: 'redundant', byRuleId: ids[2], byConditionIndex: 0 },
      { kind: 'redundant', byRuleId: ids[2], byConditionIndex: 4 },
    ]);
    expect(kindAt(15).conditions).toEqual([
      { kind: 'shadowed', byRuleId: ids[13], byConditionIndex: 0 },
      { kind: 'free' },
    ]);
  });

  it('同一ルール内の重複と件数', () => {
    expect(kindAt(13).duplicates).toEqual([{ index: 1, firstIndex: 0 }]);
    expect(result.counts).toEqual({
      unreachable: 2,
      'redundant-rule': 1,
      'partially-unreachable': 2,
      'partially-redundant': 1,
      'not-applicable': 0,
      duplicate: 1,
    });
  });
});
