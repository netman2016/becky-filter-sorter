import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';

export const SAMPLE_PATH = fileURLToPath(new URL('../samples/IFilter.sample.def', import.meta.url));

export function readSample(): Uint8Array {
  return new Uint8Array(readFileSync(SAMPLE_PATH));
}

/** 文字列を CP932 バイト列にする（テスト専用。本体は再エンコードしない） */
export function cp932(text: string): Uint8Array {
  return new Uint8Array(iconv.encode(text, 'cp932'));
}

/** 行の配列から IFilter.def 相当のバイト列を作る */
export function def(lines: string[], opts: { eol?: string; finalEol?: boolean } = {}): Uint8Array {
  const eol = opts.eol ?? '\r\n';
  const finalEol = opts.finalEol ?? true;
  return cp932(lines.join(eol) + (finalEol && lines.length > 0 ? eol : ''));
}

export const HEADER = ['Version=1', 'AutoSorting=1', 'OnlyRead=0', 'OnlyOneFolder=1'];

/** 架空のルール 1 件分の行 */
export function ruleLines(folder: string, conditions: [field: string, text: string][]): string[] {
  return [
    ':Begin ""',
    `!M:0000abcd.mb\\!!!!${folder}`,
    ...conditions.map(([f, t]) => `@0:${f}:${t}\tO\tI`),
    '$O:Sort=1',
    ':End ""',
  ];
}

/** 再現可能な疑似乱数（mulberry32） */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** バイト列の比較で失敗したとき、内容ではなくオフセットだけを示すメッセージ */
export function mismatchMessage(offset: number): string {
  return offset === -1 ? '一致' : `オフセット ${offset} で不一致`;
}
