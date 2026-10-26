import {
  isOnlyReordered,
  moveRules,
  moveRulesBy,
  ParseError,
  parseIFilter,
  type FilterDocument,
  type ParseWarning,
} from '../../core';
import type { DirectoryHandleLike, FileSession } from '../fs/fileAccess';
import type { SaveOutcome } from '../fs/outcome';
import { orderAfterDrop } from './dropIndex';

const HISTORY_LIMIT = 500;

/** 「10件上 / 10件下」で動かす件数（全体の並び順での件数） */
export const PAGE_MOVE_STEP = 10;

export type Notice = { level: 'info' | 'error'; message: string };

export type LoadedFile = {
  fileName: string;
  /** 開いたファイルのハンドルと、保存用に選ばれたフォルダ（値として保持するだけ） */
  session: FileSession;
  doc: FilterDocument;
  warnings: ParseWarning[];
  /** 基準（読み込み時、または保存して確認できた時点）のバイト列 */
  baseBytes: Uint8Array;
  /** 基準の並び順（= doc.rules の順） */
  baseOrder: string[];
  order: string[];
  /** 選択中のルール ID */
  selection: string[];
  /** Shift 選択の起点 */
  anchorId: string | null;
  /** ↑/↓ の現在位置 */
  focusId: string | null;
  past: string[][];
  future: string[][];
};

export type EditorState = { file: LoadedFile | null; notice: Notice | null };

