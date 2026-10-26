import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core';
import {
  canSave,
  describeSaveOutcome,
  editorReducer,
  initialEditorState,
  isDirty,
  type EditorAction,
  type EditorState,
} from '../../src/ui/state/editor';
import { orderAfterDrop } from '../../src/ui/state/dropIndex';
import { HEADER, def, ruleLines } from '../helpers';

function sampleBytes(n = 5) {
  const lines = [...HEADER];
  for (let i = 1; i <= n; i++) lines.push(...ruleLines(`Inbox\\F${i}\\`, [['From', `u${i}@example.com`]]));
  return def(lines);
}

function run(state: EditorState, ...actions: EditorAction[]) {
  return actions.reduce(editorReducer, state);
}

function loaded(n = 5) {
  return run(initialEditorState, { type: 'loaded', fileName: 'IFilter.def', bytes: sampleBytes(n) });
}

const click = (id: string, mod: { shift?: boolean; ctrl?: boolean } = {}): EditorAction => ({
  type: 'click',
  id,
  shift: mod.shift ?? false,
  ctrl: mod.ctrl ?? false,
});

describe('読み込み', () => {
  it('読み込むと基準と並び順が同じで、変更なし・保存不可', () => {
    const { file } = loaded();
    expect(file!.order).toEqual(['r0001', 'r0002', 'r0003', 'r0004', 'r0005']);
    expect(isDirty(file!)).toBe(false);
    expect(canSave(file!)).toBe(false);
  });

  it('形式エラーは行番号つきの案内になり、既存の状態を保つ', () => {
    const before = loaded();
    const after = run(before, { type: 'loaded', fileName: 'x.def', bytes: def([':End ""']) });
    expect(after.file).toBe(before.file);
    expect(after.notice).toEqual({ level: 'error', message: expect.stringContaining('1 行目') });
  });
});

describe('選択', () => {
  it('クリック・Ctrl クリック・Shift クリック', () => {
    let s = run(loaded(), click('r0002'));
    expect(s.file!.selection).toEqual(['r0002']);
    s = run(s, click('r0004', { ctrl: true }));
    expect(s.file!.selection).toEqual(['r0002', 'r0004']);
    s = run(s, click('r0002', { ctrl: true }));
    expect(s.file!.selection).toEqual(['r0004']);
    // Ctrl クリック（解除を含む）でも Shift の起点はその行に移る（エクスプローラーと同じ）
    s = run(s, click('r0001', { shift: true }));
    expect(s.file!.selection).toEqual(['r0001', 'r0002']);
    s = run(s, click('r0004'), click('r0001', { shift: true }));
    expect(s.file!.selection).toEqual(['r0001', 'r0002', 'r0003', 'r0004']);
  });

  it('↑/↓ で選択を移し、Shift で広げる', () => {
    let s = run(loaded(), { type: 'cursor', delta: 1, extend: false });
    expect(s.file!.selection).toEqual(['r0001']);
    s = run(s, { type: 'cursor', delta: 1, extend: true }, { type: 'cursor', delta: 1, extend: true });
    expect(s.file!.selection).toEqual(['r0001', 'r0002', 'r0003']);
    s = run(s, { type: 'cursor', delta: -5, extend: false });
    expect(s.file!.selection).toEqual(['r0001']);
  });
});

describe('移動と Undo / Redo', () => {
  it('先頭へ・末尾へ・指定位置へ・1 つずつ', () => {
    let s = run(loaded(), click('r0003'), { type: 'moveTop' });
    expect(s.file!.order[0]).toBe('r0003');
    s = run(s, { type: 'moveBottom' });
    expect(s.file!.order.at(-1)).toBe('r0003');
    s = run(s, { type: 'moveTo', index: 1 });
    expect(s.file!.order[1]).toBe('r0003');
    s = run(s, { type: 'moveBy', delta: -1 });
    expect(s.file!.order[0]).toBe('r0003');
    expect(isDirty(s.file!)).toBe(true);
    expect(canSave(s.file!)).toBe(true);
  });

  it('Undo / Redo で並び順を往復し、新しい操作で Redo を消す', () => {
    const base = run(loaded(), click('r0005'));
    const moved = run(base, { type: 'moveTop' });
    const undone = run(moved, { type: 'undo' });
    expect(undone.file!.order).toEqual(base.file!.order);
    expect(isDirty(undone.file!)).toBe(false);
    const redone = run(undone, { type: 'redo' });
    expect(redone.file!.order).toEqual(moved.file!.order);
    const branched = run(undone, { type: 'moveTo', index: 2 });
    expect(branched.file!.order).not.toEqual(undone.file!.order);
    expect(branched.file!.future).toEqual([]);
  });

  it('変化の無い操作は履歴に積まない', () => {
    const s = run(loaded(), click('r0001'), { type: 'moveTop' }, { type: 'moveBy', delta: -1 });
    expect(s.file!.past).toHaveLength(0);
    const none = run(loaded(), { type: 'moveTop' });
    expect(none.file!.past).toHaveLength(0);
  });

  it('ドロップ: 選択外の行をつかむとその行だけ移動して選択する', () => {
    const s = run(loaded(), click('r0001'), { type: 'drop', activeId: 'r0004', overId: 'r0002' });
    expect(s.file!.order).toEqual(['r0001', 'r0004', 'r0002', 'r0003', 'r0005']);
    expect(s.file!.selection).toEqual(['r0004']);
  });
});

