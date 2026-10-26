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
import type { Rule } from '../../core';
import { RuleRow } from './RuleRow';

type Props = {
  rules: Map<string, Rule>;
  order: string[];
  moved: Set<string>;
  selection: string[];
  focusId: string | null;
  onSelect(id: string, e: MouseEvent): void;
  onDrop(activeId: string, overId: string): void;
  onDraggingChange(dragging: boolean): void;
};

export function RuleList({ rules, order, moved, selection, focusId, onSelect, onDrop, onDraggingChange }: Props) {
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
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol className="rule-list" role="listbox" aria-multiselectable="true" aria-label="ルール一覧（上から順に評価）">
          {order.map((id, index) => (
            <RuleRow
              key={id}
              rule={rules.get(id)!}
              index={index}
              moved={moved.has(id)}
              selected={selected.has(id)}
              focused={focusId === id}
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
