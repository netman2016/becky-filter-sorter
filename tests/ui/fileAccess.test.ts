import { describe, expect, it } from 'vitest';
import {
  saveFile,
  type DirectoryHandleLike,
  type FileHandleLike,
  type SaveEnv,
  type SaveRequest,
  type WritableLike,
} from '../../src/ui/fs/fileAccess';

const NAME = 'IFilter.def';
const NOW = new Date(2026, 9, 25, 12, 34, 56);
const BAK = 'IFilter.def.bak-20261025-123456';
const BASE = new Uint8Array([1, 2, 3, 13, 10]);
const NEW = new Uint8Array([3, 2, 1, 13, 10]);

function named(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

/** メモリ上のフォルダ。操作をログに記録する */
class FakeDisk {
  files = new Map<string, Uint8Array>();
  log: string[] = [];
  /** 書き込み確定時に内容を差し替える（読み戻し不一致の再現） */
  corrupt: ((name: string, bytes: Uint8Array) => Uint8Array) | null = null;
  /** close で例外を出すファイル名 */
  failCloseFor: string | null = null;
  permission: PermissionState = 'granted';
  dir(): DirectoryHandleLike {
    return new FakeDir(this);
  }
}

class FakeFileHandle implements FileHandleLike {
  readonly kind = 'file' as const;
  constructor(
    private disk: FakeDisk,
    readonly name: string,
    private label: string,
  ) {}
  async getFile() {
    const bytes = this.disk.files.get(this.name);
    if (!bytes) throw named('NotFoundError');
    this.disk.log.push(`read:${this.label}`);
    return { arrayBuffer: async () => bytes.slice().buffer };
  }
  async createWritable(): Promise<WritableLike> {
    this.disk.log.push(`open-write:${this.label}`);
    let buf = new Uint8Array(0);
    return {
      write: async (d) => {
        buf = d.slice();
      },
      close: async () => {
        if (this.disk.failCloseFor === this.name) throw named('InvalidStateError');
        const committed = this.disk.corrupt ? this.disk.corrupt(this.name, buf) : buf;
        this.disk.files.set(this.name, committed);
        this.disk.log.push(`commit:${this.label}`);
      },
      abort: async () => {
        this.disk.log.push(`abort:${this.label}`);
      },
    };
  }
  async isSameEntry(other: FileHandleLike) {
    return other instanceof FakeFileHandle && other.disk === this.disk && other.name === this.name;
  }
}

class FakeDir implements DirectoryHandleLike {
  constructor(private disk: FakeDisk) {}
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.disk.files.has(name)) {
      if (!options?.create) throw named('NotFoundError');
      this.disk.files.set(name, new Uint8Array(0));
      this.disk.log.push(`create:${name}`);
    }
    return new FakeFileHandle(this.disk, name, `dir:${name}`);
  }
  async queryPermission() {
    return this.disk.permission;
  }
  async requestPermission() {
    return this.disk.permission;
  }
}

type Setup = {
  disk: FakeDisk;
  picker: FileHandleLike;
  env: SaveEnv & { downloads: [string, Uint8Array][]; picks: number };
  req: (dirHandle?: DirectoryHandleLike | null) => SaveRequest;
};

function setup(pick?: (disk: FakeDisk) => Promise<DirectoryHandleLike>): Setup {
  const disk = new FakeDisk();
  disk.files.set(NAME, BASE.slice());
  // ファイルピッカーで開いたハンドル（これには書かないこと）
  const picker = new FakeFileHandle(disk, NAME, 'picker');
  const env = {
    downloads: [] as [string, Uint8Array][],
    picks: 0,
    async pickDirectory() {
      env.picks++;
      return pick ? pick(disk) : disk.dir();
    },
    async download(bytes: Uint8Array, fileName: string) {
      env.downloads.push([fileName, bytes.slice()]);
    },
  };
  const req = (dirHandle: DirectoryHandleLike | null = null): SaveRequest => ({
    session: { fileName: NAME, fileHandle: picker, dirHandle },
    baseBytes: BASE,
    newBytes: NEW,
    now: NOW,
  });
  return { disk, picker, env, req };
}

