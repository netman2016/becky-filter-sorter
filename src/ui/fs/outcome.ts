/** 保存処理の結果。メッセージには実データ（パス・内容）を含めない */
export type SaveOutcome =
  /** 上書きし、読み戻して一致を確認した */
  | { kind: 'saved'; bytes: Uint8Array; fileName: string; backupName: string }
  /** フォルダ選択がキャンセル・拒否された。ダウンロード保存へ切り替える */
  | { kind: 'fallback-download'; reason: 'cancelled' | 'denied' }
  /** 何も書かずに中止した */
  | {
      kind: 'aborted';
      reason: 'not-same-file' | 'changed-on-disk' | 'backup-exists' | 'backup-verify-failed' | 'error';
      /** DOMException などの name（内容は含まない） */
      errorName?: string;
    }
  /** .bak を作成した後、本体の書き込みまたは読み戻しの確認に失敗した */
  | { kind: 'verify-failed'; fileName: string; backupName: string; errorName?: string }
  /** .bak と本体をダウンロードした */
  | { kind: 'downloaded'; fileName: string; backupName: string; viaFallback: boolean };

/** `<名前>.bak-YYYYMMDD-HHMMSS`（ローカル時刻） */
export function backupFileName(fileName: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${fileName}.bak-${date}-${time}`;
}
