export type ParseErrorKind =
  | 'unterminated-rule'
  | 'nested-begin'
  | 'unmatched-end'
  | 'bare-lf'
  | 'bare-cr';

const DESCRIPTIONS: Record<ParseErrorKind, string> = {
  'unterminated-rule': ':Begin に対応する :End がありません',
  'nested-begin': ':End の前に次の :Begin があります',
  'unmatched-end': '対応する :Begin の無い :End があります',
  'bare-lf': '改行が CRLF ではありません（LF のみ）',
  'bare-cr': '改行が CRLF ではありません（CR のみ）',
};

/** 読み込みを拒否する形式エラー。実データの漏えいを防ぐため、メッセージに行の内容は含めない */
export class ParseError extends Error {
  readonly kind: ParseErrorKind;
  /** 1 始まりの行番号 */
  readonly line: number;

  constructor(kind: ParseErrorKind, line: number) {
    super(`${line} 行目: ${DESCRIPTIONS[kind]}`);
    this.name = 'ParseError';
    this.kind = kind;
    this.line = line;
  }
}