const writesTo = (log: string[], label: string) => log.filter((l) => l === `open-write:${label}`).length;

describe('上書き保存（.bak つき）', () => {
  it('成功: .bak の書き込みと読み戻しが、本体の書き込みより前', async () => {
    const { disk, env, req } = setup();
    const { outcome, dirHandle } = await saveFile(req(), env);

    expect(outcome).toEqual({ kind: 'saved', bytes: NEW, fileName: NAME, backupName: BAK });
    expect(dirHandle).not.toBeNull();
    expect(disk.files.get(NAME)).toEqual(NEW);
    expect(disk.files.get(BAK)).toEqual(BASE);
    expect(disk.log).toEqual([
      `read:dir:${NAME}`, // 1. ディスク上の内容を確認
      `create:${BAK}`,
      `open-write:dir:${BAK}`,
      `commit:dir:${BAK}`,
      `read:dir:${BAK}`, // 2. .bak を読み戻して確認
      `open-write:dir:${NAME}`, // 3. ここで初めて本体に書く
      `commit:dir:${NAME}`,
      `read:dir:${NAME}`, // 本体を読み戻して確認
    ]);
    expect(env.downloads).toEqual([]);
  });

  it('書き込みはフォルダから取り直したハンドルにだけ行い、ピッカーのハンドルには書かない', async () => {
    const { disk, env, req } = setup();
    await saveFile(req(), env);
    expect(writesTo(disk.log, 'picker')).toBe(0);
    expect(disk.log.filter((l) => l.startsWith('open-write:')).every((l) => l.startsWith('open-write:dir:'))).toBe(
      true,
    );
  });

  it('2 回目以降は選んだフォルダを使い回す', async () => {
    const { env, req } = setup();
    const first = await saveFile(req(), env);
    expect(env.picks).toBe(1);
    const second = await saveFile({ ...req(first.dirHandle), baseBytes: NEW, now: new Date(2026, 9, 25, 13, 0, 0) }, env);
    expect(second.outcome.kind).toBe('saved');
    expect(env.picks).toBe(1);
  });

  it('ディスク上の内容が基準と違えば、何も書かずに中止', async () => {
    const { disk, env, req } = setup();
    disk.files.set(NAME, new Uint8Array([9, 9]));
    const { outcome } = await saveFile(req(), env);
    expect(outcome).toEqual({ kind: 'aborted', reason: 'changed-on-disk' });
    expect(disk.log.some((l) => l.startsWith('open-write:') || l.startsWith('create:'))).toBe(false);
    expect(disk.files.get(NAME)).toEqual(new Uint8Array([9, 9]));
  });

  it('同名の .bak があれば、上書きせずに中止', async () => {
    const { disk, env, req } = setup();
    disk.files.set(BAK, new Uint8Array([7]));
    const { outcome } = await saveFile(req(), env);
    expect(outcome).toEqual({ kind: 'aborted', reason: 'backup-exists' });
    expect(disk.files.get(BAK)).toEqual(new Uint8Array([7]));
    expect(disk.files.get(NAME)).toEqual(BASE);
    expect(disk.log.some((l) => l.startsWith('open-write:'))).toBe(false);
  });

  it('別のフォルダ（同名ファイルが別物）を選んだら中止し、フォルダを保持しない', async () => {
    const other = new FakeDisk();
    other.files.set(NAME, BASE.slice());
    const { disk, env, req } = setup(async () => other.dir());
    const { outcome, dirHandle } = await saveFile(req(), env);
    expect(outcome).toEqual({ kind: 'aborted', reason: 'not-same-file' });
    expect(dirHandle).toBeNull();
    expect([...disk.log, ...other.log].some((l) => l.startsWith('open-write:') || l.startsWith('create:'))).toBe(
      false,
    );
  });

  it('選んだフォルダに同名ファイルが無ければ中止', async () => {
    const other = new FakeDisk();
    const { env, req } = setup(async () => other.dir());
    const { outcome } = await saveFile(req(), env);
    expect(outcome).toEqual({ kind: 'aborted', reason: 'not-same-file' });
    expect(other.log).toEqual([]);
  });

  it('.bak の読み戻しが不一致なら、本体には書かずに中止', async () => {
    const { disk, env, req } = setup();
    disk.corrupt = (name, bytes) => (name === BAK ? new Uint8Array([0]) : bytes);
    const { outcome } = await saveFile(req(), env);
    expect(outcome).toEqual({ kind: 'aborted', reason: 'backup-verify-failed' });
    expect(writesTo(disk.log, `dir:${NAME}`)).toBe(0);
    expect(disk.files.get(NAME)).toEqual(BASE);
  });

  it('本体の読み戻しが不一致なら verify-failed と .bak 名を返す（saved にはならない）', async () => {
    const { disk, env, req } = setup();
    disk.corrupt = (name, bytes) => (name === NAME ? new Uint8Array([0]) : bytes);
    const { outcome } = await saveFile(req(), env);
    expect(outcome).toEqual({ kind: 'verify-failed', fileName: NAME, backupName: BAK });
    expect(disk.files.get(BAK)).toEqual(BASE);
  });

  it('本体の書き込みで例外が出たら verify-failed（.bak 名とエラー種別のみ）', async () => {
    const { disk, env, req } = setup();
    disk.failCloseFor = NAME;
    const { outcome } = await saveFile(req(), env);
    expect(outcome).toEqual({ kind: 'verify-failed', fileName: NAME, backupName: BAK, errorName: 'InvalidStateError' });
    expect(disk.log).toContain(`abort:dir:${NAME}`);
    expect(disk.files.get(NAME)).toEqual(BASE);
    expect(disk.files.get(BAK)).toEqual(BASE);
  });
});

