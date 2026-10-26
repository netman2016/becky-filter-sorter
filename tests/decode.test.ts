import { describe, expect, it } from 'vitest';
import { parseIFilter } from '../src/core';
import { readSample } from './helpers';

// 期待値は生成スクリプトとは独立にここへ手書きする
describe('デコード（架空サンプル）', () => {
  const input = readSample();
  const { doc, warnings } = parseIFilter(input);

  it('サンプルに 2 バイト目が 0x5C の文字（ソ・表・能）が含まれている', () => {
    const pairs = [
      [0x83, 0x5c], // ソ
      [0x95, 0x5c], // 表
      [0x94, 0x5c], // 能
    ];
    for (const [lead, trail] of pairs) {
      const found = input.some((b, i) => b === lead && input[i + 1] === trail);
      expect(found).toBe(true);
    }
  });

  it('警告が無い', () => {
    expect(warnings).toEqual([]);
  });

  it('振り分け先（0x5C を含む日本語フォルダ名）', () => {
    expect(doc.rules.map((r) => r.destFolder)).toEqual([
      'Inbox\\仕事\\プロジェクトＡ\\',
      'Inbox\\ソフト\\表計算\\',
      'Inbox\\お知らせ\\メルマガ\\',
      'Inbox\\お知らせ\\セール\\',
      'Inbox\\ソフト\\機能要望\\',
      'Inbox\\仕事\\',
      'Inbox\\仕事\\営業\\',
      'Inbox\\仕事\\',
      'Inbox\\迷惑メール\\',
      'Inbox\\ゴミ箱候補\\',
      'Inbox\\お知らせ\\メルマガ\\',
      'Inbox\\ソフト\\サポート\\',
      'Inbox\\仕事\\定例\\',
      'Inbox\\取引先\\',
      'Inbox\\取引先\\担当\\',
    ]);
    expect(new Set(doc.rules.map((r) => r.destMailbox))).toEqual(new Set(['0000abcd.mb']));
  });

  it('条件のフィールド・テキスト・フラグ', () => {
    expect(doc.rules[1]!.conditions.map((c) => [c.field, c.text])).toEqual([
      ['Subject', '表計算ソフト'],
      ['[body]', 'マクロ'],
      ['From, Sender, X-Sender', 'sheet@example.jp'],
    ]);
    expect(doc.rules[2]!.conditions.map((c) => [c.field, c.text])).toEqual([
      ['From', 'news@example.org'],
      ['*', 'X-Mailer: ExampleMailer'],
      ['Subject', '①新着情報'],
      ['To', 'list@example.com'],
      ['[body]', '配信停止はこちら'],
      ['From', 'info@example.org'],
    ]);
    expect(doc.rules[4]!.conditions[1]!.text).toBe('ご要望＆ご意見');
    expect(doc.rules[8]!.conditions.map((c) => c.text)).toEqual([
      '【広告】',
      '未承諾広告※',
      'ＵＲＬをクリック',
    ]);
    for (const rule of doc.rules) {
      for (const c of rule.conditions) expect(c.flags).toEqual(['O', 'I']);
    }
  });

  it('重複条件が含まれている（警告判定マイルストーン用）', () => {
    const key = (r: number) => doc.rules[r]!.conditions.map((c) => `${c.field}:${c.text}`);
    expect(key(2)).toContain('From:news@example.org');
    expect(key(3)).toContain('From:news@example.org');
  });
});
