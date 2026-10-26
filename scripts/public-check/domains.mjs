// ドメイン許可リスト検査（npm run check:domains）。CI でも実行する。
//   npm run check:domains              ワーキングツリー（追跡中 + 未追跡で無視されていないファイル）
//   npm run check:domains -- --history 加えて全履歴の blob とコミットメッセージ
// CI のログは公開されるため、出力は件数と「ファイル名:行番号」だけにする（一致した文字列は出さない）。
// 見逃しうるもの: BARE_DOMAIN_LABELS に無い TLD の裸のドメイン、全角・難読化した表記。
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { ALLOWED_DOMAINS, ALLOWED_IPV4, ALLOWED_LOCK_RESOLVED_PREFIX } from './allowlist.mjs';
import { commitMessages, historyBlobs, workingTreeFiles } from './git.mjs';
import { checkLockfileResolved, domainViolationLines } from './rules.mjs';

const ALLOW = { domains: ALLOWED_DOMAINS.map((d) => d.domain), ipv4: ALLOWED_IPV4 };
const LOCKFILE = 'package-lock.json';

/**
 * ファイルの中身を文字列にする。サンプルの .def は CP932、それ以外は UTF-8。
 * UTF-8 として不正なもの（バイナリなど）は null。
 * @param {string} path @param {Uint8Array} bytes
 */
export function decodeFile(path, bytes) {
  if (/\.def$/i.test(path)) return iconv.decode(Buffer.from(bytes), 'cp932');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * @param {{ history: boolean }} opts
 * @returns {{ violations: string[]; undecodable: string[]; scanned: number; lock: { total: number; violations: string[] } }}
 */
export function runDomainCheck(opts) {
  /** @type {string[]} */
  const violations = [];
  /** @type {string[]} */
  const undecodable = [];
  const lock = { total: 0, violations: /** @type {string[]} */ ([]) };
  let scanned = 0;

  /** @param {string} path @param {string} label @param {Uint8Array} bytes */
  const scanFile = (path, label, bytes) => {
    const text = decodeFile(path, bytes);
    if (text === null) {
      undecodable.push(label);
      return;
    }
    scanned++;
    if (path === LOCKFILE || path.endsWith(`/${LOCKFILE}`)) {
      // ダウンロード元の URL が大量に入っているため、resolved が npm レジストリだけであることを別に確かめる
      const r = checkLockfileResolved(text, ALLOWED_LOCK_RESOLVED_PREFIX);
      lock.total += r.total;
      for (const line of r.violationLines) lock.violations.push(`${label}:${line}`);
      return;
    }
    for (const line of domainViolationLines(text, ALLOW)) violations.push(`${label}:${line}`);
  };

  for (const f of workingTreeFiles()) scanFile(f.path, f.path, f.bytes);
  if (opts.history) {
    for (const b of historyBlobs()) scanFile(b.path, `${b.path}@blob:${b.sha.slice(0, 10)}`, b.bytes);
    for (const c of commitMessages()) {
      scanned++;
      for (const line of domainViolationLines(c.message, ALLOW)) violations.push(`コミットメッセージ@${c.commit}:${line}`);
    }
  }
  return { violations: [...new Set(violations)], undecodable: [...new Set(undecodable)], scanned, lock };
}

/** @param {ReturnType<typeof runDomainCheck>} r @param {boolean} history */
export function printDomainResult(r, history) {
  console.log(`ドメイン検査（${history ? 'ワーキングツリー + 全履歴' : 'ワーキングツリー'}）: ${r.scanned} 件を検査`);
  console.log(`  許可リスト外のドメイン・IPv4 を含む行: ${r.violations.length} 件`);
  for (const v of r.violations) console.log(`    ${v}`);
  console.log(`  package-lock.json の resolved: ${r.lock.total} 件中、npm レジストリ以外 ${r.lock.violations.length} 件`);
  for (const v of r.lock.violations) console.log(`    ${v}`);
  if (r.undecodable.length > 0) {
    console.log(`  テキストとして読めず未検査: ${r.undecodable.length} 件`);
    for (const u of r.undecodable) console.log(`    ${u}`);
  }
  return r.violations.length === 0 && r.lock.violations.length === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const history = process.argv.includes('--history');
    const ok = printDomainResult(runDomainCheck({ history }), history);
    console.log(ok ? '結果: OK' : '結果: NG');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(`実行エラー: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
