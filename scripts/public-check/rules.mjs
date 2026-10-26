// 公開前チェックの判定ロジック（純関数）。入出力は呼び出し側（domains.mjs など）で行う。
// 実データが漏れないよう、判定結果には一致した文字列を含めず、行番号や件数だけを返す。
import iconv from 'iconv-lite';

/**
 * 裸のドメイン（URL やメールアドレスの形になっていないもの）として扱うラベル。
 * `IFilter.def` や `0000abcd.mb`、`vite.config.ts` のようなファイル名を拾わないよう、
 * 末尾のラベルが一般的な TLD のもの、または「セカンドレベル + 2 文字の国別 TLD」の形のものに限る。
 * ここに無い TLD の裸のドメインは見逃す。
 */
export const BARE_DOMAIN_LABELS = new Set([
  'com', 'net', 'org', 'jp', 'io', 'dev', 'app', 'info', 'biz', 'xyz', 'cloud', 'ai',
  'tokyo', 'osaka', 'nagoya', 'online', 'site', 'tech', 'page',
]);

/** 2 文字の国別 TLD の直前に付くセカンドレベルのラベル（co・com・ne など） */
export const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'net', 'org', 'ne', 'or', 'ac', 'go', 'gr', 'ed', 'lg', 'ad', 'gov', 'edu']);

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/?#"'`<>()[\]{}\\]+)/gi;
const EMAIL_RE = /[a-z0-9._%+-]*@((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?![a-z0-9-])/gi;
// 識別子の一部（`outputs.page_url` など）を拾わないよう、前後が _ のものも除く
const BARE_RE = /(?<![a-z0-9_@.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?![a-z0-9_-])/gi;
const IPV4_RE = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g;

/** URL の authority からホスト名を取り出す（userinfo・ポートを除く） */
function hostOfAuthority(authority) {
  const host = authority.replace(/^.*@/, '').replace(/:\d*$/, '').replace(/\.$/, '');
  return host.toLowerCase();
}

/**
 * テキスト中のドメイン・IPv4 アドレスの候補を返す。
 * @param {string} text
 * @returns {{ line: number; kind: 'url' | 'email' | 'bare' | 'ipv4'; host: string }[]}
 */
export function extractHosts(text) {
  /** @type {{ line: number; kind: 'url' | 'email' | 'bare' | 'ipv4'; host: string }[]} */
  const out = [];
  const lines = text.split(/\r\n|\n|\r/);
  lines.forEach((lineText, i) => {
    const line = i + 1;
    for (const m of lineText.matchAll(URL_RE)) {
      const host = hostOfAuthority(m[1]);
      // テンプレートの埋め込み（`${...}`）や `<名前>` のような、ホスト名になっていないものは除く
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) out.push({ line, kind: 'url', host });
    }
    for (const m of lineText.matchAll(EMAIL_RE)) out.push({ line, kind: 'email', host: m[1].toLowerCase() });
    for (const m of lineText.matchAll(BARE_RE)) {
      const labels = m[1].toLowerCase().split('.');
      const last = labels[labels.length - 1] ?? '';
      const second = labels.length >= 3 ? (labels[labels.length - 2] ?? '') : '';
      if (BARE_DOMAIN_LABELS.has(last) || (last.length === 2 && SECOND_LEVEL_LABELS.has(second))) {
        out.push({ line, kind: 'bare', host: labels.join('.') });
      }
    }
    for (const m of lineText.matchAll(IPV4_RE)) {
      if (m[1].split('.').every((n) => Number(n) <= 255)) out.push({ line, kind: 'ipv4', host: m[1] });
    }
  });
  return out;
}

/**
 * ホストが許可リストに入っているか。ドメインはサブドメインも許可する。
 * @param {string} host
 * @param {{ domains: string[]; ipv4: string[] }} allow
 */
export function isAllowedHost(host, allow) {
  const h = host.toLowerCase();
  if (/^\d+(\.\d+){3}$/.test(h)) return allow.ipv4.includes(h);
  return allow.domains.some((d) => {
    const dl = d.toLowerCase();
    return h === dl || h.endsWith(`.${dl}`);
  });
}

/**
 * 許可されていないホストを含む行番号（重複なし・昇順）。ホスト名そのものは返さない。
 * @param {string} text
 * @param {{ domains: string[]; ipv4: string[] }} allow
 * @returns {number[]}
 */
export function domainViolationLines(text, allow) {
  const lines = new Set();
  for (const c of extractHosts(text)) if (!isAllowedHost(c.host, allow)) lines.add(c.line);
  return [...lines].sort((a, b) => a - b);
}

/**
 * package-lock.json の resolved を検査する。
 * @param {string} text
 * @param {string} prefix
 * @returns {{ total: number; violationLines: number[] }}
 */
export function checkLockfileResolved(text, prefix) {
  let total = 0;
  /** @type {number[]} */
  const violationLines = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const m = /"resolved"\s*:\s*"([^"]*)"/.exec(l);
    if (!m) return;
    total++;
    if (!m[1].startsWith(prefix)) violationLines.push(i + 1);
  });
  return { total, violationLines };
}

