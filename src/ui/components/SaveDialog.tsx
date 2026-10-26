import { useEffect, useRef } from 'react';
import { DiffSummary } from './DiffPanel';

type Props = {
  open: boolean;
  fileName: string;
  backupName: string;
  /** File System Access API で開いたか（上書き保存か、ダウンロード保存か） */
  canOverwrite: boolean;
  movedCount: number;
  onConfirm(): void;
  onCancel(): void;
};

export function SaveDialog({ open, fileName, backupName, canOverwrite, movedCount, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="save-dialog" onCancel={onCancel} aria-labelledby="save-title">
      <h2 id="save-title">保存の確認</h2>
      <p className="warn">Becky! を終了してから保存してください。</p>
      <p>
        <DiffSummary dirty verified count={movedCount} />
      </p>
      {canOverwrite ? (
        <ul>
          <li>
            同じフォルダに <code>{backupName}</code> を作成してから、<code>{fileName}</code> を上書きします。
          </li>
          <li>初回は、ファイルのあるフォルダの選択を求めます。選ばなかった場合はダウンロードで保存します。</li>
        </ul>
      ) : (
        <ul>
          <li>
            <code>{backupName}</code>（元の内容）と <code>{fileName}</code>（並び替え後）の順にダウンロードします。
          </li>
          <li>
            このブラウザでは保存直前にファイルを読み直せないため、<code>{backupName}</code> はファイルを開いた時点の内容です。
          </li>
          <li>元ファイルの置き換えは手動で行い、置き換えたあとは、このツールでファイルを開き直してください。</li>
        </ul>
      )}
      <p>保存すると Undo 履歴は消えます。</p>
      <div className="dialog-buttons">
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="primary" onClick={onConfirm} autoFocus>
          保存する
        </button>
      </div>
    </dialog>
  );
}
