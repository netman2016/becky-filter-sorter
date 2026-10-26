import { describe, expect, it } from 'vitest';
import {
  analyzeRules,
  conditionCovers,
  fieldSetCovers,
  parseFieldSet,
  type Condition,
  type Rule,
} from '../src/core';
import { seededRandom, shuffle } from './helpers';

const cond = (field: string, text: string): Condition => ({ field, text, flags: ['O', 'I'], raw: new Uint8Array() });

let seq = 0;
/** 架空のルール。dest は振り分け先フォルダ（'' なら振り分け先なし） */
function rule(dest: string, conditions: [string, string][], id = `r${++seq}`): Rule {
  return {
    id,
    originalIndex: 0,
    raw: new Uint8Array(),
    destMailbox: dest ? '0000abcd.mb' : '',
    destFolder: dest,
    conditions: conditions.map(([f, t]) => cond(f, t)),
    unknownLines: [],
  };
}

function analyze(rules: Rule[], order = rules.map((r) => r.id)) {
  return analyzeRules(rules, order);
}

describe('フィールド集合', () => {
  it('カンマで分割し、前後の空白を除き、小文字化する', () => {
    const fs = parseFieldSet(' From,  Sender ,X-Sender ');
    expect([...fs.names].sort()).toEqual(['from', 'sender', 'x-sender']);
    expect(fs.star).toBe(false);
    expect(fs.body).toBe(false);
    expect(parseFieldSet('*')).toEqual({ star: true, body: false, names: new Set() });
    expect(parseFieldSet('[Body]')).toEqual({ star: false, body: true, names: new Set() });
  });

  it('未知のフィールド名・空の要素・混在もエラーにしない', () => {
    expect([...parseFieldSet('X-Custom').names]).toEqual(['x-custom']);
    expect(parseFieldSet(',,').names.size).toBe(0);
    const mixed = parseFieldSet('*, [body]');
    expect(mixed.star && mixed.body).toBe(true);
  });

  it('包含: 「From, Sender, X-Sender」は「From」を覆い、逆は覆わない', () => {
    expect(fieldSetCovers(parseFieldSet('From, Sender, X-Sender'), parseFieldSet('From'))).toBe(true);
    expect(fieldSetCovers(parseFieldSet('From'), parseFieldSet('From, Sender, X-Sender'))).toBe(false);
  });

  it('「*」は本文以外のすべてのヘッダと「*」を覆い、[body] は覆わない', () => {
    const star = parseFieldSet('*');
    for (const f of ['From', 'Subject', 'To', 'From, Sender, X-Sender', 'X-Custom', '*']) {
      expect(fieldSetCovers(star, parseFieldSet(f)), f).toBe(true);
    }
    expect(fieldSetCovers(star, parseFieldSet('[body]'))).toBe(false);
    expect(fieldSetCovers(star, parseFieldSet('From, [body]'))).toBe(false);
    expect(fieldSetCovers(parseFieldSet('From'), star)).toBe(false);
  });

  it('[body] は [body] とだけ対応する', () => {
    const body = parseFieldSet('[body]');
    expect(fieldSetCovers(body, body)).toBe(true);
    expect(fieldSetCovers(body, parseFieldSet('From'))).toBe(false);
    expect(fieldSetCovers(parseFieldSet('From'), body)).toBe(false);
    expect(fieldSetCovers(parseFieldSet('*, [body]'), body)).toBe(true);
  });
});

describe('conditionCovers', () => {
  it('同一フィールド・同一文字列・部分文字列', () => {
    expect(conditionCovers(cond('From', 'a@example.com'), cond('From', 'a@example.com'))).toBe(true);
    expect(conditionCovers(cond('From', '@example.com'), cond('From', 'sales@example.com'))).toBe(true);
    expect(conditionCovers(cond('From', 'sales@example.com'), cond('From', '@example.com'))).toBe(false);
    expect(conditionCovers(cond('From', '@example.com'), cond('Subject', 'x@example.com'))).toBe(false);
  });

  it('テキストもフィールド名も大文字小文字を区別しない（全角半角は正規化しない）', () => {
    expect(conditionCovers(cond('from', 'NEWS@Example.org'), cond('FROM', 'news@example.ORG'))).toBe(true);
    expect(conditionCovers(cond('Subject', 'ＡＢＣ'), cond('Subject', 'ABC'))).toBe(false);
  });

  it('* は本文以外を覆い、[body] は覆わない', () => {
    expect(conditionCovers(cond('*', '@example.jp'), cond('From, Sender, X-Sender', 'info@example.jp'))).toBe(true);
    expect(conditionCovers(cond('*', '@example.jp'), cond('[body]', 'info@example.jp'))).toBe(false);
  });

  it('未知のフィールド名も集合の規則で扱う', () => {
    expect(conditionCovers(cond('X-Custom', 'abc'), cond('x-custom', 'xabcx'))).toBe(true);
    expect(conditionCovers(cond('*', 'abc'), cond('X-Custom', 'abc'))).toBe(true);
    expect(conditionCovers(cond('X-Custom', 'abc'), cond('From', 'abc'))).toBe(false);
  });

  it('テキストが空の条件は覆う側として使わない。覆われる側としては判定される', () => {
    expect(conditionCovers(cond('Subject', ''), cond('Subject', 'abc'))).toBe(false);
    expect(conditionCovers(cond('Subject', ''), cond('Subject', ''))).toBe(false);
    const rules = [rule('A', [['Subject', '']]), rule('B', [['Subject', 'abc']]), rule('C', [['Subject', '']])];
    const r = analyze(rules);
    expect(r.byId.get(rules[1]!.id)!.kind).toBe('none');
    expect(r.byId.get(rules[2]!.id)!.conditions).toEqual([{ kind: 'free' }]);
  });
});

