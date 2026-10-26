import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// 実データがログに出ないよう、src/ では console を使わない
it('src/ に console の呼び出しが無い', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && /\bconsole\./.test(readFileSync(path, 'utf8'))) {
        offenders.push(path.slice(root.length));
      }
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
