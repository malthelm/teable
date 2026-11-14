const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../..');
for (const [value, expected] of [
  [undefined, undefined],
  ['2', 2],
  ['0', 'error'],
  ['1.5', 'error'],
  ['bad', 'error'],
  ['', 'error'],
]) {
  test(`build worker override: ${JSON.stringify(value)}`, () => {
    const env = { ...process.env, NEXT_BUILD_ENV_SENTRY_ENABLED: 'false' };
    if (value === undefined) delete env.NEXT_BUILD_ENV_CPUS;
    else env.NEXT_BUILD_ENV_CPUS = value;
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "const c=require('./apps/nextjs-app/next.config.js'); console.log('CPUS='+c.experimental.cpus)",
      ],
      { cwd: root, env, encoding: 'utf8' }
    );
    if (expected === 'error') {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /positive integer/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('CPUS=' + expected));
    }
  });
}
