import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent } from 'react';
import { analyzeRules, isOnlyReordered, movedRuleIds, serialize } from './core';
import { DetailPane } from './ui/components/DetailPane';
import { DiffPanel } from './ui/components/DiffPanel';
import { RuleList } from './ui/components/RuleList';
import { SaveDialog } from './ui/components/SaveDialog';
import { Toolbar } from './ui/components/Toolbar';
import { WarningSummary } from './ui/components/WarningSummary';
import { browserSaveEnv, isFileSystemAccessSupported, openFile, saveFile } from './ui/fs/fileAccess';
import { backupFileName } from './ui/fs/outcome';
import { editorReducer, initialEditorState, isDirty } from './ui/state/editor';
import { filterAfterJump, matchesFilter, type WarningFilter } from './ui/warnings';

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : 'Error';
}

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  const [busy, setBusy] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [filter, setFilter] = useState<WarningFilter>('all');
  // ダイアログに表示した .bak 名と実際の .bak 名を一致させるため、時刻はダイアログを開いた時点で固定する
  const [saveDialog, setSaveDialog] = useState<{ now: Date; backupName: string } | null>(null);
  const draggingRef = useRef(false);
  const file = state.file;

  const rulesById = useMemo(() => new Map(file?.doc.rules.map((r) => [r.id, r]) ?? []), [file?.doc]);
  const dirty = file ? isDirty(file) : false;
  // 選択の変更では再計算しないよう、並び順と基準だけに依存させる
  const baseBytes = file?.baseBytes;
  const doc = file?.doc;
  const order = file?.order;
  const baseOrder = file?.baseOrder;
  const verified = useMemo(
    () => (baseBytes && doc && order && dirty ? isOnlyReordered(baseBytes, doc, order) : true),
    [baseBytes, doc, order, dirty],
  );
  const moved = useMemo(
    () => (baseOrder && order ? movedRuleIds(baseOrder, order) : new Set<string>()),
    [baseOrder, order],
  );
  // 並び替えの警告（並び替え・Undo/Redo・保存後の再読み込みのたびに再計算）
  const warnings = useMemo(() => (doc && order ? analyzeRules(doc.rules, order) : null), [doc, order]);
  const analysisById = useMemo(() => warnings?.byId ?? new Map(), [warnings]);
  const positions = useMemo(() => new Map((order ?? []).map((id, i) => [id, i])), [order]);
  const selection = file?.selection;
  const selectionSet = useMemo(() => new Set(selection ?? []), [selection]);
  // 表示する行: 条件に合う行 + 条件から外れた選択中の行（全体の順序のまま）
  const { rows, outsideFilter } = useMemo(() => {
    const outside = new Set<string>();
    const visibleRows = (order ?? []).filter((id) => {
      if (matchesFilter(analysisById.get(id), filter)) return true;
      if (selectionSet.has(id)) {
        outside.add(id);
        return true;
      }
      return false;
    });
    return { rows: visibleRows, outsideFilter: outside };
  }, [order, analysisById, filter, selectionSet]);
  const filtered = filter !== 'all';
  const visibleArg = filtered ? rows : undefined;

  const changeFilter = useCallback(
    (next: WarningFilter) => {
      setFilter(next);
      if (next !== 'all' && order) {
        dispatch({ type: 'retainSelection', ids: order.filter((id) => matchesFilter(analysisById.get(id), next)) });
      }
    },
    [order, analysisById],
  );

  // 絞り込みの条件に合う行（「（絞り込み外）」として残している選択行は含めない）
  const matchingIds = useMemo(
    () => new Set((order ?? []).filter((id) => matchesFilter(analysisById.get(id), filter))),
    [order, analysisById, filter],
  );

  const jumpTo = useCallback(
    (id: string) => {
      setFilter(filterAfterJump(filter, id, matchingIds));
      dispatch({ type: 'jumpTo', id });
    },
    [filter, matchingIds],
  );

  const canSave = dirty && verified;
  const canOverwrite = Boolean(file?.session.fileHandle) && isFileSystemAccessSupported();

  // 未保存の変更があるときはページ離脱を確認する
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ↑/↓ で移動した行を見える位置へ
  useEffect(() => {
    if (file?.focusId) document.getElementById(`rule-${file.focusId}`)?.scrollIntoView({ block: 'nearest' });
  }, [file?.focusId, file?.order]);

  const handleOpen = useCallback(async () => {
    if (dirty && !window.confirm('未保存の並び替えがあります。破棄して別のファイルを開きますか？')) return;
    try {
      const opened = await openFile();
      if (!opened) return;
      dispatch({
        type: 'loaded',
        fileName: opened.fileName,
        bytes: opened.bytes,
        session: { fileName: opened.fileName, fileHandle: opened.fileHandle, dirHandle: null },
      });
      setShowDiff(false);
      setFilter('all');
    } catch (e) {
      dispatch({ type: 'loadFailed', message: `ファイルを開けませんでした（${errorName(e)}）。` });
    }
  }, [dirty]);

  const handleSaveRequest = useCallback(() => {
    if (!file || !canSave || busy) return;
    const now = new Date();
    setSaveDialog({ now, backupName: backupFileName(file.fileName, now) });
  }, [file, canSave, busy]);

  const handleSaveConfirm = useCallback(async () => {
    const now = saveDialog?.now;
    setSaveDialog(null);
    if (!file || !canSave || !now) return;
    setBusy(true);
    try {
      // クリック直後（ユーザー操作の有効期間内）にフォルダ選択を出すため、同期的に準備してから呼ぶ
      const newBytes = serialize(file.doc, file.order);
      const { outcome, dirHandle } = await saveFile(
        { session: file.session, baseBytes: file.baseBytes, newBytes, now },
        browserSaveEnv,
      );
      dispatch({ type: 'saveFinished', outcome, dirHandle: file.session.fileHandle ? dirHandle : undefined });
    } finally {
      setBusy(false);
    }
  }, [file, canSave, saveDialog]);

  // キーボード操作
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!state.file || busy || saveDialog || draggingRef.current || isEditableTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key;
      let handled = true;
      if (e.altKey && !ctrl && key === 'ArrowUp') dispatch({ type: 'moveBy', delta: -1 });
      else if (e.altKey && !ctrl && key === 'ArrowDown') dispatch({ type: 'moveBy', delta: 1 });
      else if (e.altKey && !ctrl && key === 'Home') dispatch({ type: 'moveTop' });
      else if (e.altKey && !ctrl && key === 'End') dispatch({ type: 'moveBottom' });
      else if (!e.altKey && !ctrl && key === 'ArrowUp')
        dispatch({ type: 'cursor', delta: -1, extend: e.shiftKey, visible: visibleArg });
      else if (!e.altKey && !ctrl && key === 'ArrowDown')
        dispatch({ type: 'cursor', delta: 1, extend: e.shiftKey, visible: visibleArg });
      else if (ctrl && !e.altKey && key.toLowerCase() === 'z' && !e.shiftKey) dispatch({ type: 'undo' });
      else if (ctrl && !e.altKey && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && e.shiftKey)))
        dispatch({ type: 'redo' });
      else if (ctrl && !e.altKey && key.toLowerCase() === 'a') dispatch({ type: 'selectAll', visible: visibleArg });
      else if (key === 'Escape') dispatch({ type: 'clearSelection' });
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.file, busy, saveDialog, visibleArg]);

  const onSelect = useCallback(
    (id: string, e: MouseEvent) => {
      dispatch({ type: 'click', id, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, visible: visibleArg });
    },
    [visibleArg],
  );
  const onDrop = useCallback((activeId: string, overId: string) => dispatch({ type: 'drop', activeId, overId }), []);
  const onDraggingChange = useCallback((dragging: boolean) => {
    draggingRef.current = dragging;
  }, []);

  const positionOf = useCallback((id: string) => order?.indexOf(id) ?? -1, [order]);
  const selectedRules = file ? file.selection.map((id) => rulesById.get(id)!).filter(Boolean) : [];
  const movedRules = file
    ? file.order.flatMap((id, position) => (moved.has(id) ? [{ rule: rulesById.get(id)!, position }] : []))
    : [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>Becky! フィルタ並び替え</h1>
        <Toolbar
          hasFile={Boolean(file)}
          busy={busy}
          canSave={canSave}
          canUndo={Boolean(file?.past.length)}
          canRedo={Boolean(file?.future.length)}
          hasSelection={Boolean(file?.selection.length)}
          ruleCount={file?.order.length ?? 0}
          showDiff={showDiff}
          filter={filter}
          onFilterChange={changeFilter}
          onOpen={handleOpen}
          onSave={handleSaveRequest}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          onToggleDiff={() => setShowDiff((v) => !v)}
          onMoveTop={() => dispatch({ type: 'moveTop' })}
          onMoveBottom={() => dispatch({ type: 'moveBottom' })}
          onMoveTo={(index) => dispatch({ type: 'moveTo', index })}
        />
        {state.notice && (
          <div className={`notice notice-${state.notice.level}`} role={state.notice.level === 'error' ? 'alert' : 'status'}>
            <span>{state.notice.message}</span>
            <button type="button" className="link" onClick={() => dispatch({ type: 'notice', notice: null })}>
              閉じる
            </button>
          </div>
        )}
        {file && (
          <p className="status small">
            {file.fileName}・{file.order.length} ルール
            {file.warnings.length > 0 && `・パース警告 ${file.warnings.length} 件（未知の行など。内容はそのまま保持します）`}
            {dirty ? '・未保存の変更あり' : ''}
          </p>
        )}
        {warnings && <WarningSummary counts={warnings.counts} />}
      </header>

      {file ? (
        <main className="app-main">
          <section className="list-pane">
            {showDiff && <DiffPanel dirty={dirty} verified={verified} movedRules={movedRules} />}
            <RuleList
              rules={rulesById}
              rows={rows}
              positions={positions}
              analysis={analysisById}
              filtered={filtered}
              outsideFilter={outsideFilter}
              moved={moved}
              selection={file.selection}
              focusId={file.focusId}
              onSelect={onSelect}
              onDrop={onDrop}
              onDraggingChange={onDraggingChange}
            />
          </section>
          <DetailPane
            rules={selectedRules}
            rulesById={rulesById}
            analysis={analysisById}
            positionOf={positionOf}
            onJump={jumpTo}
          />
        </main>
      ) : (
        <main className="empty">
          <p>「ファイルを開く」から Becky! の IFilter.def を選んでください。</p>
          <ul className="small muted">
            <li>非公式ツールです。ファイルはブラウザ内でのみ処理され、外部へは送信されません。</li>
            <li>使用前にバックアップを取り、Becky! を終了してから保存してください。</li>
          </ul>
        </main>
      )}

      <footer className="app-footer small muted">
        ↑↓: 選択 / Shift+↑↓: 範囲選択 / Alt+↑↓: 1 つ移動 / Alt+Home・End: 先頭・末尾へ / Ctrl+Z・Y: 元に戻す・やり直し /
        Ctrl+A: すべて選択 / Esc: 選択解除
      </footer>

      {file && saveDialog && (
        <SaveDialog
          open
          fileName={file.fileName}
          backupName={saveDialog.backupName}
          canOverwrite={canOverwrite}
          movedCount={moved.size}
          onConfirm={handleSaveConfirm}
          onCancel={() => setSaveDialog(null)}
        />
      )}
    </div>
  );
}
