/// <reference types="types-node-test" />

import test from 'node:test';
import assert from 'node:assert';
import { relative, join } from 'node:path';
import { cmpl, cntntHsh, wtch, WatchFs, WatchEvent } from './index';

// (async () => {
//   for await (const mnfst of wtch({
//     entry: __dirname,
//     processors: [
//       {
//         rename: cntntHsh(1),
//         outDir: __dirname + '/../dist/test',
//       },
//       {
//         rename: cntntHsh(2),
//         outDir: __dirname + '/../dist/test',
//       },
//     ],
//   })) {
//     console.log(mnfst);
//   }
// })().catch((err) => {
//   console.log({ err });
//   process.exit(1);
// });

test('cmpl', async (t) => {
  await t.test('copies over a single file', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: 'test.json', isDir: false },
        { method: 'readFile', path: 'test.json', contents: '{"hi":"ho"}' },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: '{"hi":"ho"}',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: join(__dirname, 'test.json'),
        processors: [
          Promise.resolve({
            outDir: join(__dirname, 'dist'),
          }),
        ],
        fs,
      }),
      { 'test.json': 'test.json' },
    );
    fs.done();
  });

  await t.test('copies single file in directory', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: '', isDir: true },
        { method: 'readdir', path: '', contents: ['test.json'] },
        { method: 'stat', path: 'test.json', isDir: false },
        { method: 'readFile', path: 'test.json', contents: '{"hi":"ho"}' },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: '{"hi":"ho"}',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: __dirname,
        processors: [
          {
            outDir: join(__dirname, 'dist'),
          },
        ],
        fs,
      }),
      { 'test.json': 'test.json' },
    );
    fs.done();
  });

  await t.test('copies files in nested directories', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: '', isDir: true },
        { method: 'readdir', path: '', contents: ['test.json', 'deep'] },
        { method: 'stat', path: 'test.json', isDir: false },
        { method: 'stat', path: 'deep', isDir: true },
        { method: 'readdir', path: 'deep', contents: ['test2.json'] },
        { method: 'stat', path: 'deep/test2.json', isDir: false },
        { method: 'readFile', path: 'test.json', contents: '{"hi":"ho"}' },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: '{"hi":"ho"}',
        },
        {
          method: 'readFile',
          path: 'deep/test2.json',
          contents: '{"hü":"hott"}',
        },
        { method: 'mkdir', path: 'dist/deep' },
        {
          method: 'writeFile',
          path: 'dist/deep/test2.json',
          contents: '{"hü":"hott"}',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: __dirname,
        processors: [
          {
            outDir: join(__dirname, 'dist'),
          },
        ],
        fs,
      }),
      {
        'deep/test2.json': 'deep/test2.json',
        'test.json': 'test.json',
      },
    );
    fs.done();
  });

  await t.test('it ignores nested folders', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: '', isDir: true },
        { method: 'readdir', path: '', contents: ['test.json', 'deep'] },
        { method: 'stat', path: 'test.json', isDir: false },
        { method: 'stat', path: 'deep', isDir: true },
        { method: 'readFile', path: 'test.json', contents: '{"hi":"ho"}' },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: '{"hi":"ho"}',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: __dirname,
        processors: [
          {
            recursive: false,
            outDir: join(__dirname, 'dist'),
          },
        ],
        fs,
      }),
      {
        'test.json': 'test.json',
      },
    );
    fs.done();
  });

  await t.test('it ignores specific files', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: '', isDir: true },
        {
          method: 'readdir',
          path: '',
          contents: ['test.json', 'test2.json', 'deep'],
        },
        { method: 'stat', path: 'test.json', isDir: false },
        { method: 'stat', path: 'test2.json', isDir: false },
        { method: 'stat', path: 'deep', isDir: true },
        { method: 'readFile', path: 'test.json', contents: '{"hi":"ho"}' },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: '{"hi":"ho"}',
        },
      ],
      __dirname,
    );

    let i = 0;
    assert.deepEqual(
      await cmpl({
        entry: __dirname,
        processors: [
          {
            include: async (name, isDir) => {
              switch (i++) {
                case 0:
                  assert.equal(name, 'test.json');
                  assert.equal(isDir, false);
                  break;
                case 1:
                  assert.equal(name, 'test2.json');
                  assert.equal(isDir, false);
                  break;
                case 2:
                  assert.equal(name, 'deep');
                  assert.equal(isDir, true);
                  break;
              }

              return name === 'test.json';
            },
            outDir: join(__dirname, 'dist'),
          },
        ],
        fs,
      }),
      {
        'test.json': 'test.json',
      },
    );
    fs.done();
  });

  await t.test('it transforms contents', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: 'rofl',
        },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: 'leeeeel',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: join(__dirname, 'test.json'),
        processors: [
          {
            transform: (content, file) => {
              assert.equal(file, 'test.json');
              assert.equal(content.toString(), 'rofl');
              return Buffer.from('leeeeel');
            },
            outDir: join(__dirname, 'dist'),
          },
        ],
        fs,
      }),
      {
        'test.json': 'test.json',
      },
    );
    fs.done();
  });

  await t.test('excludes null transforms', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: 'rofl',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: join(__dirname, 'test.json'),
        processors: [
          {
            transform: () => null,
            outDir: join(__dirname, 'dist'),
          },
        ],
        fs,
      }),
      {},
    );
    fs.done();
  });

  await t.test('it transforms into multiple files', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: 'rofl',
        },
        { method: 'mkdir', path: 'dist' },
        { method: 'mkdir', path: 'dist/deep' },
        {
          method: 'writeFile',
          path: 'dist/one.json',
          contents: '1',
        },
        {
          method: 'writeFile',
          path: 'dist/deep/two.json',
          contents: '2',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: join(__dirname, 'test.json'),
        processors: [
          {
            transform: (content, file) => {
              assert.equal(file, 'test.json');
              assert.equal(content.toString(), 'rofl');
              return [
                { content: Buffer.from('1'), name: 'one.json' },
                { content: Buffer.from('2'), name: 'deep/two.json' },
              ];
            },
            outDir: join(__dirname, 'dist'),
          },
        ],
        fs,
      }),
      {
        'test.json': ['one.json', 'deep/two.json'],
      },
    );
    fs.done();
  });

  await t.test('it applies content hashes', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: '{"hi":"ho"}',
        },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test-DF67FD3A.json',
          contents: '{"hi":"ho"}',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: join(__dirname, 'test.json'),
        processors: [
          {
            outDir: join(__dirname, 'dist'),
            rename: cntntHsh(8),
          },
        ],
        fs,
      }),
      {
        'test.json': 'test-DF67FD3A.json',
      },
    );
    fs.done();
  });

  await t.test('it creates custom file names', async () => {
    const fs = createFs(
      [
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: '{"hi":"ho"}',
        },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/q3p45giunrfd.f35r',
          contents: '{"hi":"ho"}',
        },
      ],
      __dirname,
    );

    assert.deepEqual(
      await cmpl({
        entry: join(__dirname, 'test.json'),
        processors: [
          {
            rename: (name, content) => {
              assert.equal(name, 'test.json');
              assert.equal(content.toString(), '{"hi":"ho"}');
              return 'q3p45giunrfd.f35r';
            },
            outDir: join(__dirname, 'dist'),
          },
        ],

        fs,
      }),
      {
        'test.json': 'q3p45giunrfd.f35r',
      },
    );
    fs.done();
  });

  await t.test('watches single file', async () => {
    const watchEvents: Deferred<WatchEvent>[] = [defer()];
    const watcher = createWatcher(watchEvents.map(({ promise }) => promise));
    const fs = createFs(
      [
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: '{"hi":"ho"}',
        },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test-DF.json',
          contents: '{"hi":"ho"}',
        },
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'watch',
          path: 'test.json',
          options: { recursive: false, signal: undefined },
          watcher,
        },
        {
          method: 'readFile',
          path: 'test.json',
          contents: '{"ho":"hi"}',
        },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test-9E.json',
          contents: '{"ho":"hi"}',
        },
      ],
      __dirname,
    );

    const wtchr = wtch({
      processors: [
        {
          outDir: join(__dirname, 'dist'),
          rename: cntntHsh(2),
        },
      ],
      entry: join(__dirname, 'test.json'),
      fs,
    });

    let i = 0;
    for await (const manifest of wtchr) {
      switch (i++) {
        case 0:
          assert.deepEqual(manifest, {
            'test.json': 'test-DF.json',
          });
          watchEvents[0].resolve({
            eventType: 'change',
            filename: 'test.json',
          });
          break;
        case 1:
          assert.deepEqual(manifest, {
            'test.json': 'test-9E.json',
          });
          break;
        default:
          throw new Error('NEIN');
      }
    }
    fs.done();
  });

  await t.test('ignores newly added files', async () => {
    const watchEvents: Deferred<WatchEvent>[] = [defer()];
    const watcher = createWatcher(watchEvents.map(({ promise }) => promise));
    const fs = createFs(
      [
        { method: 'stat', path: '', isDir: true },
        { method: 'readdir', path: '', contents: ['test.json'] },
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: '{"hi":"ho"}',
        },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: '{"hi":"ho"}',
        },
        { method: 'stat', path: '', isDir: true },
        {
          method: 'watch',
          path: '',
          options: { recursive: true, signal: undefined },
          watcher,
        },
      ],
      __dirname,
    );

    const wtchr = wtch({
      entry: __dirname,
      processors: [
        {
          include: (name) => name === 'test.json',
          outDir: join(__dirname, 'dist'),
        },
      ],
      fs,
    });

    let i = 0;
    for await (const manifest of wtchr) {
      switch (i++) {
        case 0:
          assert.deepEqual(manifest, {
            'test.json': 'test.json',
          });
          watchEvents[0].resolve({
            eventType: 'change',
            filename: 'test2.json',
          });
          break;
        default:
          throw new Error('NEIN');
      }
    }
    fs.done();
  });

  await t.test('continues watching despite error', async () => {
    const watchEvents: Deferred<WatchEvent>[] = [defer(), defer(), defer()];
    const watcher = createWatcher(watchEvents.map(({ promise }) => promise));
    const myErr1 = new Error('Err1');
    const myErr2 = new Error('Err2');
    const fs = createFs(
      [
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: myErr1,
        },
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'watch',
          path: 'test.json',
          options: { recursive: false, signal: undefined },
          watcher,
        },
        { method: 'stat', path: 'test.json', isDir: false },
        {
          method: 'readFile',
          path: 'test.json',
          contents: '{"hi":"ho"}',
        },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: '{"hi":"ho"}',
        },
        {
          method: 'readFile',
          path: 'test.json',
          contents: myErr2,
        },
        {
          method: 'readFile',
          path: 'test.json',
          contents: '{"le":"la"}',
        },
        { method: 'mkdir', path: 'dist' },
        {
          method: 'writeFile',
          path: 'dist/test.json',
          contents: '{"le":"la"}',
        },
      ],
      __dirname,
    );

    let i = 0;

    const wtchr = wtch({
      entry: join(__dirname, 'test.json'),
      onError: (err) => {
        switch (i++) {
          case 0:
            assert.equal(err, myErr1);
            watchEvents[0].resolve({
              eventType: 'change',
              filename: 'test.json',
            });
            break;
          case 1:
            assert.equal(err, myErr2);
            watchEvents[2].resolve({
              eventType: 'change',
              filename: 'test.json',
            });
            break;
          default:
            throw err;
        }
      },
      processors: [
        {
          outDir: join(__dirname, 'dist'),
        },
      ],
      fs,
    });

    let j = 0;
    for await (const manifest of wtchr) {
      switch (j++) {
        case 0:
          assert.deepEqual(manifest, {
            'test.json': 'test.json',
          });
          watchEvents[1].resolve({
            eventType: 'change',
            filename: 'test.json',
          });
          break;
        case 1:
          assert.deepEqual(manifest, {
            'test.json': 'test.json',
          });
          break;
        default:
          throw new Error('NEIN');
      }
    }
    fs.done();
  });
});

