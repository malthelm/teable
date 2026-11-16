const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, rm, readdir, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const oauth = require('./songstats-oauth.cjs');
let dir, originalFetch;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const write = (name, value) => writeFile(join(dir, name), JSON.stringify(value), { mode: 0o600 });
const read = async name => JSON.parse(await readFile(join(dir, name), 'utf8'));
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'songstats-oauth-')); originalFetch = global.fetch;
  await write('oauth-client.json', { client_id: 'test-client' });
  await write('config.json', { teableToken: 'private-test-teable', enabled: false });
});
afterEach(async () => { global.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); });
async function start() {
  const url = new URL(await oauth.begin(dir, 'admin', 'session'));
  return { url, query: { state: url.searchParams.get('state'), code: 'private-code', iss: 'https://api.songstats.com' } };
}
function mockSuccessful(calls) {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth/token')) return json({ access_token: 'private-access', refresh_token: 'private-refresh', token_type: 'Bearer', expires_in: 3600 });
    if (url.endsWith('/oauth/revoke') || options.method === 'DELETE') return new Response(null, { status: 204 });
    const request = JSON.parse(options.body);
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return json({ jsonrpc: '2.0', id: request.id, result: request.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {} } : { structuredContent: { response: { result: 'success', catalog: [] } } } });
  };
}
test('PKCE and callback bind the state to user, session, issuer and expiry', async () => {
  const { url, query } = await start();
  assert.equal(url.origin, 'https://api.songstats.com');
  assert.equal(url.searchParams.get('scope'), 'mcp:read enterprise:read');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const file = (await readdir(dir)).find(n => n.startsWith('oauth-pending-'));
  const pending = await read(file);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
  global.fetch = () => { throw new Error('No network allowed for invalid state'); };
  await assert.rejects(oauth.complete(dir, query, 'other', 'session'), /another session/);
  await assert.rejects(oauth.complete(dir, query, 'admin', 'other'), /another session/);
  await assert.rejects(oauth.complete(dir, { ...query, iss: 'https://evil.invalid' }, 'admin', 'session'), /another session/);
  await assert.rejects(oauth.complete(dir, { ...query, state: '../path' }, 'admin', 'session'), /invalid/);
  await write(file, { ...pending, expiresAt: 0 });
  await assert.rejects(oauth.complete(dir, query, 'admin', 'session'), /expired/);
});
test('successful callback verifies catalog access, stores private tokens and consumes state once', async () => {
  const { query } = await start(), calls = []; mockSuccessful(calls);
  await oauth.complete(dir, query, 'admin', 'session');
  assert.equal((await read('config.json')).connectionType, 'oauth');
  assert.equal((await read('config.json')).enabled, true);
  assert.equal((await read('oauth-tokens.json')).refreshToken, 'private-refresh');
  assert.equal((await stat(join(dir, 'oauth-tokens.json'))).mode & 0o777, 0o600);
  const tool = calls.map(c => { try { return JSON.parse(c.options.body); } catch { return {}; } }).find(c => c.method === 'tools/call');
  assert.equal(tool.params.name, 'get_labels_catalog'); assert.equal(tool.params.arguments.source, 'radio');
  assert.equal(tool.params.arguments.songstats_label_id, '8n032k69');
  const previous = calls.length;
  await assert.rejects(oauth.complete(dir, query, 'admin', 'session'));
  assert.equal(calls.length, previous);
});
test('denied access and cancelled consent preserve an existing connection', async () => {
  const old = { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: Date.now() + 3600000 };
  await write('oauth-tokens.json', old);
  let { query } = await start();
  await assert.rejects(oauth.complete(dir, { ...query, error: 'access_denied' }, 'admin', 'session'), /cancelled/);
  ({ query } = await start());
  const calls = [];mockSuccessful(calls);const success = global.fetch;
  global.fetch = async (url, options) => url.endsWith('/mcp') ? json({ secret: 'private-code' }, 403) : success(url, options);
  await assert.rejects(oauth.complete(dir, query, 'admin', 'session'), /HTTP 403/);
  assert.deepEqual(await read('oauth-tokens.json'), old);
  assert.equal((await read('config.json')).enabled, false);
  assert.ok(calls.some(c => c.url.endsWith('/oauth/revoke')));
});
test('refresh rotation is serialized and revoked grants require reconnect', async () => {
  await write('oauth-tokens.json', { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 0 });
  const calls = []; mockSuccessful(calls);
  const result = await Promise.all([oauth.getAccessToken(dir), oauth.getAccessToken(dir), oauth.getAccessToken(dir)]);
  assert.deepEqual(result, ['private-access', 'private-access', 'private-access']);
  assert.equal(calls.length, 1);
  assert.equal((await read('oauth-tokens.json')).refreshToken, 'private-refresh');
  global.fetch = async () => json({ error: 'invalid_grant' }, 400);
  await assert.rejects(oauth.getAccessToken(dir, true), /revoked/);
  assert.equal((await read('oauth-tokens.json')).reconnectRequired, true);
});
test('SSE handles split UTF-8 and CRLF and ignores unrelated notifications', async () => {
  const bytes = new TextEncoder().encode('event: message\r\ndata: {"jsonrpc":"2.0","method":"notice"}\r\n\r\ndata: {"id":7,"result":{"name":"Blå"}}\r\n\r\n');
  const body = new ReadableStream({ start(controller) { for (const b of bytes) controller.enqueue(new Uint8Array([b])); controller.close(); } });
  const result = await oauth.rpc(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), 7);
  assert.equal(result.name, 'Blå');
});
test('rate limiting never automatically retries and honors Retry-After', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { 'retry-after': '7200' } }); };
  await assert.rejects(oauth.createMcpProvider('private-access'), e => e.retryAfter === 7200000);
  assert.equal(calls, 1);
});
test('disconnect removes local tokens, pauses updates and revokes the refresh grant', async () => {
  await write('oauth-tokens.json', { accessToken: 'private-access', refreshToken: 'private-refresh' });
  const calls = [];mockSuccessful(calls);
  await oauth.disconnect(dir);
  await assert.rejects(read('oauth-tokens.json'));
  assert.equal((await read('config.json')).enabled, false);
  assert.equal(calls[0].url, 'https://api.songstats.com/oauth/revoke');
  assert.equal(new URLSearchParams(calls[0].options.body).get('token'), 'private-refresh');
});

test('MCP requests use the protocol version negotiated during initialization', async () => {
  const calls = [];
  mockSuccessful(calls);
  const success = global.fetch;
  global.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === 'initialize') return json({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-11-25', capabilities: {} } });
    assert.equal(options.headers['MCP-Protocol-Version'], '2025-11-25');
    return success(url, options);
  };
  const provider = await oauth.createMcpProvider('private-access');
  await provider('catalog', 100);
  const call = calls.map(c => JSON.parse(c.options.body)).find(c => c.method === 'tools/call');
  assert.equal(call.params.arguments.offset, 100);
  assert.equal(call.params.arguments.source, 'radio');
});
