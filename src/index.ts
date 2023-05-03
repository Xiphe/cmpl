export interface Path {
  join: (...segments: string[]) => string;
  basename: (path: string, ext?: string) => string;
  extname: (path: string) => string;
  relative: (a: string, b: string) => string;
  dirname: (path: string) => string;
}
export interface Fs {
  readdir: (dir: string) => Promise<string[]>;
  stat: (
    dirOrFile: string,
  ) => Promise<{ isDirectory: () => boolean; mtimeMs: number }>;
  readFile: (path: string) => Promise<Buffer>;
  mkdir: (
    path: string,
    opts?: { recursive: true },
  ) => Promise<string | undefined>;
  writeFile: (path: string, contents: Buffer) => Promise<void>;
}
export interface Crypto {
  createHash: (algorithm: 'sha256') => {
    update: (content: Buffer) => { digest: (encoding: 'hex') => string };
  };
}
export type TransformResult =
  | Buffer
  | {
      content: Buffer;
      name: string;
    }
  | {
      content: Buffer;
      name: string;
    }[]
  | null;
export type TransformFn = (
  content: Buffer,
  file: string,
) => TransformResult | Promise<TransformResult>;
export type FileNamerFn = (
  originalName: string,
  contents: Buffer,
) => string | Promise<string>;
export interface BasePrcssr {
  outDir: string;
  recursive?: boolean;
  include?: (name: string, isDir: boolean) => boolean | Promise<boolean>;
}
export interface RenamePrcssr extends BasePrcssr {
  rename?: FileNamerFn;
}
export interface TransformPrcssr extends BasePrcssr {
  transform: TransformFn;
}
export type Prcssr = RenamePrcssr | TransformPrcssr;
export interface CmplOptions {
  entry: string;
  processors: (Prcssr | Promise<Prcssr>)[];
  path?: Path | Promise<Path>;
  fs?: Fs | Promise<Fs>;
}

export const cntntHsh =
  (
    length: number = 8,
    crypto: Crypto | Promise<Crypto> = import('node:crypto'),
    path: Path | Promise<Path> = import('node:path'),
  ): FileNamerFn =>
  async (name, content) => {
    const { createHash } = await crypto;
    const { basename, extname } = await path;

    return `${basename(name, extname(name))}-${createHash('sha256')
      .update(content)
      .digest('hex')
      .substring(0, length)
      .toUpperCase()}${extname(name)}`;
  };

export async function prcss(
  file: string,
  {
    entry,
    fs = import('node:fs/promises'),
    path = import('node:path'),
  }: Pick<CmplOptions, 'entry' | 'fs' | 'path'>,
  processors: (Prcssr | null)[],
): Promise<(null | Record<string, string | string[]>)[]> {
  const { relative, dirname, join } = await path;
  const { readFile, mkdir, writeFile } = await fs;
  const contentsP = readFile(file);
  const inName = relative(entry, file);

  return Promise.all(
    processors.map(async (p) => {
      if (!p) {
        return p;
      }

      const copyName = (await path).basename(inName);
      if (!isRenamePrcssr(p) && typeof (p as any).rename === 'function') {
        console.warn(
          'WARING: unexpected rename method on transform processor, will be ignored!',
          'Return new name from transform method via { content: Buffer, name: string }',
        );
      }

      const contents = isRenamePrcssr(p)
        ? {
            content: await contentsP,
            name: (await p.rename?.(inName, await contentsP)) || copyName,
          }
        : await p.transform(await contentsP, inName);

      if (contents === null) {
        return null;
      }

      const targerDir = join(p.outDir, relative(entry, dirname(file)));

      const writes = Array.isArray(contents)
        ? contents
        : contents instanceof Buffer
        ? [{ content: contents, name: copyName }]
        : [contents];

      if (writes.length === 0) {
        return null;
      }

      const outFiles = await Promise.all(
        writes.map(async ({ content, name }) => {
          const targetFile = join(targerDir, name);

          await mkdir(dirname(targetFile), { recursive: true });
          await writeFile(targetFile, content);

          return relative(p.outDir, targetFile);
        }),
      );

      return {
        [inName]: Array.isArray(contents) ? outFiles : outFiles[0],
      };
    }),
  );
}

