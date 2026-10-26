import type { Rule, RuleAnalysis } from '../../core';
import { badgesOf, ESTIMATE_NOTE, STATUS_LABELS } from '../warnings';

type Props = {
  rules: Rule[];
  rulesById: Map<string, Rule>;
  analysis: ReadonlyMap<string, RuleAnalysis>;
  positionOf(id: string): number;
  onJump(id: string): void;
};

/** 選択ルールの詳細（読み取り専用） */
export function DetailPane({ rules, rulesById, analysis, positionOf, onJump }: Props) {
  if (rules.length === 0) return <aside className="detail muted">ルールを選択すると、条件をすべて表示します。</aside>;
  if (rules.length > 1) return <aside className="detail">{rules.length} 件選択中</aside>;
  const rule = rules[0]!;
  const a = analysis.get(rule.id);
  const duplicateOf = new Map(a?.duplicates.map((d) => [d.index, d.firstIndex]) ?? []);

  return (
    <aside className="detail">
      <h2>
        #{positionOf(rule.id) + 1}
        <span className="muted">（元 #{rule.originalIndex + 1}）</span>
        {badgesOf(a).map((b) => (
          <span key={b.label} className={b.className} title={b.title}>
            {b.label}
          </span>
        ))}
      </h2>
      <dl>
        <dt>振り分け先</dt>
        <dd className="mono">{rule.destFolder || '（なし）'}</dd>
        <dt>メールボックス</dt>
        <dd className="mono">{rule.destMailbox || '（なし）'}</dd>
        <dt>条件（{rule.conditions.length} 件・いずれかに一致）</dt>
        <dd>
          {a?.kind === 'not-applicable' && (
            <p className="muted small">
              {a.notApplicableReason === 'no-destination'
                ? '振り分け先が無いため、警告の判定対象外です。'
                : '条件が無いため、警告の判定対象外です。'}
            </p>
          )}
          <table className="cond-table">
            <thead>
              <tr>
                <th>フィールド</th>
                <th>文字列</th>
                <th>フラグ</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {rule.conditions.map((c, i) => {
                const status = a?.conditions[i];
                const coverer = status && status.kind !== 'free' ? rulesById.get(status.byRuleId) : undefined;
                const dup = duplicateOf.get(i);
                return (
                  <tr key={i} className={status ? `cond-${status.kind}` : undefined}>
                    <td>{c.field}</td>
                    <td className="mono">{c.text}</td>
                    <td className="mono">{c.flags.join(' ')}</td>
                    <td>
                      {status ? STATUS_LABELS[status.kind] : '—'}
                      {coverer && status && status.kind !== 'free' && (
                        <div className="small" title={`#${positionOf(coverer.id) + 1} の ${status.byConditionIndex + 1} 番目の条件`}>
                          <button type="button" className="link" onClick={() => onJump(coverer.id)}>
                            #{positionOf(coverer.id) + 1}
                          </button>
                          のルール（振り分け先 <span className="mono">{coverer.destFolder}</span>）に先に当たります
                        </div>
                      )}
                      {dup !== undefined && <div className="small">{dup + 1} 番目の条件と重複</div>}
                    </td>
                  </tr>
                );
              })}
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
      <p className="muted small">
        「いずれかに一致」・条件の状態は目安です。{ESTIMATE_NOTE}。
      </p>
    </aside>
  );
}
