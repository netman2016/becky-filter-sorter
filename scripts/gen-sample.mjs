// 架空サンプル samples/IFilter.sample.def を生成する（CP932・CRLF）。
// 正本は scripts/samples/IFilter.sample.txt（UTF-8・LF）。実データは絶対に入れないこと。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';

const src = fileURLToPath(new URL('./samples/IFilter.sample.txt', import.meta.url));
const dest = fileURLToPath(new URL('../samples/IFilter.sample.def', import.meta.url));

const text = readFileSync(src, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const bytes = iconv.encode(text, 'cp932');

// エンコードできない文字が "?" に化けていないか確認する
if (iconv.decode(bytes, 'cp932') !== text) {
  console.error('CP932 で表現できない文字が含まれています');
  process.exit(1);
}
writeFileSync(dest, bytes);
console.log(`書き出しました: samples/IFilter.sample.def (${bytes.length} バイト)`);