describe('ダウンロード保存への切り替え', () => {
  for (const [errorName, reason] of [
    ['AbortError', 'cancelled'],
    ['NotAllowedError', 'denied'],
  ] as const) {
    it(`フォルダ選択が ${errorName}（${reason}）なら、何も書かず .bak → 本体の順にダウンロード`, async () => {
      const { disk, env, req } = setup(async () => {
        throw named(errorName);
      });
      const { outcome, dirHandle } = await saveFile(req(), env);
      expect(outcome).toEqual({ kind: 'downloaded', fileName: NAME, backupName: BAK, viaFallback: true });
      expect(dirHandle).toBeNull();
      expect(env.downloads).toEqual([
        [BAK, BASE],
        [NAME, NEW],
      ]);
      expect(disk.log.some((l) => l.startsWith('open-write:') || l.startsWith('create:'))).toBe(false);
      expect(disk.files.get(NAME)).toEqual(BASE);
    });
  }

  it('フォルダの書き込み権限が拒否されたら、ダウンロード保存に切り替える', async () => {
    const { disk, env, req } = setup();
    disk.permission = 'denied';
    const { outcome } = await saveFile(req(), env);
    expect(outcome.kind).toBe('downloaded');
    expect(env.downloads.map(([n]) => n)).toEqual([BAK, NAME]);
    expect(disk.log.some((l) => l.startsWith('open-write:'))).toBe(false);
  });

  it('切り替え時にディスク上の内容が基準と違えば、ダウンロードせずに中止', async () => {
    const { disk, env, req } = setup(async () => {
      throw named('AbortError');
    });
    disk.files.set(NAME, new Uint8Array([9]));
    const { outcome } = await saveFile(req(), env);
    expect(outcome).toEqual({ kind: 'aborted', reason: 'changed-on-disk' });
    expect(env.downloads).toEqual([]);
  });

  it('API 非対応（ハンドル無し）: 開いた時点の内容を .bak → 本体の順にダウンロード', async () => {
    const { env } = setup();
    const { outcome } = await saveFile(
      { session: { fileName: NAME, fileHandle: null, dirHandle: null }, baseBytes: BASE, newBytes: NEW, now: NOW },
      env,
    );
    expect(outcome).toEqual({ kind: 'downloaded', fileName: NAME, backupName: BAK, viaFallback: false });
    expect(env.downloads).toEqual([
      [BAK, BASE],
      [NAME, NEW],
    ]);
    expect(env.picks).toBe(0);
  });
});
