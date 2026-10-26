// 公開前の総合チェック（npm run check:public）。手元専用で、CI では実行しない。
// 検索語（実データの断片）は 1 行に 1 つずつ標準入力で渡す。標準入力が端末のときは環境変数 CHECK_TERMS（改行区切り）を使う。
//   read -rs T && printf '%s\n' "$T" | npm run -s check:public
// 検索語はファイルにもログにも出さない。結果は「語 #1」のような番号と件数・場所（パスやコミット）だけを出す。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { ALLOWED_DOMAINS, ALLOWED_IPV4 } from './allowlist.mjs';
import { printDomainResult, runDomainCheck } from './domains.mjs';
import {
  ROOT,
  commitMessages,
  historyBlobs,
  historyPaths,
  identities,
  isIgnored,
  refNames,
  workingTreeFiles,
} from './git.mjs';
import { countMatches, extractHosts, forbiddenPathReason, isAllowedHost, isPublicEmail, termPatterns } from './rules.mjs';

const ALLOW = { domains: ALLOWED_DOMAINS.map((d) => d.domain), ipv4: ALLOWED_IPV4 };
const SAMPLE_DEF = 'samples/IFilter.sample.def';
const SAMPLE_TXT = 'scripts/samples/IFilter.sample.txt';

/** @type {{ name: string; status: 'OK' | 'NG' | '未実施' }[]} */
const summary = [];
/** @param {string} title */
const heading = (title) => console.log(`\n== ${title} ==`);

