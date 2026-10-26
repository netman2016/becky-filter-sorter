/** :Begin より前の行（各要素は行末の CRLF を含むバイト列） */
export type Header = { rawLines: Uint8Array[] };

export type Condition = {
  /** 例: "From", "Subject", "[body]", "*" */
  field: string;
  /** 表示・判定用にデコードした文字列 */
  text: string;
  /** "O", "I" などを解釈せず保持する */
  flags: string[];
  /** 元の 1 行（CRLF を含まないバイト列） */
  raw: Uint8Array;
};

export type Rule = {
  /** ロード時に採番する ID（ファイルには書かない） */
  id: string;
  /** 読み込み時の位置（0 始まり） */
  originalIndex: number;
  /** :Begin 行の先頭〜次の :Begin の直前（最後のルールは :End 行まで）の生バイト。保存にはこれを使う */
  raw: Uint8Array;
  /** 例: "0000abcd.mb"。振り分け先が無ければ空文字 */
  destMailbox: string;
  /** 例: "Inbox\\仕事\\"。振り分け先が無ければ空文字 */
  destFolder: string;
  conditions: Condition[];
  /** 想定外の行のルール内インデックス（:Begin 行が 0）。保持するだけで解釈しない */
  unknownLines: number[];
};

export type FilterDocument = {
  header: Header;
  rules: Rule[];
  /** 最後のルールの :End より後ろの生バイト */
  trailing: Uint8Array;
};

/**
 * パース警告。実データの漏えいを防ぐため、行の内容は持たない。
 * - unknown-line: ルール内の想定外の行
 * - line-after-end: :End より後ろ・次の :Begin より前の行（直前のルールに含めて保持）
 * - trailing-line: 最後のルールより後ろの行
 * - unknown-flag: O / I 以外のフラグを持つ条件
 * - no-destination: 振り分け先（!M:）の無いルール
 * - missing-final-newline: ファイル末尾に CRLF が無い
 */
export type ParseWarningKind =
  | 'unknown-line'
  | 'line-after-end'
  | 'trailing-line'
  | 'unknown-flag'
  | 'no-destination'
  | 'missing-final-newline';

export type ParseWarning = {
  kind: ParseWarningKind;
  /** 対象ルールの位置（0 始まり）。ルールに属さない場合は null */
  ruleIndex: number | null;
  /** ファイル内の行番号（1 始まり） */
  line: number;
};

export type ParseResult = { doc: FilterDocument; warnings: ParseWarning[] };
