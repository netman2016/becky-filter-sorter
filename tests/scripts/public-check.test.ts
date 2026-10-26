// 公開前チェックの判定ロジック。架空の文字列だけを使う。
import { describe, expect, it } from 'vitest';
import {
  checkLockfileResolved,
  countMatches,
  domainViolationLines,
  extractHosts,
  forbiddenPathReason,
  isAllowedHost,
  isPublicEmail,
  termPatterns,
} from '../../scripts/public-check/rules.mjs';
import { cp932 } from '../helpers';

// 許可外のホストは、このファイル自体が check:domains に引っかからないよう、ラベルを "." で連結して作る
const host = (...labels: string[]) => labels.join('.');
const NET = host('docs', 'example', 'net');
const CO_UK = host('mail', 'example', 'co', 'uk');
const INFO = host('sub', 'example', 'info');
const IP = host('192', '0', '2', '1');

const ALLOW = { domains: ['example.com', 'example.jp', 'example.org', 'github.com'], ipv4: ['127.0.0.1'] };

describe('ドメインの抽出と許可判定', () => {
  it('URL・メールアドレス・裸のドメイン・IPv4 を拾う', () => {
    const hosts = extractHosts(
      [`see https://user@${NET}:8080/path`, `mail: someone@${CO_UK}`, `bare ${INFO}`, `ip ${IP}`].join('\n'),
    ).map((h) => `${h.line}:${h.kind}:${h.host}`);
    expect(hosts).toContain(`1:url:${NET}`);
    expect(hosts).toContain(`2:email:${CO_UK}`);
    expect(hosts).toContain(`3:bare:${INFO}`);
    expect(hosts).toContain(`4:ipv4:${IP}`);
  });

  it('ファイル名・メールボックス ID・バージョン・条件行は拾わない', () => {
    const text = [
      'IFilter.def',
      'IFilter.sample.def',
      '!M:0000abcd.mb\\!!!!Inbox\\',
      '@0:From:x\tO\tI',
      'vite.config.ts',
      'tsconfig.app.json',
      'package-lock.json',
      'react@19.3.1',
      '@dnd-kit/core',
      'node 22.12.0',
      '${{ steps.deployment.outputs.page_url }}',
    ].join('\n');
    expect(extractHosts(text)).toEqual([]);
  });

  it('許可ドメインとそのサブドメインは大文字小文字を無視して許可する', () => {
    expect(isAllowedHost('EXAMPLE.com', ALLOW)).toBe(true);
    expect(isAllowedHost('news.Example.org', ALLOW)).toBe(true);
    expect(isAllowedHost(`example.com.${NET}`, ALLOW)).toBe(false);
    expect(isAllowedHost(host('notexample', 'com'), ALLOW)).toBe(false);
    expect(isAllowedHost('127.0.0.1', ALLOW)).toBe(true);
    expect(isAllowedHost(IP, ALLOW)).toBe(false);
  });

  it('違反は行番号だけを返す', () => {
    const text = ['ok a@example.com', `ng b@${NET}`, 'ok https://github.com/x', `ng ${CO_UK}`].join('\n');
    expect(domainViolationLines(text, ALLOW)).toEqual([2, 4]);
  });

  it('package-lock.json の resolved は指定の先頭だけを許可する', () => {
    const lock = [
      '"resolved": "https://registry.npmjs.org/a/-/a-1.0.0.tgz",',
      `"resolved": "https://${NET}/b.tgz",`,
    ].join('\n');
    expect(checkLockfileResolved(lock, 'https://registry.npmjs.org/')).toEqual({ total: 2, violationLines: [2] });
  });
});

describe('検索語の照合', () => {
  it('大文字小文字を無視し、UTF-8 と CP932 の両方で見つける', () => {
    const utf8 = new TextEncoder().encode('xx 0000ABCD.mb 架空フォルダ');
    const sjis = cp932('yy 0000abcd.mb 架空フォルダ');
    expect(countMatches(utf8, termPatterns('0000abcd'))).toBe(1);
    expect(countMatches(sjis, termPatterns('0000ABCD'))).toBe(1);
    expect(countMatches(utf8, termPatterns('架空フォルダ'))).toBe(1);
    expect(countMatches(sjis, termPatterns('架空フォルダ'))).toBe(1);
    expect(countMatches(sjis, termPatterns('存在しない語'))).toBe(0);
  });
});

describe('禁止パス', () => {
  it('サンプル以外の .def・.bak-*・Zone.Identifier・node_modules・dist', () => {
    expect(forbiddenPathReason('samples/IFilter.sample.def')).toBeNull();
    expect(forbiddenPathReason('src/core/parse.ts')).toBeNull();
    expect(forbiddenPathReason('IFilter.def')).not.toBeNull();
    expect(forbiddenPathReason('samples/IFilter.def')).not.toBeNull();
    expect(forbiddenPathReason('IFilter.def.bak-20260101-000000')).not.toBeNull();
    expect(forbiddenPathReason('a.txt:Zone.Identifier')).not.toBeNull();
    expect(forbiddenPathReason('node_modules/x/index.js')).not.toBeNull();
    expect(forbiddenPathReason('dist/index.html')).not.toBeNull();
  });
});

describe('コミットのメールアドレス', () => {
  it('noreply アドレスだけを公開可とする', () => {
    expect(isPublicEmail('1+someone@users.noreply.github.com', 'person')).toBe(true);
    expect(isPublicEmail('someone@example.com', 'person')).toBe(false);
    expect(isPublicEmail('noreply@anthropic.com', 'co-author')).toBe(true);
    expect(isPublicEmail('noreply@anthropic.com', 'person')).toBe(false);
  });
});
