import { describe, expect, it } from 'vitest';
import { backupFileName } from '../../src/ui/fs/outcome';

describe('backupFileName', () => {
  it('<名前>.bak-YYYYMMDD-HHMMSS（ローカル時刻・ゼロ埋め）', () => {
    expect(backupFileName('IFilter.def', new Date(2026, 0, 2, 3, 4, 5))).toBe('IFilter.def.bak-20260102-030405');
  });
});