export async function cmpl({
  entry,
  processors,
  fs = import('node:fs/promises'),
  path = import('node:path'),
}: CmplOptions) {
  const manifest: Record<string, string>[] = Array.from({
    length: processors.length,
  }).map(() => ({}));
  const { relative, join, dirname } = await path;
  const { readdir, stat } = await fs;
  let entryDir: string | null;

  const handle = async (
    subEntry: string,
    parentDir: string,
    processors: (Prcssr | null)[],
  ) => {
    const entryPath = join(parentDir, subEntry);
    const isDir = (await stat(entryPath)).isDirectory();
    if (!entryDir) {
      entryDir = isDir ? entry : dirname(entry);
    }

    if (isDir) {
      let relevantDir = false;
      const dirProcessors = await Promise.all(
        processors.map(async (p) => {
          const incl =
            p &&
            (subEntry === entry ||
              (p.recursive !== false &&
                (!p.include ||
                  (await p.include(relative(entryDir!, entryPath), true)))));
          if (incl) {
            relevantDir = true;
          }
          return incl ? p : null;
        }),
      );

      if (relevantDir) {
        await readDir(entryPath, dirProcessors);
      }
    }

    if (!isDir) {
      let relevantFile = false;
      const fileProcessors = await Promise.all(
        processors.map(async (p) => {
          const incl =
            p &&
            (!p.include ||
              (await p.include(relative(entryDir!, entryPath), false)))
              ? p
              : null;

          if (incl) {
            relevantFile = true;
          }
          return incl;
        }),
      );

      if (!relevantFile) {
        return;
      }

      (
        await prcss(
          entryPath,
          { fs, path, entry: entry === subEntry ? entryDir! : entry },
          fileProcessors,
        )
      ).forEach((v, i) => {
        if (v !== null) {
          Object.assign(manifest[i], v);
        }
      });
    }
  };

  const readDir = async (
    dir: string,
    processors: (Prcssr | null)[],
  ): Promise<void> => {
    await Promise.all(
      (await readdir(dir)).map((e) => handle(e, dir, processors)),
    );
  };

  await handle(entry, '', await Promise.all(processors));

  if (processors.length === 1) {
    return manifest[0];
  }

  return manifest;
}

export interface WatchEvent {
  eventType: 'rename' | 'change';
  filename: string;
}
export interface WatchFs extends Fs {
  watch: (
    path: string,
    opts?: { recursive: boolean; signal?: AbortSignal },
  ) => AsyncIterable<WatchEvent>;
}

export interface WtchOpts extends Omit<CmplOptions, 'fs'> {
  signal?: AbortSignal;
  fs?: WatchFs | Promise<WatchFs>;
  poll?: boolean | number;
  onError?: (err: unknown) => void;
}

export async function* wtch({
  signal,
  entry,
  processors,
  poll = pllOptFromEnv(),
  onError = process.env.CI
    ? (err) => {
        throw err;
      }
    : (err) => console.log(err instanceof Error ? err.message : err),
  fs = import('node:fs/promises'),
  path = import('node:path'),
}: WtchOpts) {
  const cmplOpts = {
    entry,
    fs,
    processors,
    path,
  };
  const { join, dirname } = await path;
  const { watch, stat } = await fs;

  let manifest: Record<string, string>[] | null = null;
  const exportManifest = () =>
    manifest!.length === 1
      ? Object.assign({}, manifest![0])
      : manifest!.map((m) => Object.assign({}, m));

  try {
    const m = await cmpl(cmplOpts);
    manifest = Array.isArray(m) ? m : [m];
    yield exportManifest();
  } catch (err) {
    onError(err);
  }

  const isDir = (await stat(entry)).isDirectory();
  const baseDir = isDir ? entry : dirname(entry);
  const prcssOpts = isDir
    ? cmplOpts
    : {
        ...cmplOpts,
        entry: baseDir,
      };

  const recursive = (await Promise.all(processors)).some(
    ({ recursive }) => recursive !== false,
  );

  const wtchOrPll = poll
    ? createPll({
        fs,
        path,
        interval: typeof poll === 'number' ? poll : undefined,
      })
    : watch;

  const queue = new AsyncQueue<WatchEvent>();

  // @ts-ignore
  signal?.addEventListener('abort', () => {
    queue.done(true);
  });

  async function startWatching() {
    for await (const event of wtchOrPll(entry, {
      recursive: isDir ? recursive : false,
      signal,
    })) {
      queue.push(event);
    }
    queue.done();
  }

  startWatching();

  for await (const event of queue) {
    try {
      if (!manifest) {
        const m = await cmpl(cmplOpts);
        manifest = Array.isArray(m) ? m : [m];
        yield exportManifest();
      } else {
        switch (event.eventType) {
          case 'rename': {
            const exists = manifest.some((m) => m[event.filename]);
            if (exists) {
              manifest.forEach((m) => {
                if (m[event.filename]) {
                  delete m[event.filename];
                }
              });
              yield exportManifest();

              break;
            }
          }
          case 'change': {
            let relevantChange = false;
            const changeProcessors = await Promise.all(
              (
                await Promise.all(processors)
              ).map(async (p) => {
                const incl =
                  p && (!p.include || (await p.include(event.filename, false)))
                    ? p
                    : null;

                if (incl) {
                  relevantChange = true;
                }
                return incl;
              }),
            );

            if (relevantChange) {
              (
                await prcss(
                  join(baseDir, event.filename),
                  prcssOpts,
                  changeProcessors,
                )
              ).forEach((v, i) => {
                if (v !== null) {
                  Object.assign(manifest![i], v);
                }
              });
              yield exportManifest();
            }
            break;
          }
        }
      }
    } catch (err) {
      onError(err);
    }
  }
}

