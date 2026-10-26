// 実ファイル検証。IFILTER_REAL_PATH が設定されているときだけ実行する。
//   IFILTER_REAL_PATH=/path/to/IFilter.def npm run test:real
// 実データの漏えいを防ぐため、出力はルール数・件数・一致/不一致のみ。
// パス・フォルダ名・アドレス・条件文字列は出力しない（バイト比較に toEqual を使わないのもそのため）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { firstMismatch, isOnlyReordered, parseIFilter, serialize } from '../src/core';
import { mismatchMessage } from './helpers';

const realPath = process.env.IFILTER_REAL_PATH;

describe.skipIf(!realPath)('実ファイル検証', () => {
  it('ラウンドトリップ・反転して戻したときのバイト完全一致・件数', () => {
    const input = new Uint8Array(readFileSync(realPath!));
    const { doc, warnings } = parseIFilter(input);
    const ids = doc.rules.map((r) => r.id);

    const roundTrip = firstMismatch(serialize(doc), input);

    const reversed = [...ids].reverse();
    const reparsed = parseIFilter(serialize(doc, reversed)).doc;
    const restoredOrder = [...reparsed.rules].reverse().map((r) => r.id);
    const restored = firstMismatch(serialize(reparsed, restoredOrder), input);
    const onlyReordered = isOnlyReordered(input, doc, reversed);

    const warningCounts: Record<string, number> = {};
    for (const w of warnings) warningCounts[w.kind] = (warningCounts[w.kind] ?? 0) + 1;
    const conditionCount = doc.rules.reduce((n, r) => n + r.conditions.length, 0);

    console.log(
      [
        `ルール数: ${doc.rules.length}`,
        `条件数: ${conditionCount}`,
        `パース警告: ${warnings.length} 件 ${JSON.stringify(warningCounts)}`,
        `ラウンドトリップ: ${mismatchMessage(roundTrip)}`,
        `反転して戻す: ${mismatchMessage(restored)}`,
        `順序のみの変更と判定: ${onlyReordered ? 'はい' : 'いいえ'}`,
      ].join('\n'),
    );

    expect(roundTrip, mismatchMessage(roundTrip)).toBe(-1);
    expect(restored, mismatchMessage(restored)).toBe(-1);
    expect(onlyReordered).toBe(true);
    expect(reparsed.rules.length).toBe(doc.rules.length);
  });
});
