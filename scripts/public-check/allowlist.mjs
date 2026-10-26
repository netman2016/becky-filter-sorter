// 公開前チェックの許可リスト。追加するときは、必ず理由をコメントに書くこと。
// ここに実在の個人・組織のドメインや、実データに由来する文字列を入れてはいけない。

/**
 * 許可するドメイン。サブドメインも許可する（大文字小文字は区別しない）。
 * @type {{ domain: string; reason: string }[]}
 */
export const ALLOWED_DOMAINS = [
  { domain: 'example.com', reason: '架空データ用の予約ドメイン（RFC 2606）' },
  { domain: 'example.jp', reason: '架空データ用の予約ドメイン（JPRS）' },
  { domain: 'example.org', reason: '架空データ用の予約ドメイン（RFC 2606）' },
  { domain: 'localhost', reason: 'ローカルの開発サーバー' },
  { domain: 'github.com', reason: 'リポジトリ・GitHub Actions（アクションの公開元）' },
  { domain: 'github.io', reason: 'GitHub Pages の公開 URL の説明' },
  { domain: 'users.noreply.github.com', reason: 'コミットの作者用 noreply アドレス' },
  { domain: 'anthropic.com', reason: 'コミットの Co-Authored-By トレーラー（noreply アドレス）' },
  { domain: 'npmjs.org', reason: 'package-lock.json の resolved（npm レジストリ）の検査で参照' },
  { domain: 'w3.org', reason: 'dist/ に含まれる XML 名前空間 URI（下の ALLOWED_DIST_URLS）' },
  { domain: 'react.dev', reason: 'dist/ に含まれる React のエラー文言の URL（下の ALLOWED_DIST_URLS）' },
];

/**
 * 許可する IPv4 アドレス。
 * @type {string[]}
 */
export const ALLOWED_IPV4 = ['127.0.0.1', '0.0.0.0'];

/** package-lock.json の resolved として許可する URL の先頭 */
export const ALLOWED_LOCK_RESOLVED_PREFIX = 'https://registry.npmjs.org/';

/**
 * dist/ に含まれてよい URL（完全一致）。どれもブラウザが通信しない文字列。
 * @type {{ url: string; reason: string }[]}
 */
export const ALLOWED_DIST_URLS = [
  { url: 'http://www.w3.org/2000/svg', reason: 'SVG の XML 名前空間 URI（react-dom）' },
  { url: 'http://www.w3.org/1999/xlink', reason: 'XLink の XML 名前空間 URI（react-dom）' },
  { url: 'http://www.w3.org/1998/Math/MathML', reason: 'MathML の XML 名前空間 URI（react-dom）' },
  { url: 'http://www.w3.org/XML/1998/namespace', reason: 'XML の名前空間 URI（react-dom）' },
  { url: 'https://react.dev/errors/', reason: 'React の本番用エラー文言に含まれる URL（表示用の文字列）' },
];