function readTerms() {
  let raw = '';
  if (!process.stdin.isTTY) {
    try {
      raw = readFileSync(0, 'utf8');
    } catch {
      raw = '';
    }
  }
  if (!raw.trim()) raw = process.env.CHECK_TERMS ?? '';
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- (b) 検索語 ----
function checkTerms() {
  heading('検索語（実データの断片）');
  const terms = readTerms();
  if (terms.length === 0) {
    console.log('検索語がありません。標準入力（1 行 1 語）か CHECK_TERMS で渡してください。');
    summary.push({ name: '検索語', status: '未実施' });
    return;
  }
  /** @type {{ label: string; bytes: Uint8Array }[]} */
  const targets = [];
  const enc = new TextEncoder();
  for (const f of workingTreeFiles()) targets.push({ label: f.path, bytes: f.bytes });
  for (const b of historyBlobs()) targets.push({ label: `${b.path}@blob:${b.sha.slice(0, 10)}`, bytes: b.bytes });
  for (const c of commitMessages()) targets.push({ label: `コミットメッセージ@${c.commit}`, bytes: enc.encode(c.message) });
  for (const id of identities()) targets.push({ label: `コミットの${id.role}`, bytes: enc.encode(`${id.name} <${id.email}>`) });
  for (const r of refNames()) targets.push({ label: 'ref 名', bytes: enc.encode(r) });
  console.log(`検査対象: ${targets.length} 件（ワーキングツリー・全履歴の blob・コミットメッセージ・作者情報・ref 名）`);

  let anyHit = false;
  terms.forEach((term, i) => {
    const patterns = termPatterns(term);
    let total = 0;
    const where = new Set();
    for (const t of targets) {
      const n = countMatches(t.bytes, patterns);
      if (n > 0) {
        total += n;
        where.add(t.label);
      }
    }
    const short = [...term].length <= 3 ? '（3 文字以下のため誤検出が多い可能性あり）' : '';
    console.log(`語 #${i + 1}: ${total} 件${short}`);
    for (const w of where) console.log(`    ${w}`);
    if (total > 0) anyHit = true;
  });
  summary.push({ name: '検索語', status: anyHit ? 'NG' : 'OK' });
}

// ---- (a) ドメイン ----
function checkDomains() {
  heading('ドメイン許可リスト');
  const ok = printDomainResult(runDomainCheck({ history: true }), true);
  summary.push({ name: 'ドメイン', status: ok ? 'OK' : 'NG' });
}

// ---- (d) コミットのメタデータ ----
function checkIdentities() {
  heading('コミットのメタデータ（作者・コミッタ・Co-Authored-By・タグ）');
  const ids = identities();
  let ok = true;
  for (const id of ids) {
    const pub = isPublicEmail(id.email, id.role === 'co-author' ? 'co-author' : 'person');
    if (!pub) ok = false;
    console.log(`  [${pub ? 'OK' : 'NG'}] ${id.role}: ${id.name} <${id.email}>（${id.count} 件）`);
  }
  console.log(`  種類: ${ids.length} 件`);
  summary.push({ name: 'メタデータ', status: ok ? 'OK' : 'NG' });
}

// ---- (e) .gitignore と禁止ファイル ----
function checkIgnoreAndPaths() {
  heading('.gitignore と禁止ファイル');
  const mustIgnore = [
    'IFilter.def',
    'sub/IFilter.def',
    'IFilter.def.bak-20260101-000000',
    'sub/IFilter.def.bak-20260101-000000',
    'a.txt:Zone.Identifier',
    'node_modules/x',
    'dist/x',
  ];
  const mustNotIgnore = ['samples/IFilter.sample.def'];
  let ok = true;
  for (const p of mustIgnore) {
    const ig = isIgnored(p);
    if (!ig) ok = false;
    console.log(`  [${ig ? 'OK' : 'NG'}] 無視される: ${p}`);
  }
  for (const p of mustNotIgnore) {
    const ig = isIgnored(p);
    if (ig) ok = false;
    console.log(`  [${ig ? 'NG' : 'OK'}] 無視されない: ${p}`);
  }
  const bad = historyPaths()
    .map((p) => ({ p, reason: forbiddenPathReason(p) }))
    .filter((x) => x.reason !== null);
  console.log(`  全履歴・インデックスの禁止パス: ${bad.length} 件`);
  for (const b of bad) console.log(`    ${b.p}（${b.reason}）`);
  if (bad.length > 0) ok = false;
  summary.push({ name: '.gitignore・禁止ファイル', status: ok ? 'OK' : 'NG' });
}

// ---- (c) 架空サンプルの一覧 ----
/** @param {string} s */
function marks(s) {
  const m = [];
  if (/[^\x20-\x7e]/.test(s)) m.push('非ASCII');
  if (extractHosts(s).some((h) => !isAllowedHost(h.host, ALLOW))) m.push('許可外ドメイン?');
  return m.length > 0 ? `  [${m.join('・')}]` : '';
}

function listSamples() {
  heading('架空サンプルの内容（目視で確認してください）');
  const defBytes = readFileSync(join(ROOT, SAMPLE_DEF));
  const text = iconv.decode(defBytes, 'cp932');
  const mailboxes = new Set();
  const folders = new Set();
  const fields = new Set();
  const texts = new Set();
  for (const line of text.split('\r\n')) {
    const dest = /^!M:(.*?)\\!!!!(.*)$/.exec(line);
    if (dest) {
      mailboxes.add(dest[1]);
      folders.add(dest[2]);
    }
    const cond = /^@0:([^:]*):([^\t]*)(\t.*)?$/.exec(line);
    if (cond) {
      fields.add(cond[1]);
      texts.add(cond[2]);
    }
  }
  console.log(`${SAMPLE_DEF}`);
  for (const [title, set] of /** @type {[string, Set<string>][]} */ ([
    ['メールボックス ID', mailboxes],
    ['振り分け先フォルダ', folders],
    ['フィールド', fields],
    ['条件テキスト', texts],
  ])) {
    console.log(`  ${title}（${set.size} 件）`);
    for (const v of set) console.log(`    ${v}${marks(v)}`);
  }

  // samples/IFilter.sample.def が正本（UTF-8・LF）から生成した内容と一致するか（gen-sample.mjs と同じ変換）
  const src = readFileSync(join(ROOT, SAMPLE_TXT), 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const same = Buffer.compare(iconv.encode(src, 'cp932'), defBytes) === 0;
  console.log(`  ${SAMPLE_TXT} から生成した内容と一致: ${same ? 'はい' : 'いいえ'}`);

  // テストの中の、非 ASCII を含む文字列リテラル（テスト名を除く）
  const literals = new Map();
  for (const f of workingTreeFiles()) {
    if (!/^tests\/.*\.ts$/.test(f.path)) continue;
    const src = new TextDecoder().decode(f.bytes);
    for (const m of src.matchAll(/(?<!\b(?:it|describe|test)(?:\.\w+)?\(\s*)(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
      const v = m[2] ?? '';
      if (!/[^\x00-\x7f]/.test(v)) continue;
      if (!literals.has(v)) literals.set(v, f.path);
    }
  }
  console.log(`tests/ の非 ASCII を含む文字列リテラル（テスト名を除く、${literals.size} 件）`);
  for (const [v, path] of literals) console.log(`    ${v}${marks(v)}  (${path})`);
  summary.push({ name: 'サンプルの生成元との一致', status: same ? 'OK' : 'NG' });
}

try {
  checkTerms();
  checkDomains();
  checkIdentities();
  checkIgnoreAndPaths();
  listSamples();
  heading('まとめ');
  for (const s of summary) console.log(`  ${s.status.padEnd(3)} ${s.name}`);
  console.log('  ※ 架空サンプルの一覧は、実データらしい文字列が無いかを目で確認してください');
  process.exit(summary.every((s) => s.status === 'OK') ? 0 : 1);
} catch (e) {
  console.error(`実行エラー: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
