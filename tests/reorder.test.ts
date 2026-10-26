import { describe, expect, it } from 'vitest';
import {
  bytesEqual,
  firstMismatch,
  isOnlyReordered,
  moveRules,
  parseIFilter,
  serialize,
} from '../src/core';
import { HEADER, def, readSample, ruleLines, seededRandom, shuffle } from './helpers';

describe('並び替え', () => {
  const input = readSample();
  const { doc } = parseIFilter(input);
  const ids = doc.rules.map((r) => r.id);

  function checkPermutation(order: string[]) {
    const out = serialize(doc, order);
    const re = parseIFilter(out).doc;
    // 並び順どおりに raw が並んでいる
    expect(re.rules).toHaveLength(doc.rules.length);
    order.forEach((id, i) => {
      const src = doc.rules.find((r) => r.id === id)!;
      expect(bytesEqual(re.rules[i]!.raw, src.raw), `位置 ${i} の raw が不一致`).toBe(true);
    });
    expect(isOnlyReordered(input, doc, order)).toBe(true);
    // 元の順序に戻すとバイト完全一致
    const back = serialize(doc, ids);
    expect(firstMismatch(back, input)).toBe(-1);
  }

  it('反転', () => {
    checkPermutation([...ids].reverse());
  });

  it('ランダムな置換（シード固定）', () => {
    const rand = seededRandom(20261025);
    for (let n = 0; n < 50; n++) checkPermutation(shuffle(ids, rand));
  });

  it('順序を変えなければ入力と同一', () => {
    expect(firstMismatch(serialize(doc, ids), input)).toBe(-1);
  });

  it('並び順に欠落・重複・未知の ID があれば例外', () => {
    expect(() => serialize(doc, ids.slice(1))).toThrow();
    expect(() => serialize(doc, [ids[0]!, ...ids.slice(0, -1)])).toThrow();
    expect(() => serialize(doc, [...ids.slice(1), 'r9999'])).toThrow();
  });

  it('内容が変わった raw は isOnlyReordered で検出する', () => {
    const tampered = {
      ...doc,
      rules: doc.rules.map((r, i) => (i === 3 ? { ...r, raw: r.raw.slice(0, -3) } : r)),
    };
    expect(isOnlyReordered(input, tampered, ids)).toBe(false);
  });
});

describe('末尾 CRLF が無いファイルの並び替え', () => {
  const input = def(
    [
      ...HEADER,
      ...ruleLines('Inbox\\A\\', [['From', 'a@example.com']]),
      ...ruleLines('Inbox\\B\\', [['From', 'b@example.com']]),
      ...ruleLines('Inbox\\C\\', [['From', 'c@example.com']]),
    ],
    { finalEol: false },
  );
  const { doc } = parseIFilter(input);
  const ids = doc.rules.map((r) => r.id);

  it('最後のルールを先頭へ移動すると CRLF が補われ、正しく再パースできる', () => {
    const order = moveRules(ids, [ids[2]!], 0);
    const out = serialize(doc, order);
    const re = parseIFilter(out);
    expect(re.doc.rules.map((r) => r.destFolder)).toEqual(['Inbox\\C\\', 'Inbox\\A\\', 'Inbox\\B\\']);
    // 補ったのは CRLF 2 バイトのみ。新しい最後のルールは元から CRLF で終わる
    expect(out.length).toBe(input.length + 2);
    expect(re.warnings.map((w) => w.kind)).not.toContain('missing-final-newline');
    expect(isOnlyReordered(input, doc, order)).toBe(true);
  });

  it('元の順序なら補わずバイト完全一致', () => {
    expect(firstMismatch(serialize(doc, ids), input)).toBe(-1);
  });
});

describe('moveRules', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('1 件を前へ・後ろへ移動する', () => {
    expect(moveRules(order, ['d'], 0)).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(moveRules(order, ['b'], 4)).toEqual(['a', 'c', 'd', 'e', 'b']);
    expect(moveRules(order, ['c'], 2)).toEqual(order);
  });

  it('複数件をまとめて移動し、相対順を保つ（指定順ではなく現在の順）', () => {
    expect(moveRules(order, ['e', 'b'], 0)).toEqual(['b', 'e', 'a', 'c', 'd']);
    expect(moveRules(order, ['a', 'c'], 1)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('範囲外の位置は丸める', () => {
    expect(moveRules(order, ['a'], 99)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(moveRules(order, ['e'], -5)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('存在しない ID は無視し、元の配列は変更しない', () => {
    const copy = [...order];
    expect(moveRules(order, ['x'], 0)).toEqual(order);
    expect(order).toEqual(copy);
  });
});