function createPll({
  path,
  fs,
  interval = 300,
}: Required<Pick<CmplOptions, 'path' | 'fs'>> & { interval?: number }) {
  return async function* pll(
    entry: string,
    opts: { recursive: boolean; signal?: AbortSignal },
  ): AsyncIterable<WatchEvent> {
    const { join, relative } = await path;
    const { readdir, stat } = await fs;
    const readDir = async (
      dir: string,
      state: Record<string, number> = {},
    ): Promise<Record<string, number>> => {
      await Promise.all(
        (
          await readdir(dir)
        ).map(async (entryName) => {
          const dirEntry = join(dir, entryName);
          const s = await stat(dirEntry);
          if (s.isDirectory() && opts.recursive) {
            await readDir(dirEntry, state);
          } else {
            state[relative(entry, dirEntry)] = s.mtimeMs;
          }
        }),
      );

      return state;
    };

    let state = await readDir(entry);

    while (!opts.signal?.aborted) {
      await new Promise((res) => setTimeout(res, interval));
      if (opts.signal?.aborted) {
        break;
      }
      const nextState = await readDir(entry);
      if (opts.signal?.aborted) {
        break;
      }

      const oldEntries = Object.entries(state);
      for (let i = 0, l = oldEntries.length; i < l; i++) {
        const [filename, mtime] = oldEntries[i];
        if (!nextState[filename]) {
          yield { eventType: 'rename', filename };
        } else if (nextState[filename] !== mtime) {
          yield { eventType: 'change', filename };
        }
      }

      const newEntires = Object.entries(state);
      for (let i = 0, l = newEntires.length; i < l; i++) {
        const [filename] = newEntires[i];
        if (!state[filename]) {
          yield { eventType: 'rename', filename };
        }
      }

      state = nextState;
    }
  };
}

function pllOptFromEnv() {
  if (!process.env.CMPL_USE_POLLING) {
    return false;
  }
  const n = parseInt(process.env.CMPL_USE_POLLING);
  if (!isNaN(n)) {
    return n;
  }
  return true;
}

function isRenamePrcssr(prcssr: Prcssr): prcssr is RenamePrcssr {
  return typeof (prcssr as any).transform !== 'function';
}

class AsyncQueue<Value> {
  private queue: Array<Value> = [];
  private resolveNext: (() => void) | null = null;
  private isDone?: boolean | 'abort' = false;
  private onAbort?: (err: 'done') => void;

  public done(abort?: boolean): void {
    this.isDone = abort ? 'abort' : true;
    this.onAbort?.('done');
  }

  public push(value: Value): void {
    if (this.isDone) {
      throw new Error('Can not push to done queue');
    }
    this.queue.push(value);
    if (this.resolveNext) {
      this.resolveNext();
    }
  }

  private async pop(): Promise<Value> {
    if (this.queue.length === 0) {
      if (this.isDone) {
        throw 'done';
      }
      await new Promise<void>((resolve, reject) => {
        this.onAbort = reject;
        this.resolveNext = resolve;
      });
      this.onAbort = undefined;
    }

    const value = this.queue.shift()!;
    return value;
  }

  public [Symbol.asyncIterator](): AsyncIterator<Value> {
    return {
      next: async (): Promise<IteratorResult<Value>> => {
        try {
          if (this.isDone === 'abort') {
            throw 'done';
          }

          const value = await this.pop();
          return {
            value,
            done: false,
          };
        } catch (err) {
          if (err === 'done') {
            return { done: true, value: undefined };
          }
          throw err;
        }
      },
    };
  }
}
