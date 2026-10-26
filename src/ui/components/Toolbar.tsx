import { useState } from 'react';
import { FILTER_LABELS, type WarningFilter } from '../warnings';

type Props = {
  hasFile: boolean;
  busy: boolean;
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  ruleCount: number;
  showDiff: boolean;
  filter: WarningFilter;
  onFilterChange(filter: WarningFilter): void;
  onOpen(): void;
  onSave(): void;
  onUndo(): void;
  onRedo(): void;
  onToggleDiff(): void;
  onMoveTop(): void;
  onMoveBottom(): void;
  onMoveTo(position: number): void;
};

export function Toolbar(p: Props) {
  const [position, setPosition] = useState('');
  const target = Number(position);
  const validTarget = Number.isInteger(target) && target >= 1 && target <= p.ruleCount;

  return (
    <div className="toolbar" role="toolbar" aria-label="操作">
      <button type="button" onClick={p.onOpen} disabled={p.busy}>
        ファイルを開く
      </button>
      <button type="button" className="primary" onClick={p.onSave} disabled={!p.canSave || p.busy}>
        保存
      </button>
      <span className="sep" />
      <button type="button" onClick={p.onUndo} disabled={!p.canUndo || p.busy} title="Ctrl+Z">
        元に戻す
      </button>
      <button type="button" onClick={p.onRedo} disabled={!p.canRedo || p.busy} title="Ctrl+Y / Ctrl+Shift+Z">
        やり直し
      </button>
      <button type="button" onClick={p.onToggleDiff} disabled={!p.hasFile} aria-pressed={p.showDiff}>
        差分
      </button>
      <span className="sep" />
      <button type="button" onClick={p.onMoveTop} disabled={!p.hasSelection || p.busy} title="Alt+Home">
        先頭へ
      </button>
      <button type="button" onClick={p.onMoveBottom} disabled={!p.hasSelection || p.busy} title="Alt+End">
        末尾へ
      </button>
      <form
        className="move-to"
        onSubmit={(e) => {
          e.preventDefault();
          if (validTarget) p.onMoveTo(target - 1);
        }}
      >
        <input
          type="number"
          min={1}
          max={p.ruleCount}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="番号"
          aria-label="移動先の番号"
          disabled={!p.hasSelection || p.busy}
        />
        <button type="submit" disabled={!p.hasSelection || !validTarget || p.busy}>
          番へ移動
        </button>
      </form>
      <span className="sep" />
      <span className="filter-group" role="group" aria-label="絞り込み">
        {(Object.keys(FILTER_LABELS) as WarningFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={p.filter === f}
            onClick={() => p.onFilterChange(f)}
            disabled={!p.hasFile}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </span>
    </div>
  );
}
