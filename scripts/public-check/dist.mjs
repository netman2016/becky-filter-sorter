// ビルド成果物の外部参照検査（npm run check:dist）。npm run build のあとに実行する。CI でも実行する。
//   - dist/ の中に、許可リスト（ALLOWED_DIST_URLS）以外の外部 URL（http(s):// と //host）が無いこと
//   - index.html の src / href が、相対パス・data: または VITE_BASE（未指定なら /）の配下だけであること
// 出力は件数とファイル名だけにする。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ALLOWED_DIST_URLS } from './allowlist.mjs';
import { ROOT } from './git.mjs';

const DIST = join(ROOT, 'dist');
const ALLOWED = new Set(ALLOWED_DIST_URLS.map((u) => u.url));
const URL_RE = /\bhttps?:\/\/[^\s"'`<>()\\]*/gi;
// 先頭に英数字・: が無い //host.tld（プロトコル相対 URL）。正規表現リテラルやコメントを拾わないよう、ホスト名らしいものに限る
const PROTOCOL_RELATIVE_RE = /(?<![\w:/])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?=[/"'`:?#)\s]|$)/gi;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ がありません。先に npm run build を実行してください。');
    return 2;
  }
  const base = process.env.VITE_BASE ?? '/';
  let ok = true;

  const files = walk(DIST).filter((f) => /\.(html|js|mjs|css|map|svg|json|txt|webmanifest)$/i.test(f));
  /** @type {Map<string, number>} */
  const allowedSeen = new Map();
  let violations = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let n = 0;
    for (const m of text.matchAll(URL_RE)) {
      if (ALLOWED.has(m[0])) allowedSeen.set(m[0], (allowedSeen.get(m[0]) ?? 0) + 1);
      else n++;
    }
    n += [...text.matchAll(PROTOCOL_RELATIVE_RE)].length;
    if (n > 0) {
      console.log(`  ${relative(ROOT, file)}: 許可リスト外の外部 URL ${n} 件`);
      violations += n;
    }
  }
  console.log(`dist/ の外部 URL 検査: ${files.length} ファイル、許可リスト外 ${violations} 件`);
  console.log(`  許可リストの URL（通信しない文字列）: ${[...allowedSeen.values()].reduce((a, b) => a + b, 0)} 件`);
  if (violations > 0) ok = false;

  const indexPath = join(DIST, 'index.html');
  if (!existsSync(indexPath)) {
    console.log('  dist/index.html がありません');
    return 1;
  }
  const html = readFileSync(indexPath, 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1] ?? '');
  const badRefs = refs.filter((r) => {
    if (r.startsWith('data:')) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return true; // 外部（スキームつき・プロトコル相対）
    if (r.startsWith('/')) return !r.startsWith(base); // ルート相対は base の配下だけ
    return false; // 相対パス
  });
  console.log(`index.html の参照: ${refs.length} 件、base（${base}）の配下でないもの ${badRefs.length} 件`);
  if (badRefs.length > 0) ok = false;

  console.log(ok ? '結果: OK' : '結果: NG');
  return ok ? 0 : 1;
}

try {
  process.exit(main());
} catch (e) {
  console.error(`実行エラー: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
