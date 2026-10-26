import { useMemo, useState, type MouseEvent } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Rule, RuleAnalysis } from '../../core';
import { RuleRow } from './RuleRow';

type Props = {
  rules: Map<string, Rule>;
  /** 表示する行（全体の順序のまま。絞り込み中はその一部） */
  rows: string[];
  /** 全体の順序での位置 */
  positions: Map<string, number>;
  analysis: ReadonlyMap<string, RuleAnalysis>;
  /** 絞り込み中（ドラッグ無効） */
  filtered: boolean;
  /** 絞り込みの条件から外れたが、選択中なので表示を残している行 */
  outsideFilter: Set<string>;
  moved: Set<string>;
  selection: string[];
  focusId: string | null;
  onSelect(id: string, e: MouseEvent): void;
  onDrop(activeId: string, overId: string): void;
  onDraggingChange(dragging: boolean): void;
};

export function RuleList({
  rules,
  rows,
  positions,
  analysis,
  filtered,
  outsideFilter,
  moved,
  selection,
  focusId,
  onSelect,
  onDrop,
  onDraggingChange,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const selected = useMemo(() => new Set(selection), [selection]);
  const dragCount = activeId && selected.has(activeId) ? selection.length : 1;

  const finish = () => {
    setActiveId(null);
    onDraggingChange(false);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => {
        setActiveId(String(e.active.id));
        onDraggingChange(true);
      }}
      onDragEnd={(e: DragEndEvent) => {
        if (e.over) onDrop(String(e.active.id), String(e.over.id));
        finish();
      }}
      onDragCancel={finish}
    >
      {filtered && (
        <p className="filter-note small">
          絞り込み中はドラッグで移動できません（全体の順序での位置が曖昧になるため）。キー操作・ボタンでは全体の順序に対して移動できます。
        </p>
      )}
      <SortableContext items={rows} strategy={verticalListSortingStrategy} disabled={filtered}>
        <ol className="rule-list" role="listbox" aria-multiselectable="true" aria-label="ルール一覧（上から順に評価）">
          {rows.length === 0 && <li className="empty-row muted">該当するルールはありません。</li>}
          {rows.map((id) => (
            <RuleRow
              key={id}
              rule={rules.get(id)!}
              index={positions.get(id)!}
              moved={moved.has(id)}
              selected={selected.has(id)}
              focused={focusId === id}
              analysis={analysis.get(id)}
              dragDisabled={filtered}
              outsideFilter={outsideFilter.has(id)}
              onSelect={onSelect}
            />
          ))}
        </ol>
      </SortableContext>
      <DragOverlay>
        {activeId ? <div className="drag-overlay">{dragCount > 1 ? `${dragCount} 件を移動` : '1 件を移動'}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
