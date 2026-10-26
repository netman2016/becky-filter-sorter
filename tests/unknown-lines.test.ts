import { describe, expect, it } from 'vitest';
import { firstMismatch, parseIFilter, serialize } from '../src/core';
import { HEADER, def } from './helpers';

describe('未知の行・フラグの保持', () => {
  const input = def([
    ...HEADER,
    ':Begin ""',
    '!M:0000abcd.mb\\!!!!Inbox\\A\\',
    '@0:From:a@example.com\tO\tI',
    '@1:Subject:未知の条件\tO\tI', // ルール内 3
    '!C:0000abcd.mb\\!!!!Inbox\\B\\', // 4
    '@0:Subject:未知フラグ\tO\tX', // 5: 条件として扱い、警告
    '$O:Other=2', // 6
    '!M:0000abcd.mb\\!!!!Inbox\\C\\', // 7: 2 つ目の振り分け先
    '@0:壊れた条件', // 8: field の区切りが無い
    '$O:Sort=1',
    ':End ""',
    '', // 11: :End の後ろ
    ':Begin "名前つき"',
    '@0:To:b@example.com\tO\tI',
    ':End ""',
  ]);
  const { doc, warnings } = parseIFilter(input);

  it('出力はバイト完全一致', () => {
    expect(firstMismatch(serialize(doc), input)).toBe(-1);
    // :End 後の空行はルールと一緒に移動する。最後尾へ移動した場合、再パースでは trailing になる
    const reversed = doc.rules.map((r) => r.id).reverse();
    const out = serialize(doc, reversed);
    expect(out.length).toBe(input.length);
    const re = parseIFilter(out).doc;
    expect(re.rules[1]!.unknownLines).toEqual([3, 4, 6, 7, 8]);
    expect(Array.from(re.trailing)).toEqual([0x0d, 0x0a]);
  });

  it('想定外の行を unknownLines に記録する', () => {
    const rule = doc.rules[0]!;
    expect(rule.unknownLines).toEqual([3, 4, 6, 7, 8, 11]);
    expect(rule.destFolder).toBe('Inbox\\A\\');
    expect(rule.conditions.map((c) => c.text)).toEqual(['a@example.com', '未知フラグ']);
    expect(rule.conditions[1]!.flags).toEqual(['O', 'X']);
  });

  it('警告は種別・ルール番号・行番号のみを持つ', () => {
    expect(warnings).toEqual([
      { kind: 'unknown-line', ruleIndex: 0, line: 8 },
      { kind: 'unknown-line', ruleIndex: 0, line: 9 },
      { kind: 'unknown-flag', ruleIndex: 0, line: 10 },
      { kind: 'unknown-line', ruleIndex: 0, line: 11 },
      { kind: 'unknown-line', ruleIndex: 0, line: 12 },
      { kind: 'unknown-line', ruleIndex: 0, line: 13 },
      { kind: 'line-after-end', ruleIndex: 0, line: 16 },
      { kind: 'no-destination', ruleIndex: 1, line: 17 },
    ]);
  });

  it('名前つきの :Begin も受け付ける', () => {
    expect(doc.rules[1]!.conditions[0]!.field).toBe('To');
    expect(doc.rules[1]!.destMailbox).toBe('');
  });
});
