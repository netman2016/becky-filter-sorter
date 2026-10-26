import { describe, expect, it } from 'vitest';
import { ParseError, parseIFilter } from '../src/core';
import { HEADER, cp932, def } from './helpers';

function expectParseError(input: Uint8Array, kind: string, line: number) {
  try {
    parseIFilter(input);
  } catch (e) {
    expect(e).toBeInstanceOf(ParseError);
    const err = e as ParseError;
    expect({ kind: err.kind, line: err.line }).toEqual({ kind, line });
    expect(err.message).toMatch(new RegExp(`^${line} 行目: `));
    return;
  }
  throw new Error('ParseError が発生しませんでした');
}

describe('不正な入力は行番号つきのエラー', () => {
  it(':End が無い', () => {
    expectParseError(def([...HEADER, ':Begin ""', '@0:From:a@example.com\tO\tI']), 'unterminated-rule', 5);
  });

  it(':Begin の入れ子', () => {
    expectParseError(def([...HEADER, ':Begin ""', ':Begin ""', ':End ""']), 'nested-begin', 6);
  });

  it('対応する :Begin の無い :End', () => {
    expectParseError(def([...HEADER, ':End ""']), 'unmatched-end', 5);
    expectParseError(def([...HEADER, ':Begin ""', ':End ""', ':End ""']), 'unmatched-end', 7);
  });

  it('LF のみの改行', () => {
    expectParseError(def([...HEADER, ':Begin ""', ':End ""'], { eol: '\n' }), 'bare-lf', 1);
  });

  it('途中に単独の LF / CR が混ざる', () => {
    expectParseError(cp932('Version=1\r\nAutoSorting=1\nOnlyRead=0\r\n'), 'bare-lf', 2);
    expectParseError(cp932('Version=1\r\nAutoSorting=1\rOnlyRead=0\r\n'), 'bare-cr', 2);
    expectParseError(cp932('Version=1\r'), 'bare-cr', 1);
  });

  it('メッセージに行の内容を含めない', () => {
    try {
      parseIFilter(def([...HEADER, ':Begin ""', '@0:From:secret@example.com\tO\tI']));
    } catch (e) {
      expect((e as Error).message).not.toContain('secret');
    }
  });
});
