// 実ファイルを書き換える唯一の場所。
// 方針（SPEC §6）: バックアップの無い上書きはどの経路でも行わない。
//   1. ディスク上の内容を読み直し、基準と一致しなければ中止
//   2. .bak を新規作成して書き込み、読み戻して一致を確認
//   3. 本体を上書きし、読み戻して一致を確認（一致したときだけ呼び出し側が基準を更新する）
// 書き込みは、showDirectoryPicker で選ばれたフォルダから取り直したファイルハンドルにだけ行う。
// ブラウザ API はインタフェース越しに使い、テストでは偽のハンドルに差し替える。
import { bytesEqual } from '../../core';
import { backupFileName, type SaveOutcome } from './outcome';

export interface WritableLike {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<WritableLike>;
  isSameEntry(other: FileHandleLike): Promise<boolean>;
}

export interface DirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
}

/** 開いているファイル。fileHandle は File System Access API で開いた場合のみ */
export type FileSession = {
  fileName: string;
  fileHandle: FileHandleLike | null;
  /** 初回保存時に選ばれたフォルダ（照合済み） */
  dirHandle: DirectoryHandleLike | null;
};

export type SaveEnv = {
  /** 開いたファイルのフォルダを起点に、書き込み可能なフォルダを選んでもらう */
  pickDirectory(startIn: FileHandleLike): Promise<DirectoryHandleLike>;
  /** バイト列をダウンロードさせる */
  download(bytes: Uint8Array, fileName: string): Promise<void>;
};

export type SaveRequest = {
  session: FileSession;
  baseBytes: Uint8Array;
  newBytes: Uint8Array;
  now: Date;
};

export type SaveResult = {
  outcome: SaveOutcome;
  /** 次回の保存で使うフォルダ（照合に失敗した場合などは null に戻す） */
  dirHandle: DirectoryHandleLike | null;
};

function errorName(e: unknown): string {
  return e instanceof Error || (typeof e === 'object' && e !== null && 'name' in e)
    ? String((e as { name: unknown }).name)
    : 'Error';
}

export async function readAll(handle: FileHandleLike): Promise<Uint8Array> {
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function writeAll(handle: FileHandleLike, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  try {
    // SharedArrayBuffer 由来でないことを型で保証するため、ArrayBuffer にコピーして渡す
    await writable.write(new Uint8Array(bytes));
    await writable.close();
  } catch (e) {
    await writable.abort?.().catch(() => undefined);
    throw e;
  }
}

async function exists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (e) {
    if (errorName(e) === 'NotFoundError') return false;
    throw e;
  }
}

async function ensureWritePermission(dir: DirectoryHandleLike): Promise<boolean> {
  if (!dir.requestPermission) return true;
  if ((await dir.queryPermission?.({ mode: 'readwrite' })) === 'granted') return true;
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** 保存の入口。API で開いたファイルは .bak つきの上書き、それ以外はダウンロード保存 */
export async function saveFile(req: SaveRequest, env: SaveEnv): Promise<SaveResult> {
  const { session } = req;
  if (!session.fileHandle) {
    return { outcome: await downloadWithBackup(req, env, { viaFallback: false }), dirHandle: null };
  }
  const result = await overwriteWithBackup(req, env, session.fileHandle);
  if (result.outcome.kind === 'fallback-download') {
    const outcome = await downloadWithBackup(req, env, { viaFallback: true, readCurrent: session.fileHandle });
    return { outcome, dirHandle: null };
  }
  return result;
}

/** .bak を作ってから上書きする。フォルダ選択がキャンセル・拒否されたら fallback-download を返す */
export async function overwriteWithBackup(
  req: SaveRequest,
  env: SaveEnv,
  openedHandle: FileHandleLike,
): Promise<SaveResult> {
  const { session, baseBytes, newBytes, now } = req;
  const fileName = session.fileName;

  // フォルダの選択（初回のみ）
  let dir = session.dirHandle;
  if (!dir) {
    try {
      dir = await env.pickDirectory(openedHandle);
    } catch (e) {
      const name = errorName(e);
      if (name === 'AbortError') return { outcome: { kind: 'fallback-download', reason: 'cancelled' }, dirHandle: null };
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return { outcome: { kind: 'fallback-download', reason: 'denied' }, dirHandle: null };
      }
      return { outcome: { kind: 'aborted', reason: 'error', errorName: name }, dirHandle: null };
    }
  }

  // ここから先、書き込みは target（フォルダから取り直したハンドル）と .bak にだけ行う
  let target: FileHandleLike;
  let diskBytes: Uint8Array;
  let backupName: string;
  try {
    if (!(await ensureWritePermission(dir))) {
      return { outcome: { kind: 'fallback-download', reason: 'denied' }, dirHandle: null };
    }
    try {
      target = await dir.getFileHandle(fileName);
    } catch (e) {
      if (errorName(e) === 'NotFoundError' || errorName(e) === 'TypeMismatchError') {
        return { outcome: { kind: 'aborted', reason: 'not-same-file' }, dirHandle: null };
      }
      throw e;
    }
    if (!(await target.isSameEntry(openedHandle))) {
      return { outcome: { kind: 'aborted', reason: 'not-same-file' }, dirHandle: null };
    }

    // 1. ディスク上の内容が基準と同じか
    diskBytes = await readAll(target);
    if (!bytesEqual(diskBytes, baseBytes)) {
      return { outcome: { kind: 'aborted', reason: 'changed-on-disk' }, dirHandle: dir };
    }

    // 2. .bak を新規作成し、読み戻して確認
    backupName = backupFileName(fileName, now);
    if (await exists(dir, backupName)) {
      return { outcome: { kind: 'aborted', reason: 'backup-exists' }, dirHandle: dir };
    }
    const backup = await dir.getFileHandle(backupName, { create: true });
    await writeAll(backup, diskBytes);
    if (!bytesEqual(await readAll(backup), diskBytes)) {
      return { outcome: { kind: 'aborted', reason: 'backup-verify-failed' }, dirHandle: dir };
    }
  } catch (e) {
    // 本体にはまだ書いていない
    return { outcome: { kind: 'aborted', reason: 'error', errorName: errorName(e) }, dirHandle: dir };
  }

  // 3. 本体を上書きし、読み戻して確認
  try {
    await writeAll(target, newBytes);
    const written = await readAll(target);
    if (!bytesEqual(written, newBytes)) {
      return { outcome: { kind: 'verify-failed', fileName, backupName }, dirHandle: dir };
    }
    return { outcome: { kind: 'saved', bytes: written, fileName, backupName }, dirHandle: dir };
  } catch (e) {
    return { outcome: { kind: 'verify-failed', fileName, backupName, errorName: errorName(e) }, dirHandle: dir };
  }
}

