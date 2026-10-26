import { CRLF_BYTES, concatBytes, endsWithCRLF } from './bytes';
import type { FilterDocument, Rule } from './types';

/**
 * order の順（省略時は読み込み順）にルールの raw を連結して出力する。再エンコードはしない。
 * order はルール ID の順列でなければならない（欠落・重複があれば例外）。
 */
export function serialize(doc: FilterDocument, order?: readonly string[]): Uint8Array {
  const rules = orderedRules(doc, order);
  const parts: Uint8Array[] = [...doc.header.rawLines];
  rules.forEach((rule, i) => {
    parts.push(rule.raw);
    // 末尾 CRLF の無いルール（元の最終行）を途中へ移動したときだけ CRLF を補う
    const hasFollower = i < rules.length - 1 || doc.trailing.length > 0;
    if (hasFollower && !endsWithCRLF(rule.raw)) parts.push(CRLF_BYTES);
  });
  parts.push(doc.trailing);
  return concatBytes(parts);
}

export function orderedRules(doc: FilterDocument, order?: readonly string[]): Rule[] {
  if (!order) return doc.rules;
  if (order.length !== doc.rules.length) {
    throw new Error(`並び順のルール数 (${order.length}) がファイルのルール数 (${doc.rules.length}) と一致しません`);
  }
  const byId = new Map(doc.rules.map((r) => [r.id, r]));
  const seen = new Set<string>();
  return order.map((id) => {
    const rule = byId.get(id);
    if (!rule) throw new Error(`並び順に存在しないルール ID があります: ${id}`);
    if (seen.has(id)) throw new Error(`並び順にルール ID が重複しています: ${id}`);
    seen.add(id);
    return rule;
  });
}
