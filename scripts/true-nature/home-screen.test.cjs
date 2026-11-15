const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicRoot = path.resolve(__dirname, '../../apps/nextjs-app/public');
const manifest = JSON.parse(
  fs.readFileSync(path.join(publicRoot, 'images/favicon/site.webmanifest'), 'utf8')
);
const manifestUrl = new URL('https://tables.example/images/favicon/site.webmanifest');
const start = new URL(manifest.start_url, manifestUrl);
const scope = new URL(manifest.scope, manifestUrl);

test('Home Screen installs from different tables share a stable identity and launch', () => {
  assert.equal(new URL(manifest.id, start).href, 'https://tables.example/');
  assert.equal(start.href, 'https://tables.example/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name.trim());
  assert.ok(manifest.short_name.trim());
});

test('all app routes and the login callback remain in scope', () => {
  assert.equal(scope.href, 'https://tables.example/');
  for (const route of ['/space/example', '/base/example/table/other/view', '/api/auth/oidc/callback']) {
    assert.ok(new URL(route, start).href.startsWith(scope.href));
  }
  assert.ok(!new URL('https://id.example/authorize').href.startsWith(scope.href));
});

test('install icons resolve to existing public assets', () => {
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestUrl);
    assert.equal(url.origin, start.origin);
    assert.ok(fs.existsSync(path.join(publicRoot, url.pathname)));
  }
});