interface ExpectedReaddir {
  method: 'readdir';
  path: string;
  contents: string[] | Error;
}
interface ExpectedStat {
  method: 'stat';
  path: string;
  isDir: boolean | Error;
}
interface ExpectedMkdir {
  method: 'mkdir';
  path: string;
  error?: Error;
}
interface ExpectedReadFile {
  method: 'readFile';
  path: string;
  contents: Buffer | string | Error;
}
interface ExpectedWriteFile {
  method: 'writeFile';
  path: string;
  contents: Buffer | string | Error;
}
interface ExpectedWatch {
  method: 'watch';
  path: string;
  options: { recursive?: boolean; signal?: AbortSignal };
  watcher: AsyncIterable<WatchEvent> | Error;
}

type ExpectedCall =
  | ExpectedReaddir
  | ExpectedStat
  | ExpectedMkdir
  | ExpectedReadFile
  | ExpectedWriteFile
  | ExpectedWatch;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (val: T) => void;
  reject: (error: unknown) => void;
};
function defer<T>(): Deferred<T> {
  let resolve: (val: T) => void;
  let reject: (error: unknown) => void;
  let promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // @ts-ignore
  return { promise, resolve, reject };
}

function createWatcher(events: Promise<WatchEvent | Error>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        const next = await event;
        if (next instanceof Error) {
          throw next;
        } else {
          yield next;
        }
      }
    },
  };
}