describe('保存結果', () => {
  it('saved のときだけ新しい基準にして、履歴を消す', () => {
    const moved = run(loaded(), click('r0005'), { type: 'moveTop' });
    const bytes = serialize(moved.file!.doc, moved.file!.order);
    const s = run(moved, {
      type: 'saveFinished',
      outcome: { kind: 'saved', bytes, fileName: 'IFilter.def', backupName: 'IFilter.def.bak-20261025-120000' },
    });
    expect(isDirty(s.file!)).toBe(false);
    expect(s.file!.past).toHaveLength(0);
    expect(s.file!.doc.rules[0]!.destFolder).toBe('Inbox\\F5\\');
    expect(canSave(s.file!)).toBe(false);
  });

  it('verify-failed では基準を変えず、.bak 名と戻し方を案内する', () => {
    const moved = run(loaded(), click('r0005'), { type: 'moveTop' });
    const s = run(moved, {
      type: 'saveFinished',
      outcome: { kind: 'verify-failed', fileName: 'IFilter.def', backupName: 'IFilter.def.bak-20261025-120000' },
    });
    expect(s.file).toBe(moved.file);
    expect(isDirty(s.file!)).toBe(true);
    expect(s.notice!.level).toBe('error');
    expect(s.notice!.message).toContain('IFilter.def.bak-20261025-120000 を元の名前（IFilter.def）に戻して（コピーして）ください');
  });

  it('downloaded / aborted では基準を変えない。ダウンロード後は開き直しを案内する', () => {
    const moved = run(loaded(), click('r0005'), { type: 'moveTop' });
    const d = run(moved, {
      type: 'saveFinished',
      outcome: { kind: 'downloaded', fileName: 'IFilter.def', backupName: 'b', viaFallback: true },
    });
    expect(d.file).toBe(moved.file);
    expect(d.notice!.message).toContain('フォルダを選べなかったため');
    expect(d.notice!.message).toContain('再度ファイルを開き直してください');
    const a = run(moved, { type: 'saveFinished', outcome: { kind: 'aborted', reason: 'changed-on-disk' } });
    expect(a.file).toBe(moved.file);
    expect(a.notice!.message).toContain('変更していません');
  });

  it('fallback-download は案内を出さない（続けてダウンロード保存する）', () => {
    expect(describeSaveOutcome({ kind: 'fallback-download', reason: 'cancelled' })).toBeNull();
  });
});

describe('orderAfterDrop', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('単独: 下方向はドロップ先の後ろ、上方向は前', () => {
    expect(orderAfterDrop(order, [], 'b', 'd')).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(orderAfterDrop(order, [], 'd', 'b')).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('選択中の行をつかむと選択全体を移動する', () => {
    expect(orderAfterDrop(order, ['a', 'c'], 'a', 'e')).toEqual(['b', 'd', 'e', 'a', 'c']);
    expect(orderAfterDrop(order, ['b', 'e'], 'e', 'a')).toEqual(['b', 'e', 'a', 'c', 'd']);
  });

  it('選択外の行をつかんだら、その行だけ移動する', () => {
    expect(orderAfterDrop(order, ['a', 'c'], 'e', 'a')).toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('自分自身や選択内へのドロップは変化なし', () => {
    expect(orderAfterDrop(order, [], 'b', 'b')).toBeNull();
    expect(orderAfterDrop(order, ['a', 'c'], 'a', 'c')).toBeNull();
  });
});