export type EditorAction =
  | { type: 'loaded'; fileName: string; bytes: Uint8Array; session?: FileSession }
  | { type: 'loadFailed'; message: string }
  // visible: 絞り込み中に表示している行（全体の順序のまま）。省略時は全体が対象
  | { type: 'click'; id: string; shift: boolean; ctrl: boolean; visible?: string[] }
  | { type: 'cursor'; delta: number; extend: boolean; visible?: string[] }
  | { type: 'selectAll'; visible?: string[] }
  /** 選択を ids に含まれるものだけに絞る（絞り込みの切り替え時） */
  | { type: 'retainSelection'; ids: string[] }
  /** そのルールだけを選択して現在位置にする（詳細ペインの #N から） */
  | { type: 'jumpTo'; id: string }
  | { type: 'clearSelection' }
  | { type: 'moveTo'; index: number }
  | { type: 'moveBy'; delta: number }
  | { type: 'moveTop' }
  | { type: 'moveBottom' }
  | { type: 'drop'; activeId: string; overId: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saveFinished'; outcome: SaveOutcome; dirHandle?: DirectoryHandleLike | null }
  | { type: 'notice'; notice: Notice | null };

export const initialEditorState: EditorState = { file: null, notice: null };

/** ファイルを読み込んで状態を作る。形式エラーは ParseError（行番号と種別のみ） */
function loadFile(fileName: string, bytes: Uint8Array, session?: FileSession): LoadedFile {
  const { doc, warnings } = parseIFilter(bytes);
  const order = doc.rules.map((r) => r.id);
  return {
    fileName,
    session: session ?? { fileName, fileHandle: null, dirHandle: null },
    doc,
    warnings,
    baseBytes: bytes,
    baseOrder: order,
    order,
    selection: [],
    anchorId: null,
    focusId: null,
    past: [],
    future: [],
  };
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function withOrder(file: LoadedFile, order: string[] | null): LoadedFile {
  if (!order || sameOrder(order, file.order)) return file;
  return {
    ...file,
    order,
    past: [...file.past, file.order].slice(-HISTORY_LIMIT),
    future: [],
  };
}

function rangeIds(order: readonly string[], fromId: string, toId: string): string[] {
  const a = order.indexOf(fromId);
  const b = order.indexOf(toId);
  if (a < 0 || b < 0) return [toId];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function fileReducer(file: LoadedFile, action: EditorAction): LoadedFile {
  switch (action.type) {
    case 'click': {
      const { id, shift, ctrl } = action;
      if (shift && file.anchorId) {
        return { ...file, selection: rangeIds(action.visible ?? file.order, file.anchorId, id), focusId: id };
      }
      if (ctrl) {
        const selection = file.selection.includes(id)
          ? file.selection.filter((s) => s !== id)
          : [...file.selection, id];
        return { ...file, selection, anchorId: id, focusId: id };
      }
      return { ...file, selection: [id], anchorId: id, focusId: id };
    }
    case 'cursor': {
      const rows = action.visible ?? file.order;
      if (rows.length === 0) return file;
      const current = file.focusId ? rows.indexOf(file.focusId) : -1;
      const next =
        current < 0
          ? action.delta > 0
            ? 0
            : rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, current + action.delta));
      const id = rows[next]!;
      if (action.extend) {
        const anchor = file.anchorId && rows.includes(file.anchorId) ? file.anchorId : id;
        return { ...file, selection: rangeIds(rows, anchor, id), anchorId: anchor, focusId: id };
      }
      return { ...file, selection: [id], anchorId: id, focusId: id };
    }
    case 'selectAll':
      return { ...file, selection: [...(action.visible ?? file.order)] };
    case 'retainSelection': {
      const keep = new Set(action.ids);
      const selection = file.selection.filter((id) => keep.has(id));
      if (selection.length === file.selection.length) return file;
      return {
        ...file,
        selection,
        anchorId: file.anchorId && keep.has(file.anchorId) ? file.anchorId : null,
        focusId: file.focusId && keep.has(file.focusId) ? file.focusId : null,
      };
    }
    case 'jumpTo':
      if (!file.order.includes(action.id)) return file;
      return { ...file, selection: [action.id], anchorId: action.id, focusId: action.id };
    case 'clearSelection':
      return { ...file, selection: [], anchorId: null };
    case 'moveTo':
      if (file.selection.length === 0) return file;
      return withOrder(file, moveRules(file.order, file.selection, action.index));
    case 'moveBy':
      if (file.selection.length === 0) return file;
      return withOrder(file, moveRulesBy(file.order, file.selection, action.delta));
    case 'moveTop':
      if (file.selection.length === 0) return file;
      return withOrder(file, moveRules(file.order, file.selection, 0));
    case 'moveBottom':
      if (file.selection.length === 0) return file;
      return withOrder(file, moveRules(file.order, file.selection, file.order.length));
    case 'drop': {
      const order = orderAfterDrop(file.order, file.selection, action.activeId, action.overId);
      const next = withOrder(file, order);
      // 選択外の行をつかんだ場合は、その行を選択状態にする
      if (next !== file && !file.selection.includes(action.activeId)) {
        return { ...next, selection: [action.activeId], anchorId: action.activeId, focusId: action.activeId };
      }
      return next;
    }
    case 'undo': {
      const prev = file.past[file.past.length - 1];
      if (!prev) return file;
      return { ...file, order: prev, past: file.past.slice(0, -1), future: [file.order, ...file.future] };
    }
    case 'redo': {
      const [next, ...future] = file.future;
      if (!next) return file;
      return { ...file, order: next, past: [...file.past, file.order], future };
    }
    default:
      return file;
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'loaded':
      try {
        return { file: loadFile(action.fileName, action.bytes, action.session), notice: null };
      } catch (e) {
        return { ...state, notice: { level: 'error', message: loadErrorMessage(e) } };
      }
    case 'loadFailed':
      return { ...state, notice: { level: 'error', message: action.message } };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'saveFinished':
      return applySaveOutcome(state, action.outcome, action.dirHandle);
  }
  if (!state.file) return state;
  const file = fileReducer(state.file, action);
  return file === state.file ? state : { ...state, file };
}

function applySaveOutcome(
  state: EditorState,
  outcome: SaveOutcome,
  dirHandle: DirectoryHandleLike | null | undefined,
): EditorState {
  const notice = describeSaveOutcome(outcome);
  if (!state.file) return { ...state, notice };
  const session =
    dirHandle === undefined ? state.file.session : { ...state.file.session, dirHandle };
  if (outcome.kind !== 'saved') return { file: { ...state.file, session }, notice };
  // 書き込みを読み戻して一致を確認できたときだけ、新しい基準にする
  try {
    return { file: loadFile(outcome.fileName, outcome.bytes, session), notice };
  } catch {
    return {
      file: { ...state.file, session },
      notice: {
        level: 'error',
        message: `保存したファイルを読み込み直せませんでした。元の内容は ${outcome.backupName} にあります。`,
      },
    };
  }
}

function loadErrorMessage(e: unknown): string {
  if (e instanceof ParseError) return `ファイルを読み込めませんでした。${e.message}`;
  return 'ファイルを読み込めませんでした。IFilter.def の形式ではない可能性があります。';
}

/** 保存結果の案内文。ファイル名以外の実データは含めない */
export function describeSaveOutcome(outcome: SaveOutcome): Notice | null {
  switch (outcome.kind) {
    case 'saved':
      return { level: 'info', message: `保存しました。バックアップ: ${outcome.backupName}` };
    case 'fallback-download':
      return null;
    case 'downloaded':
      return {
        level: 'info',
        message:
          (outcome.viaFallback ? 'フォルダを選べなかったため、ダウンロードで保存しました。' : '') +
          `${outcome.backupName}（元の内容）と ${outcome.fileName}（並び替え後）をダウンロードしました。` +
          '元ファイルの置き換えは手動で行ってください。置き換えたあと、このツールで再度ファイルを開き直してください。',
      };
    case 'aborted':
      return { level: 'error', message: `保存を中止しました（ファイルは変更していません）。${abortReason(outcome)}` };
    case 'verify-failed':
      return {
        level: 'error',
        message:
          `保存内容の確認に失敗しました${outcome.errorName ? `（${outcome.errorName}）` : ''}。` +
          `元の内容は ${outcome.backupName} にあります。Becky! を起動する前に、` +
          `${outcome.backupName} を元の名前（${outcome.fileName}）に戻して（コピーして）ください。または再度保存してください。`,
      };
  }
}

function abortReason(outcome: Extract<SaveOutcome, { kind: 'aborted' }>): string {
  switch (outcome.reason) {
    case 'not-same-file':
      return '選んだフォルダに、開いているファイルがありません。ファイルのあるフォルダを選んでください。';
    case 'changed-on-disk':
      return '読み込み後にファイルが変更されています。ファイルを開き直してから並び替えてください。';
    case 'backup-exists':
      return '同じ名前のバックアップが既にあります。少し待ってから再度保存してください。';
    case 'backup-verify-failed':
      return 'バックアップの書き込みを確認できませんでした。';
    case 'error':
      return `ファイル操作に失敗しました${outcome.errorName ? `（${outcome.errorName}）` : ''}。`;
  }
}

/** 選択中のルールを delta だけ動かせるか（1 件も動かせないときは false。ボタンの無効化に使う） */
export function canMoveBy(file: LoadedFile, delta: number): boolean {
  return file.selection.length > 0 && !sameOrder(moveRulesBy(file.order, file.selection, delta), file.order);
}

/** 並び順が基準と違うか */
export function isDirty(file: LoadedFile): boolean {
  return !sameOrder(file.order, file.baseOrder);
}

/** 保存できるか: 変更があり、順序以外に差が無いことをバイト単位で確認できる */
export function canSave(file: LoadedFile): boolean {
  return isDirty(file) && isOnlyReordered(file.baseBytes, file.doc, file.order);
}