/** ASCII の英大文字だけを小文字にしたコピー（大文字小文字を無視した照合用） */
function asciiLower(bytes) {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < out.length; i++) if (out[i] >= 0x41 && out[i] <= 0x5a) out[i] += 0x20;
  return out;
}

/**
 * 検索語を、照合に使うバイト列（UTF-8 と CP932、ASCII は小文字化）にする。
 * CP932 で表せない語は UTF-8 だけを使う。
 * @param {string} term
 * @returns {Uint8Array[]}
 */
export function termPatterns(term) {
  const utf8 = asciiLower(new TextEncoder().encode(term));
  const patterns = [utf8];
  const sjis = new Uint8Array(iconv.encode(term, 'cp932'));
  if (iconv.decode(Buffer.from(sjis), 'cp932') === term) {
    const lower = asciiLower(sjis);
    if (!bytesEqual(lower, utf8)) patterns.push(lower);
  }
  return patterns;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * バイト列の中で、いずれかのパターンが現れる回数。
 * 大文字小文字の無視は ASCII のバイト単位で行う（CP932 の 2 バイト目も小文字化するため、
 * 誤検出はありうるが見逃しは起こらない）。
 * @param {Uint8Array} haystack
 * @param {Uint8Array[]} patterns
 */
export function countMatches(haystack, patterns) {
  const hay = Buffer.from(asciiLower(haystack));
  let count = 0;
  for (const p of patterns) {
    if (p.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(p, from);
      if (at === -1) break;
      count++;
      from = at + 1;
    }
  }
  return count;
}

/**
 * リポジトリに入れてはいけないパスなら理由を返す。
 * @param {string} path スラッシュ区切りのリポジトリ相対パス
 * @returns {string | null}
 */
export function forbiddenPathReason(path) {
  const name = path.split('/').pop() ?? path;
  if (/\.def$/i.test(name) && !/^samples\/[^/]+\.sample\.def$/.test(path)) return '*.def（サンプル以外）';
  if (/\.bak-/i.test(name)) return '*.bak-*';
  if (/Zone\.Identifier/i.test(path)) return 'Zone.Identifier';
  if (/(^|\/)node_modules(\/|$)/.test(path)) return 'node_modules';
  if (/^dist(\/|$)/.test(path)) return 'dist';
  return null;
}

/**
 * 公開してよいコミットのメールアドレスか。
 * @param {string} email
 * @param {'person' | 'co-author'} role
 */
export function isPublicEmail(email, role) {
  const e = email.toLowerCase();
  if (e.endsWith('@users.noreply.github.com')) return true;
  return role === 'co-author' && e === 'noreply@anthropic.com';
}
