import type { Rule } from '../../core';

type Props = { rules: Rule[]; positionOf(id: string): number };

/** 選択ルールの詳細（読み取り専用） */
export function DetailPane({ rules, positionOf }: Props) {
  if (rules.length === 0) return <aside className="detail muted">ルールを選択すると、条件をすべて表示します。</aside>;
  if (rules.length > 1) return <aside className="detail">{rules.length} 件選択中</aside>;
  const rule = rules[0]!;
  return (
    <aside className="detail">
      <h2>
        #{positionOf(rule.id) + 1}
        <span className="muted">（元 #{rule.originalIndex + 1}）</span>
      </h2>
      <dl>
        <dt>振り分け先</dt>
        <dd className="mono">{rule.destFolder || '（なし）'}</dd>
        <dt>メールボックス</dt>
        <dd className="mono">{rule.destMailbox || '（なし）'}</dd>
        <dt>条件（{rule.conditions.length} 件・いずれかに一致）</dt>
        <dd>
          <table className="cond-table">
            <thead>
              <tr>
                <th>フィールド</th>
                <th>文字列</th>
                <th>フラグ</th>
              </tr>
            </thead>
            <tbody>
              {rule.conditions.map((c, i) => (
                <tr key={i}>
                  <td>{c.field}</td>
                  <td className="mono">{c.text}</td>
                  <td className="mono">{c.flags.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </dd>
        {rule.unknownLines.length > 0 && (
          <>
            <dt>未知の行</dt>
            <dd>{rule.unknownLines.length} 行（解釈せずにそのまま保持します）</dd>
          </>
        )}
      </dl>
      <p className="muted small">「いずれかに一致」は目安です（Becky! の仕様として未確認）。</p>
    </aside>
  );
}