/**
 * ダウンロード保存。元の内容（基準）を .bak として → 本体の順にダウンロードする。
 * readCurrent が読めれば、ディスク上の内容が基準と同じか確認する（違えば中止）。
 */
export async function downloadWithBackup(
  req: SaveRequest,
  env: SaveEnv,
  opts: { viaFallback: boolean; readCurrent?: FileHandleLike },
): Promise<SaveOutcome> {
  const { session, baseBytes, newBytes, now } = req;
  if (opts.readCurrent) {
    let current: Uint8Array | null = null;
    try {
      current = await readAll(opts.readCurrent);
    } catch {
      // 読めない場合は、開いた時点の内容を .bak とする
    }
    if (current && !bytesEqual(current, baseBytes)) return { kind: 'aborted', reason: 'changed-on-disk' };
  }
  const backupName = backupFileName(session.fileName, now);
  try {
    await env.download(baseBytes, backupName);
    await env.download(newBytes, session.fileName);
  } catch (e) {
    return { kind: 'aborted', reason: 'error', errorName: errorName(e) };
  }
  return { kind: 'downloaded', fileName: session.fileName, backupName, viaFallback: opts.viaFallback };
}

// ---- ブラウザ実装 ----

export function isFileSystemAccessSupported(): boolean {
  return typeof window.showOpenFilePicker === 'function' && typeof window.showDirectoryPicker === 'function';
}

export type OpenedFile = { fileName: string; bytes: Uint8Array; fileHandle: FileHandleLike | null };

/** ファイルを開く。キャンセル時は null */
export async function openFile(): Promise<OpenedFile | null> {
  if (isFileSystemAccessSupported()) {
    try {
      const [handle] = await window.showOpenFilePicker!({
        id: 'ifilter',
        multiple: false,
        types: [{ description: 'Becky! フィルタ (IFilter.def)', accept: { 'application/octet-stream': ['.def'] } }],
      });
      if (!handle) return null;
      return { fileName: handle.name, bytes: await readAll(handle), fileHandle: handle };
    } catch (e) {
      if (errorName(e) === 'AbortError') return null;
      throw e;
    }
  }
  const file = await pickWithInput();
  if (!file) return null;
  return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), fileHandle: null };
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.def';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

export const browserSaveEnv: SaveEnv = {
  async pickDirectory(startIn) {
    return (await window.showDirectoryPicker!({
      id: 'ifilter-dir',
      mode: 'readwrite',
      startIn: startIn as unknown as FileSystemHandle,
    })) as unknown as DirectoryHandleLike;
  },
  async download(bytes, fileName) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    // 続けてダウンロードする 2 件目が取りこぼされないよう、少し間を空ける
    await new Promise((r) => setTimeout(r, 500));
    URL.revokeObjectURL(url);
  },
};
