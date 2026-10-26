import { endsWithCRLF, splitLinesCRLF, startsWithAscii, type LineSpan } from './bytes';
import { decodeCp932 } from './decode';
import { ParseError } from './errors';
import type { Condition, FilterDocument, ParseResult, ParseWarning, Rule } from './types';

const KNOWN_FLAGS = new Set(['O', 'I']);
const DEST_SEPARATOR = '\\!!!!';

/** 行頭が `:Begin` / `:End` で、その後が行末か空白か */
function isMarker(bytes: Uint8Array, line: LineSpan, marker: ':Begin' | ':End'): boolean {
  if (!startsWithAscii(bytes, line.start, marker)) return false;
  const after = line.start + marker.length;
  return after === line.end || bytes[after] === 0x20;
}

type Block = { beginLine: number; endLine: number };

/**
 * IFilter.def のバイト列をパースする。
 * 各ルールは元のバイト列から切り出した raw を持ち、デコード結果は表示・判定にのみ使う。
 * 形式が崩れている場合は ParseError（行番号つき）を投げる。
 */
export function parseIFilter(bytes: Uint8Array): ParseResult {
  const lines = splitLinesCRLF(bytes);
  const warnings: ParseWarning[] = [];

  // :Begin / :End の対応を取る
  const blocks: Block[] = [];
  let openBegin: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isMarker(bytes, line, ':Begin')) {
      if (openBegin !== null) throw new ParseError('nested-begin', i + 1);
      openBegin = i;
    } else if (isMarker(bytes, line, ':End')) {
      if (openBegin === null) throw new ParseError('unmatched-end', i + 1);
      blocks.push({ beginLine: openBegin, endLine: i });
      openBegin = null;
    }
  }
  if (openBegin !== null) throw new ParseError('unterminated-rule', openBegin + 1);

  const headerLineCount = blocks.length > 0 ? blocks[0]!.beginLine : lines.length;
  const header = {
    rawLines: lines.slice(0, headerLineCount).map((l) => bytes.slice(l.start, l.next)),
  };

  const rules: Rule[] = blocks.map((block, index) => {
    const isLast = index === blocks.length - 1;
    // ルール間の行は直前のルールに含める。最後のルールより後ろは trailing
    const lastLine = isLast ? block.endLine : blocks[index + 1]!.beginLine - 1;
    const start = lines[block.beginLine]!.start;
    const end = lines[lastLine]!.next;
    return parseRule(bytes, lines, block, lastLine, index, bytes.slice(start, end), warnings);
  });

  let trailing = new Uint8Array(0);
  if (blocks.length > 0) {
    const lastEnd = blocks[blocks.length - 1]!.endLine;
    trailing = bytes.slice(lines[lastEnd]!.next);
    for (let i = lastEnd + 1; i < lines.length; i++) {
      warnings.push({ kind: 'trailing-line', ruleIndex: null, line: i + 1 });
    }
  }

  if (bytes.length > 0 && !endsWithCRLF(bytes)) {
    warnings.push({ kind: 'missing-final-newline', ruleIndex: null, line: lines.length });
  }

  const doc: FilterDocument = { header, rules, trailing };
  return { doc, warnings };
}

function parseRule(
  bytes: Uint8Array,
  lines: LineSpan[],
  block: Block,
  lastLine: number,
  index: number,
  raw: Uint8Array,
  warnings: ParseWarning[],
): Rule {
  let destMailbox = '';
  let destFolder = '';
  let hasDest = false;
  const conditions: Condition[] = [];
  const unknownLines: number[] = [];

  // :Begin 行と :End 行の間を解釈する
  for (let i = block.beginLine + 1; i < block.endLine; i++) {
    const span = lines[i]!;
    const lineBytes = bytes.slice(span.start, span.end);
    // CP932 は 0x5C(\) や 0x40(@) が 2 バイト目に現れるため、デコード後の文字列で解釈する
    const text = decodeCp932(lineBytes);
    const ruleLineIndex = i - block.beginLine;

    if (text.startsWith('!M:') && !hasDest) {
      const dest = parseDestination(text);
      if (dest) {
        destMailbox = dest.mailbox;
        destFolder = dest.folder;
        hasDest = true;
        continue;
      }
    } else if (text.startsWith('@0:')) {
      const cond = parseCondition(text, lineBytes);
      if (cond) {
        conditions.push(cond);
        if (cond.flags.some((f) => !KNOWN_FLAGS.has(f))) {
          warnings.push({ kind: 'unknown-flag', ruleIndex: index, line: i + 1 });
        }
        continue;
      }
    } else if (text === '$O:Sort=1') {
      continue;
    }

    unknownLines.push(ruleLineIndex);
    warnings.push({ kind: 'unknown-line', ruleIndex: index, line: i + 1 });
  }

  // :End の後ろ（次の :Begin の前）の行
  for (let i = block.endLine + 1; i <= lastLine; i++) {
    unknownLines.push(i - block.beginLine);
    warnings.push({ kind: 'line-after-end', ruleIndex: index, line: i + 1 });
  }

  if (!hasDest) {
    warnings.push({ kind: 'no-destination', ruleIndex: index, line: block.beginLine + 1 });
  }

  return {
    id: `r${String(index + 1).padStart(4, '0')}`,
    originalIndex: index,
    raw,
    destMailbox,
    destFolder,
    conditions,
    unknownLines,
  };
}

/** `!M:<mailbox>\!!!!<フォルダパス>` */
function parseDestination(text: string): { mailbox: string; folder: string } | null {
  const body = text.slice('!M:'.length);
  const sep = body.indexOf(DEST_SEPARATOR);
  if (sep < 0) return null;
  return { mailbox: body.slice(0, sep), folder: body.slice(sep + DEST_SEPARATOR.length) };
}

/** `@0:<field>:<text>\t<flag>\t<flag>...` */
function parseCondition(text: string, raw: Uint8Array): Condition | null {
  const body = text.slice('@0:'.length);
  const colon = body.indexOf(':');
  if (colon < 0) return null;
  const field = body.slice(0, colon);
  const rest = body.slice(colon + 1);
  const tab = rest.indexOf('\t');
  if (tab < 0) return { field, text: rest, flags: [], raw };
  return { field, text: rest.slice(0, tab), flags: rest.slice(tab + 1).split('\t'), raw };
}
