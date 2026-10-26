import type { Rule } from '../../core';

type Props = {
  dirty: boolean;
  verified: boolean;
  movedRules: { rule: Rule; position: number }[];
};

export const MOVED_TOOLTIP = '元の順序を保ったまま残せるルールが最も多くなるように数えた、移動したルールの件数';

export function DiffSummary({ dirty, verified, count }: { dirty: boolean; verified: boolean; count: number }) {
  if (!dirty) return <span>変更なし</span>;
  if (!verified) return <span className="error">内容の検証に失敗しました。保存できません。ファイルを開き直してください。</span>;
  return (
    <span>
      ルールの内容は変更なし。順序のみ変更（
      <abbr title={MOVED_TOOLTIP}>最小の移動数</abbr>: {count} 件）
    </span>
  );
}

export function DiffPanel({ dirty, verified, movedRules }: Props) {
  return (
    <section className="diff-panel" aria-label="差分">
      <p>
        <DiffSummary dirty={dirty} verified={verified} count={movedRules.length} />
      </p>
      {dirty && verified && (
        <ol className="diff-list">
          {movedRules.map(({ rule, position }) => (
            <li key={rule.id}>
              <span className="mono">
                元 #{rule.originalIndex + 1} → #{position + 1}
              </span>{' '}
              <span title={rule.destFolder}>{rule.destFolder || '（振り分け先なし）'}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