describe('analyzeRules: 警告の種類', () => {
  it('到達不能（全条件が遮蔽）', () => {
    const rules = [rule('A', [['From', '@example.com']]), rule('B', [['From', 'sales@example.com']])];
    const a = analyze(rules).byId.get(rules[1]!.id)!;
    expect(a.kind).toBe('unreachable');
    expect(a.severity).toBe('warning');
    expect(a.conditions).toEqual([{ kind: 'shadowed', byRuleId: rules[0]!.id, byConditionIndex: 0 }]);
  });

  it('到達不能（遮蔽と冗長の混在）', () => {
    const rules = [
      rule('A', [['From', 'a@example.com']]),
      rule('B', [['From', 'b@example.com']]),
      rule('B', [
        ['From', 'a@example.com'],
        ['From', 'xb@example.com'],
      ]),
    ];
    const a = analyze(rules).byId.get(rules[2]!.id)!;
    expect(a.conditions.map((c) => c.kind)).toEqual(['shadowed', 'redundant']);
    expect(a.kind).toBe('unreachable');
  });

  it('冗長ルール（全条件が冗長）', () => {
    const rules = [rule('A', [['From', 'a@example.com'], ['[body]', '配信停止']]), rule('A', [['From', 'A@EXAMPLE.COM'], ['[body]', '配信停止はこちら']])];
    const a = analyze(rules).byId.get(rules[1]!.id)!;
    expect(a.kind).toBe('redundant-rule');
    expect(a.severity).toBe('info');
    expect(a.conditions).toEqual([
      { kind: 'redundant', byRuleId: rules[0]!.id, byConditionIndex: 0 },
      { kind: 'redundant', byRuleId: rules[0]!.id, byConditionIndex: 1 },
    ]);
  });

  it('一部到達不能（自由 + 遮蔽）', () => {
    const rules = [rule('A', [['Subject', '機能要望']]), rule('B', [['Subject', '機能要望の件'], ['Subject', 'サポート']])];
    const a = analyze(rules).byId.get(rules[1]!.id)!;
    expect(a.kind).toBe('partially-unreachable');
    expect(a.severity).toBe('warning');
  });

  it('一部冗長（自由 + 冗長、遮蔽なし）', () => {
    const rules = [rule('A', [['From', '@example.com']]), rule('A', [['To', 'team@example.com'], ['From', 'boss@example.com']])];
    const a = analyze(rules).byId.get(rules[1]!.id)!;
    expect(a.kind).toBe('partially-redundant');
    expect(a.conditions.map((c) => c.kind)).toEqual(['free', 'redundant']);
  });

  it('警告なし', () => {
    const rules = [rule('A', [['From', 'a@example.com']]), rule('B', [['From', 'b@example.com']])];
    const r = analyze(rules);
    expect(r.byId.get(rules[1]!.id)!.kind).toBe('none');
    expect(r.byId.get(rules[1]!.id)!.severity).toBeNull();
    expect(r.counts).toEqual({
      unreachable: 0,
      'redundant-rule': 0,
      'partially-unreachable': 0,
      'partially-redundant': 0,
      'not-applicable': 0,
      duplicate: 0,
    });
  });

  it('同一ルール内の重複（フィールド集合とテキストが大文字小文字を除いて同一）', () => {
    const rules = [
      rule('A', [
        ['Subject', '定例会議'],
        ['subject', '定例会議'],
        ['From, Sender', 'X@example.com'],
        ['sender ,from', 'x@EXAMPLE.com'],
        ['Subject', '定例'],
      ]),
    ];
    const r = analyze(rules);
    const a = r.byId.get(rules[0]!.id)!;
    expect(a.kind).toBe('none');
    expect(a.duplicates).toEqual([
      { index: 1, firstIndex: 0 },
      { index: 3, firstIndex: 2 },
    ]);
    expect(r.counts.duplicate).toBe(1);
  });

  it('条件 0 件のルールは判定対象外', () => {
    const rules = [rule('A', []), rule('B', [['From', 'a@example.com']])];
    const r = analyze(rules);
    expect(r.byId.get(rules[0]!.id)).toMatchObject({ kind: 'not-applicable', notApplicableReason: 'no-conditions', conditions: [] });
    expect(r.counts['not-applicable']).toBe(1);
  });

  it('振り分け先の無いルールは、覆わず覆われない。同一ルール内の重複だけは判定する', () => {
    const rules = [
      rule('', [['From', '@example.com'], ['FROM', '@EXAMPLE.COM']]),
      rule('B', [['From', 'a@example.com']]),
      rule('', [['From', 'a@example.com']]),
    ];
    const r = analyze(rules);
    expect(r.byId.get(rules[0]!.id)).toMatchObject({ kind: 'not-applicable', notApplicableReason: 'no-destination' });
    expect(r.byId.get(rules[0]!.id)!.duplicates).toEqual([{ index: 1, firstIndex: 0 }]);
    expect(r.byId.get(rules[1]!.id)!.kind).toBe('none');
    expect(r.byId.get(rules[2]!.id)!.kind).toBe('not-applicable');
  });

  it('振り分け先の同一判定は mailbox と folder の両方', () => {
    const a = rule('A', [['From', 'a@example.com']]);
    const b = { ...rule('A', [['From', 'a@example.com']]), destMailbox: '0000ffff.mb' };
    expect(analyze([a, b]).byId.get(b.id)!.kind).toBe('unreachable');
  });
});

