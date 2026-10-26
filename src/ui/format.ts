import type { Condition } from '../core';

/** フォルダパスを「前半」と「末尾 2 階層」に分ける（末尾 2 階層を強調表示するため） */
export function splitFolder(path: string): { head: string; tail: string } {
  const parts = path.replace(/\\+$/, '').split('\\');
  if (parts.length <= 2) return { head: '', tail: parts.join('\\') };
  return { head: parts.slice(0, -2).join('\\') + '\\', tail: parts.slice(-2).join('\\') };
}

export function formatCondition(c: Condition): string {
  return `${c.field}: ${c.text}`;
}

/** 条件の要約: 先頭 limit 件 + 「他 N 件」 */
export function summarizeConditions(conditions: readonly Condition[], limit = 3): { shown: string[]; rest: number } {
  return {
    shown: conditions.slice(0, limit).map(formatCondition),
    rest: Math.max(0, conditions.length - limit),
  };
}
