/** Fixed-origin Songstats OAuth and read-only MCP transport. No credentials leave this module. */
const { randomBytes, createHash } = require('node:crypto');
const { readFile, writeFile, rename, unlink, mkdir, rmdir, stat } = require('node:fs/promises');
const { join } = require('node:path');
const ORIGIN = 'https://api.songstats.com';
const RESOURCE = `${ORIGIN}/mcp`;
const CALLBACK = 'https://tables.truenature.online/api/base/bsewefS0g8rtQDeFtbt/radio-sync/oauth/callback';
const LABEL = '8n032k69';
const hash = value => createHash('sha256').update(value).digest('hex');
class OAuthError extends Error {
  constructor(message, retryAfter = 3600000) { super(message); this.retryAfter = retryAfter; }
}
async function read(dir, name) {
  try { return JSON.parse(await readFile(join(dir, name), 'utf8')); }
  catch(e) { if (e.code === 'ENOENT') return null; throw new OAuthError('The saved Songstats connection needs attention.'); }
}
async function save(dir, name, value) {
  const tmp = join(dir, `${name}.${randomBytes(12).toString('hex')}.tmp`);
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  await rename(tmp, join(dir, name));
}
async function locked(dir, work) {
  const lock = join(dir, 'oauth-token.lock');
  for (let i = 0; i < 100; i++) {
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch(e) {
      if (e.code !== 'EEXIST') throw new OAuthError('The connection could not be saved.');
      const info = await stat(lock).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 180000) await rmdir(lock).catch(() => {});
      if (i === 99) throw new OAuthError('A connection update is in progress. Please try again shortly.');
      await new Promise(r => setTimeout(r, 300));
    }
  }
  try { return await work(); } finally { await rmdir(lock); }
}
async function http(url, options) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) }); }
  catch { throw new OAuthError('Songstats could not be reached. Please try again later.'); }
  if (response.status === 429) {
    const value = response.headers.get('retry-after') || '';
    const wait = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
    throw new OAuthError('Songstats has temporarily limited requests. The waiting period will be respected.', Math.max(3600000, Number.isFinite(wait) ? wait : 3600000));
  }
  return response;
}
function tokens(data, previous) {
  const lifetime = Number(data.expires_in);
  if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(lifetime) || lifetime <= 0 || String(data.token_type).toLowerCase() !== 'bearer') throw new OAuthError('Songstats returned an incomplete authorization. Please reconnect.');
  const refreshToken = data.refresh_token || previous?.refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) throw new OAuthError('Songstats did not grant background access. Please reconnect.');
  return { accessToken: data.access_token, refreshToken, expiresAt: Date.now() + lifetime * 1000, connectedAt: previous?.connectedAt || new Date().toISOString(), reconnectRequired: false };
}
async function exchange(body) {
  const response = await http(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status >= 500) throw new OAuthError('Songstats is temporarily unavailable. The saved authorization is retained.');
    const error = new OAuthError('Songstats authorization expired or was revoked. Please reconnect with Songstats.');
    error.invalidGrant = response.status === 400 && data.error === 'invalid_grant';
    throw error;
  }
  return data;
}
async function begin(dir, userId, sessionId) {
  const client = await read(dir, 'oauth-client.json');
  if (!client?.client_id) throw new OAuthError('Songstats sign-in is not configured on this server.');
  const state = randomBytes(32).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  await save(dir, `oauth-pending-${hash(state)}.json`, { userId, session: hash(sessionId), verifier, expiresAt: Date.now() + 10 * 60000 });
  const url = new URL(`${ORIGIN}/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: CALLBACK, response_type: 'code', scope: 'mcp:read enterprise:read', resource: RESOURCE, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return url.href;
}
async function complete(dir, query, userId, sessionId) {
  if (typeof query.state !== 'string' || !/^[a-f0-9]{64}$/.test(query.state)) throw new OAuthError('The sign-in request is invalid. Please start again from Teable.');
  const filename = `oauth-pending-${hash(query.state)}.json`;
  const pending = await read(dir, filename);
  if (!pending || pending.expiresAt < Date.now() || pending.userId !== userId || pending.session !== hash(sessionId) || (query.iss && query.iss !== ORIGIN)) throw new OAuthError('The sign-in request expired or belongs to another session. Please start again from Teable.');
  // Atomic consume: only one concurrent callback can redeem this state.
  const consumed = join(dir, `${filename}.consumed-${randomBytes(8).toString('hex')}`);
  try { await rename(join(dir, filename), consumed); } catch { throw new OAuthError('This sign-in request has already been used.'); }
  await unlink(consumed);
  if (query.error || typeof query.code !== 'string' || !query.code || query.code.length > 4096) throw new OAuthError('Songstats sign-in was cancelled. Your saved connection has not changed.');
  const client = await read(dir, 'oauth-client.json');
  const value = tokens(await exchange({ grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: CALLBACK, code: query.code, code_verifier: pending.verifier, resource: RESOURCE }));
  try {
    const provider = await createMcpProvider(value.accessToken);
    try { await provider('catalog', 0, 1); } finally { await provider.close().catch(() => {}); }
    await locked(dir, async () => {
      const previous = await read(dir, 'oauth-tokens.json');
      const config = await read(dir, 'config.json');
      if (!config?.teableToken) throw new OAuthError('The radio worker is not configured.');
      await save(dir, 'oauth-tokens.json', value);
      try { await save(dir, 'config.json', { ...config, connectionType: 'oauth', enabled: true, requestedAt: new Date().toISOString() }); }
      catch(e) { if (previous) await save(dir, 'oauth-tokens.json', previous); else await unlink(join(dir, 'oauth-tokens.json')); throw e; }
    });
  } catch (error) {
    await revoke(client.client_id, value.refreshToken).catch(() => {});
    throw error;
  }
  return true;
}
async function getAccessToken(dir, force = false, previousToken) {
  return locked(dir, async () => {
    const current = await read(dir, 'oauth-tokens.json');
    if (!current || current.reconnectRequired) throw new OAuthError('Reconnect with Songstats to resume automatic updates.');
    if ((!force || (previousToken && previousToken !== current.accessToken)) && current.expiresAt > Date.now() + 60000) return current.accessToken;
    const client = await read(dir, 'oauth-client.json');
    try {
      const next = tokens(await exchange({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: current.refreshToken, resource: RESOURCE }), current);
      await save(dir, 'oauth-tokens.json', next);
      return next.accessToken;
    } catch(e) {
      if (e.invalidGrant) await save(dir, 'oauth-tokens.json', { ...current, reconnectRequired: true });
      throw e;
    }
  });
}
async function rpc(response, id) {
  if (!response.ok) {
    const error = new OAuthError(response.status === 401 ? 'Songstats sign-in needs to be refreshed.' : `Songstats could not provide radio access (HTTP ${response.status}). Check the selected Songstats account and its True Nature radio access.`);
    error.status = response.status;
    throw error;
  }
  const type = response.headers.get('content-type') || '';
  let value;
  if (type.includes('application/json')) value = await response.json();
  else if (type.includes('text/event-stream')) {
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replaceAll('\r\n', '\n');
        if (buffer.length > 16 * 1024 * 1024) throw new OAuthError('Songstats returned too much data.');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const text = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
          if (!text) continue;
          const parsed = JSON.parse(text);
          if (parsed.id === id) { value = parsed; break; }
        }
        if (value) break;
      }
    } finally { await reader.cancel().catch(() => {}); }
  }
  if (!value || value.id !== id || value.error || !value.result) throw new OAuthError('Songstats returned an incomplete MCP response.');
  return value.result;
}
async function createMcpProvider(accessToken) {
  let session, sequence = 0, protocolVersion = '2025-06-18';
  const headers = () => ({ Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': protocolVersion, ...(session ? { 'Mcp-Session-Id': session } : {}) });
  const call = async (method, params) => {
    const id = ++sequence;
    const response = await http(RESOURCE, { method: 'POST', headers: headers(), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const result = await rpc(response, id);
    if (method === 'initialize') {
      session = response.headers.get('mcp-session-id');
      if (!['2025-03-26', '2025-06-18', '2025-11-25'].includes(result.protocolVersion)) throw new OAuthError('Songstats requires an unsupported MCP version.');
      protocolVersion = result.protocolVersion;
    }
    return result;
  };
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'true-nature-tables', version: '1.0.0' } });
  const notification = await http(RESOURCE, { method: 'POST', headers: headers(), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  await notification.body?.cancel();
  if (!notification.ok) throw new OAuthError('Songstats could not initialize the connection.');
  const provider = async (id, offset, limit = 100) => {
    const result = await call('tools/call', { name: id === 'catalog' ? 'get_labels_catalog' : 'get_tracks_stats', arguments: { songstats_label_id: LABEL, source: 'radio', limit, offset, ...(id !== 'catalog' ? { songstats_track_id: id, with_stations: true, with_radio_plays: true } : {}) } });
    let data = result.structuredContent;
    if (!data) {
      try { data = JSON.parse(result.content?.find(item => item.type === 'text')?.text || '{}'); }
      catch { throw new OAuthError('Songstats returned an unreadable radio response.'); }
    }
    if (result.isError || data.error) {
      const seconds = Number(data.error?.retry_after ?? data.retry_after);
      throw new OAuthError('Songstats could not provide the requested radio data. Check the selected account, subscription and usage allowance.', Number.isFinite(seconds) && seconds > 0 ? Math.max(3600000, seconds * 1000) : 3600000);
    }
    const body = data.response || data;
    if (body.result !== 'success' || (id === 'catalog' && !Array.isArray(body.catalog))) throw new OAuthError('Songstats did not confirm access to the True Nature catalog.');
    return body;
  };
  provider.close = async () => {
    if (session) { const r = await http(RESOURCE, { method: 'DELETE', headers: headers() }); await r.body?.cancel(); }
  };
  return provider;
}
async function createProvider(dir) {
  let token = await getAccessToken(dir);
  let provider;
  try { provider = await createMcpProvider(token); }
  catch(e) { if (e.status !== 401) throw e; token = await getAccessToken(dir, true, token); provider = await createMcpProvider(token); }
  return provider;
}
async function revoke(clientId, token) {
  const r = await http(`${ORIGIN}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, token, token_type_hint: 'refresh_token' }) });
  if (!r.ok) throw new OAuthError('Disconnect this app in Songstats Account Settings to finish revoking access.');
  await r.body?.cancel();
}
async function disconnect(dir) {
  return locked(dir, async () => {
    const current = await read(dir, 'oauth-tokens.json'); const client = await read(dir, 'oauth-client.json');
    const config = await read(dir, 'config.json');
    await save(dir, 'config.json', { ...config, enabled: false, connectionType: 'oauth' });
    await unlink(join(dir, 'oauth-tokens.json')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (current?.refreshToken) await revoke(client.client_id, current.refreshToken);
  });
}
const errorMessage = error => error instanceof OAuthError ? error.message : 'Songstats sign-in could not be completed. Please try again from Teable.';
module.exports = { errorMessage, begin, complete, createProvider, createMcpProvider, getAccessToken, disconnect, OAuthError, tokens, rpc };
