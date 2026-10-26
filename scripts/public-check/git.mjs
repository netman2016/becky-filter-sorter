// 公開前チェックで使う git コマンドの薄いラッパ。読み取り専用のコマンドだけを使う。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** @param {string[]} args */
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** @param {string[]} args @param {string | Buffer} [input] */
function gitBuffer(args, input) {
  const r = spawnSync('git', args, { cwd: ROOT, input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args[0]} が失敗しました（終了コード ${r.status}）`);
  return r.stdout;
}

/**
 * ワーキングツリーで公開対象になりうるファイル（追跡中 + 未追跡で無視されていないもの）。
 * @returns {{ path: string; bytes: Uint8Array }[]}
 */
export function workingTreeFiles() {
  const paths = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  return [...new Set(paths)]
    .filter((p) => existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile())
    .map((path) => ({ path, bytes: new Uint8Array(readFileSync(join(ROOT, path))) }));
}

/**
 * 全履歴（git rev-list --all）から到達できるすべての blob と、そのパス。
 * 同じ blob が複数のパスにあるときは、最初に見つかったパスを使う。
 * @returns {{ path: string; sha: string; bytes: Uint8Array }[]}
 */
export function historyBlobs() {
  /** @type {Map<string, string>} */
  const pathBySha = new Map();
  for (const line of git(['rev-list', '--all', '--objects']).split('\n')) {
    const sp = line.indexOf(' ');
    if (sp === -1) continue; // コミット（パスなし）
    const sha = line.slice(0, sp);
    if (!pathBySha.has(sha)) pathBySha.set(sha, line.slice(sp + 1));
  }
  if (pathBySha.size === 0) return [];
  const out = gitBuffer(['cat-file', '--batch'], [...pathBySha.keys()].join('\n') + '\n');
  /** @type {{ path: string; sha: string; bytes: Uint8Array }[]} */
  const blobs = [];
  let pos = 0;
  while (pos < out.length) {
    const nl = out.indexOf(0x0a, pos);
    const [sha, type, size] = out.subarray(pos, nl).toString('latin1').split(' ');
    const n = Number(size);
    const body = out.subarray(nl + 1, nl + 1 + n);
    pos = nl + 1 + n + 1;
    if (type === 'blob' && sha) blobs.push({ path: pathBySha.get(sha) ?? '', sha, bytes: new Uint8Array(body) });
  }
  return blobs;
}

/** 全履歴に現れるパス（blob とツリーの両方） */
export function historyPaths() {
  const paths = new Set();
  for (const line of git(['rev-list', '--all', '--objects']).split('\n')) {
    const sp = line.indexOf(' ');
    if (sp !== -1) paths.add(line.slice(sp + 1));
  }
  for (const p of git(['ls-files', '-z', '--cached']).split('\0')) if (p) paths.add(p);
  return [...paths];
}

/**
 * 全コミットのメッセージ。
 * @returns {{ commit: string; message: string }[]}
 */
export function commitMessages() {
  return git(['log', '--all', '--format=%h%x00%B%x01'])
    .split('\x01')
    .map((s) => s.replace(/^\n/, ''))
    .filter((s) => s.includes('\0'))
    .map((s) => {
      const [commit, message] = s.split('\0');
      return { commit: commit ?? '', message: message ?? '' };
    });
}

/**
 * 作者・コミッタ・Co-Authored-By・タグの tagger（重複なし、出現回数つき）。
 * @returns {{ role: 'author' | 'committer' | 'co-author' | 'tagger'; name: string; email: string; count: number }[]}
 */
export function identities() {
  /** @type {Map<string, { role: 'author' | 'committer' | 'co-author' | 'tagger'; name: string; email: string; count: number }>} */
  const map = new Map();
  /** @param {'author' | 'committer' | 'co-author' | 'tagger'} role @param {string} name @param {string} email */
  const add = (role, name, email) => {
    const key = `${role}\0${name}\0${email}`;
    const cur = map.get(key);
    if (cur) cur.count++;
    else map.set(key, { role, name, email, count: 1 });
  };
  const log = git(['log', '--all', '--format=%an%x00%ae%x00%cn%x00%ce%x00%(trailers:key=Co-Authored-By,valueonly,separator=%x02)%x01']);
  for (const rec of log.split('\x01')) {
    const fields = rec.replace(/^\n/, '').split('\0');
    if (fields.length < 5) continue;
    const [an, ae, cn, ce, trailers] = fields;
    add('author', an ?? '', ae ?? '');
    add('committer', cn ?? '', ce ?? '');
    for (const t of (trailers ?? '').split('\x02').map((s) => s.trim()).filter(Boolean)) {
      const m = /^(.*?)\s*<([^>]*)>$/.exec(t);
      add('co-author', m ? (m[1] ?? '') : t, m ? (m[2] ?? '') : '');
    }
  }
  for (const line of git(['for-each-ref', 'refs/tags', '--format=%(taggername)%00%(taggeremail)']).split('\n')) {
    const [name, email] = line.split('\0');
    if (name) add('tagger', name, (email ?? '').replace(/^<|>$/g, ''));
  }
  return [...map.values()];
}

/** すべての ref 名 */
export function refNames() {
  return git(['for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean);
}

/**
 * パスが .gitignore で無視されるか（ファイルの有無・追跡状態に関係なくパターンで判定）。
 * @param {string} path
 */
export function isIgnored(path) {
  return spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: ROOT }).status === 0;
}