function createFs(
  expectedCalls: ExpectedCall[],
  baseDir: string,
): WatchFs & { done: () => void } {
  let i = 0;
  const getNextCall = <M extends ExpectedCall>(
    method: M['method'],
    args: any,
  ): M => {
    // console.log(`${i++} --- fs.${method}(${JSON.stringify(args)})`);
    const next = expectedCalls.shift();
    assert.ok(next !== undefined, `Unexpected call to fs.${method}`);
    const { method: exMeth, ...exArgs } = next;
    assert.ok(
      exMeth === method,
      `Expected fs.${exMeth}(${JSON.stringify(
        exArgs,
      )}) call - got fs.${method}(${JSON.stringify(args)})`,
    );
    return next as any;
  };
  return {
    readdir: async (dir) => {
      const { path, contents } = getNextCall<ExpectedReaddir>(
        'readdir',
        relative(baseDir, dir),
      );
      assert.equal(relative(baseDir, dir), path);
      if (contents instanceof Error) {
        throw contents;
      }
      return contents;
    },
    stat: async (p) => {
      const { path, isDir } = getNextCall<ExpectedStat>(
        'stat',
        relative(baseDir, p),
      );
      assert.equal(relative(baseDir, p), path);
      if (isDir instanceof Error) {
        throw isDir;
      }
      return {
        isDirectory: () => isDir,
        mtimeMs: 0,
      };
    },
    mkdir: async (p) => {
      const { path, error } = getNextCall<ExpectedMkdir>(
        'mkdir',
        relative(baseDir, p),
      );
      assert.equal(relative(baseDir, p), path);
      if (error) {
        throw error;
      }
      return undefined;
    },
    readFile: async (p) => {
      const { path, contents } = getNextCall<ExpectedReadFile>(
        'readFile',
        relative(baseDir, p),
      );
      assert.equal(relative(baseDir, p), path);
      if (contents instanceof Error) {
        throw contents;
      }
      return contents instanceof Buffer ? contents : Buffer.from(contents);
    },
    writeFile: async (p, c) => {
      const { path, contents } = getNextCall<ExpectedWriteFile>('writeFile', [
        relative(baseDir, p),
        c,
      ]);
      assert.equal(relative(baseDir, p), path);
      if (contents instanceof Error) {
        throw contents;
      }
      assert.equal(c.toString(), contents.toString());
    },
    watch: (p, o) => {
      const { path, options, watcher } = getNextCall<ExpectedWatch>('watch', [
        relative(baseDir, p),
        o,
      ]);
      assert.equal(relative(baseDir, p), path);
      assert.deepEqual(options, o);
      if (watcher instanceof Error) {
        throw watcher;
      }

      return watcher;
    },
    done() {
      assert.ok(
        expectedCalls.length === 0,
        `Got ${expectedCalls.length} trailing expectations on fs`,
      );
    },
  };
}
