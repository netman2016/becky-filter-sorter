import type { WarningCounts } from '../../core';
import { ESTIMATE_NOTE } from '../warnings';

const ITEMS: { key: keyof WarningCounts; label: string; className: string }[] = [
  { key: 'unreachable', label: '到達不能', className: 'badge badge-strong' },
  { key: 'partially-unreachable', label: '一部到達不能', className: 'badge badge-warn' },
  { key: 'redundant-rule', label: '冗長', className: 'badge badge-quiet' },
  { key: 'partially-redundant', label: '一部冗長', className: 'badge badge-quiet' },
  { key: 'duplicate', label: '重複', className: 'badge badge-quiet' },
];

/** 警告件数のサマリー（種類別）と、目安であることの注記（常時表示） */
export function WarningSummary({ counts }: { counts: WarningCounts }) {
  const shown = ITEMS.filter((item) => counts[item.key] > 0);
  return (
    <div className="warning-summary small" aria-label="警告の件数">
      {shown.length === 0 ? (
        <span>警告なし</span>
      ) : (
        shown.map((item) => (
          <span key={item.key} className={item.className}>
            {item.label} {counts[item.key]}
          </span>
        ))
      )}
      {counts['not-applicable'] > 0 && <span className="muted">判定対象外 {counts['not-applicable']}</span>}
      <span className="muted">※{ESTIMATE_NOTE}</span>
    </div>
  );
}