describe('analyzeRules: 覆う最初のルールと並び順', () => {
  it('複数の先行ルールが覆う場合は最小の番号、同じルールなら最初の条件', () => {
    const rules = [
      rule('X', [['From', 'zzz@example.org']]),
      rule('A', [['Subject', 'abc'], ['*', 'example.com'], ['From', '@example.com']]),
      rule('B', [['From', 'example.com']]),
      rule('C', [['From', 'a@example.com']]),
    ];
    const a = analyze(rules).byId.get(rules[3]!.id)!;
    expect(a.conditions).toEqual([{ kind: 'shadowed', byRuleId: rules[1]!.id, byConditionIndex: 1 }]);
  });

  it('並び順を変えると結果が変わる（覆う側を後ろへ移すと警告が移る）', () => {
    const broad = rule('A', [['From', '@example.com']]);
    const narrow = rule('B', [['From', 'sales@example.com']]);
    const r1 = analyze([broad, narrow], [broad.id, narrow.id]);
    expect(r1.byId.get(narrow.id)!.kind).toBe('unreachable');
    expect(r1.byId.get(broad.id)!.kind).toBe('none');
    const r2 = analyze([broad, narrow], [narrow.id, broad.id]);
    expect(r2.byId.get(narrow.id)!.kind).toBe('none');
    expect(r2.byId.get(broad.id)!.kind).toBe('none');
  });

  it('決定的（同じ入力で同じ結果）', () => {
    const rand = seededRandom(3);
    const rules = synth(60, rand);
    const order = shuffle(rules.map((r) => r.id), rand);
    const first = JSON.stringify([...analyze(rules, order).byId]);
    for (let i = 0; i < 3; i++) expect(JSON.stringify([...analyze(rules, order).byId])).toBe(first);
  });
});

/** 合成データ（架空）。条件はルールあたり 1〜3 件 */
function synth(n: number, rand: () => number): Rule[] {
  const fields = ['From', 'Subject', 'To', 'From, Sender, X-Sender', '*', '[body]'];
  return Array.from({ length: n }, (_, i) => {
    const count = 1 + Math.floor(rand() * 3);
    const conds: [string, string][] = Array.from({ length: count }, () => {
      const f = fields[Math.floor(rand() * fields.length)]!;
      const t = rand() < 0.3 ? `@example${Math.floor(rand() * 3)}.com` : `user${Math.floor(rand() * 200)}@example${Math.floor(rand() * 3)}.com`;
      return [f, t];
    });
    return rule(`Inbox\\F${Math.floor(rand() * 40)}\\`, conds, `s${i}`);
  });
}

describe('規模', () => {
  it('376 ルール・約 700 条件で極端に遅くない', () => {
    const rand = seededRandom(376);
    const rules = synth(376, rand);
    const total = rules.reduce((n, r) => n + r.conditions.length, 0);
    expect(total).toBeGreaterThan(600);
    const start = performance.now();
    const r = analyze(rules);
    const elapsed = performance.now() - start;
    expect(r.byId.size).toBe(376);
    expect(elapsed).toBeLessThan(2000);
  });
});
