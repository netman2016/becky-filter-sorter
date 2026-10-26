import { memo, type MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Rule, RuleAnalysis } from '../../core';
import { splitFolder, summarizeConditions } from '../format';
import { badgesOf } from '../warnings';

type Props = {
  rule: Rule;
  /** 全体の順序での位置（0 始まり） */
  index: number;
  moved: boolean;
  selected: boolean;
  focused: boolean;
  analysis: RuleAnalysis | undefined;
  dragDisabled: boolean;
  /** 絞り込みの条件から外れたが、選択中なので表示を残している */
  outsideFilter: boolean;
  onSelect(id: string, e: MouseEvent): void;
};

export const RuleRow = memo(function RuleRow({
  rule,
  index,
  moved,
  selected,
  focused,
  analysis,
  dragDisabled,
  outsideFilter,
  onSelect,
}: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
    disabled: dragDisabled,
  });
  const { head, tail } = splitFolder(rule.destFolder);
  const { shown, rest } = summarizeConditions(rule.conditions);
  const badges = badgesOf(analysis);

  return (
    <li
      ref={setNodeRef}
      id={`rule-${rule.id}`}
      className={[
        'rule-row',
        selected && 'is-selected',
        focused && 'is-focused',
        isDragging && 'is-dragging',
        outsideFilter && 'is-outside-filter',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-selected={selected}
      role="option"
      onClick={(e) => onSelect(rule.id, e)}
    >
      <button
        type="button"
        className="drag-handle"
        ref={setActivatorNodeRef}
        aria-label={`${index + 1} 番のルールをドラッグ`}
        title={
          dragDisabled
            ? '絞り込み中はドラッグで移動できません'
            : 'ドラッグして移動（Space で持ち上げ、↑↓ で移動、Space で確定）'
        }
        disabled={dragDisabled}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="rule-no">{index + 1}</span>
      <span className="rule-orig">{moved ? `元 #${rule.originalIndex + 1}` : ''}</span>
      <span className="rule-badges">
        {badges.map((b) => (
          <span key={b.label} className={b.className} title={b.title}>
            {b.label}
          </span>
        ))}
        {outsideFilter && <span className="muted small">（絞り込み外）</span>}
      </span>
      <span className="rule-folder" title={rule.destFolder || '（振り分け先なし）'}>
        {rule.destFolder ? (
          <>
            <span className="folder-head">{head}</span>
            <strong className="folder-tail">{tail}</strong>
          </>
        ) : (
          <span className="muted">（振り分け先なし）</span>
        )}
      </span>
      <span className="rule-conds">
        {shown.map((text, i) => (
          <span key={i} className="cond-chip">
            {text}
          </span>
        ))}
        {rest > 0 && <span className="muted">他 {rest} 件</span>}
      </span>
    </li>
  );
});
