import type { MouseEvent } from 'react';
import { WARNING_TARGET_KINDS, type WarningCounts, type WarningTargetKind } from '../../core';
import { ESTIMATE_NOTE, WARNING_TARGET_BADGES } from '../warnings';

export type WarningPosition = { index: number | null; total: number };

type Props = {
  counts: WarningCounts;
  /** 種類ごとの「いま選択しているルールが何件目か / 全件数」 */
  positions: Record<WarningTargetKind, WarningPosition>;
  /** 次（1）/ 前（-1）の該当ルールを選択する */
  onStep(kind: WarningTargetKind, direction: 1 | -1): void;
  /** スクリーンリーダー向けの通知文 */
  announcement: string;
};

/** 警告件数のサマリー（種類別）と、目安であることの注記（常時表示）。種類のボタンで該当ルールを順に選ぶ */
export function WarningSummary({ counts, positions, onStep, announcement }: Props) {
  const total = WARNING_TARGET_KINDS.reduce((n, kind) => n + counts[kind], 0);
  return (
    <div className="warning-summary small" aria-label="警告の件数">
      {total === 0 && <span>警告なし</span>}
      {WARNING_TARGET_KINDS.map((kind) => {
        const badge = WARNING_TARGET_BADGES[kind];
        const pos = positions[kind];
        const disabled = counts[kind] === 0;
        const place = `${pos.index ?? '-'} / ${pos.total}`;
        const current = pos.index === null ? '選択中のルールは該当なし' : `${pos.total}件中${pos.index}件目を選択中`;
        return (
          <span key={kind} className="warning-nav" role="group" aria-label={badge.label}>
            <button
              type="button"
              className="warning-prev"
              disabled={disabled}
              onClick={() => onStep(kind, -1)}
              aria-label={`${badge.label}: 前の該当ルール`}
              title={`${badge.label}: 前の該当ルール`}
            >
              ‹
            </button>
            <button
              type="button"
              className={`warning-next ${badge.className}`}
              disabled={disabled}
              onClick={(e: MouseEvent) => onStep(kind, e.shiftKey ? -1 : 1)}
              aria-label={`${badge.label}: 次の該当ルール（${current}）`}
              title={`${badge.title}。クリックで次の該当ルール、Shift+クリックで前へ`}
            >
              {badge.label} <span className="warning-place">{place}</span> ›
            </button>
          </span>
        );
      })}
      {counts['not-applicable'] > 0 && <span className="muted">判定対象外 {counts['not-applicable']}</span>}
      <span className="muted">※{ESTIMATE_NOTE}</span>
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
}
