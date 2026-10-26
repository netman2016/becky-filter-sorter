import { describe, expect, it } from 'vitest';
import { firstMismatch, parseIFilter, serialize } from '../src/core';
import { HEADER, def, readSample, ruleLines } from './helpers';

function expectRoundTrip(input: Uint8Array) {
  const { doc } = parseIFilter(input);
  const off = firstMismatch(serialize(doc), input);
  expect(off, `オフセット ${off} で不一致`).toBe(-1);
}

describe('ラウンドトリップ（パース → シリアライズでバイト完全一致）', () => {
  it('架空サンプル', () => {
    const input = readSample();
    expectRoundTrip(input);
    expect(parseIFilter(input).doc.rules).toHaveLength(10);
  });

  it('空ファイル', () => {
    expectRoundTrip(new Uint8Array(0));
  });

  it('ヘッダのみ', () => {
    const input = def(HEADER);
    expectRoundTrip(input);
    const { doc } = parseIFilter(input);
    expect(doc.rules).toHaveLength(0);
    expect(doc.header.rawLines).toHaveLength(4);
  });

  it('ルール 1 件', () => {
    expectRoundTrip(def([...HEADER, ...ruleLines('Inbox\\テスト\\', [['From', 'a@example.com']])]));
  });

  it('ルール間に空行がある', () => {
    const input = def([
      ...HEADER,
      ...ruleLines('Inbox\\A\\', [['From', 'a@example.com']]),
      '',
      '',
      ...ruleLines('Inbox\\B\\', [['From', 'b@example.com']]),
    ]);
    expectRoundTrip(input);
    const { doc, warnings } = parseIFilter(input);
    expect(warnings.filter((w) => w.kind === 'line-after-end')).toHaveLength(2);
    expect(doc.rules[0]!.unknownLines).toEqual([5, 6]);
    expect(doc.trailing).toHaveLength(0);
  });

  it('最後のルールの後ろに行がある（trailing）', () => {
    const input = def([...HEADER, ...ruleLines('Inbox\\A\\', [['From', 'a@example.com']]), '', 'xyz']);
    expectRoundTrip(input);
    const { doc, warnings } = parseIFilter(input);
    expect(doc.trailing.length).toBeGreaterThan(0);
    expect(warnings.filter((w) => w.kind === 'trailing-line')).toHaveLength(2);
  });

  it('ファイル末尾に CRLF が無い（警告つきで許容）', () => {
    const input = def([...HEADER, ...ruleLines('Inbox\\A\\', [['From', 'a@example.com']])], {
      finalEol: false,
    });
    expectRoundTrip(input);
    const { warnings } = parseIFilter(input);
    expect(warnings.map((w) => w.kind)).toContain('missing-final-newline');
  });

  it('ヘッダが 4 行以外でも :Begin 前の全行をヘッダとする', () => {
    const input = def(['Version=1', 'Extra=1', ...ruleLines('Inbox\\A\\', [['To', 'x@example.com']])]);
    expectRoundTrip(input);
    expect(parseIFilter(input).doc.header.rawLines).toHaveLength(2);
  });

  it('376 ルール規模', () => {
    const lines = [...HEADER];
    for (let i = 0; i < 376; i++) {
      lines.push(
        ...ruleLines(`Inbox\\フォルダ${i % 40}\\サブ${i}\\`, [
          ['From', `user${i}@example.com`],
          ['Subject', `件名${i}`],
        ]),
      );
    }
    const input = def(lines);
    expectRoundTrip(input);
    expect(parseIFilter(input).doc.rules).toHaveLength(376);
  });
});
