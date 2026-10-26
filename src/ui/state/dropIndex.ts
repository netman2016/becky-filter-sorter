import { moveRules } from '../../core';

/**
 * ドラッグ&ドロップ後の並び順。選択中の行をつかんだ場合は選択全体を移動する。
 * 下方向へのドロップはドロップ先の後ろ、上方向は前に入れる（dnd-kit の arrayMove と同じ感覚）。
 * 変化が無ければ null。
 */
export function orderAfterDrop(
  order: readonly string[],
  selection: readonly string[],
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null;
  const moving = selection.includes(activeId) ? selection : [activeId];
  if (moving.includes(overId)) return null;
  const activeIndex = order.indexOf(activeId);
  const overIndex = order.indexOf(overId);
  if (activeIndex < 0 || overIndex < 0) return null;

  const movingSet = new Set(moving);
  const rest = order.filter((id) => !movingSet.has(id));
  const restOver = rest.indexOf(overId);
  const toIndex = activeIndex < overIndex ? restOver + 1 : restOver;
  return moveRules(order, moving, toIndex);
}
