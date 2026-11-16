import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASK_BASE } from '../ask-true-nature/ask-data';
import { RadioSyncController, radioSyncStatus } from './radio-sync.controller';

describe('Songstats connection boundaries', () => {
  let dir: string;
  const cls = { get: vi.fn() };
  let controller: RadioSyncController;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'radio-sync-'));
    vi.stubEnv('TRUE_NATURE_RADIO_SYNC_DIR', dir);
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ apiKey: 'saved-test-key', teableToken: 'private-test-token', enabled: true })
    );
    cls.get.mockReset();
    controller = new RadioSyncController(cls as never);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true });
  });
  it('never returns saved credentials', async () => {
    const result = JSON.stringify(await radioSyncStatus());
    expect(result).not.toContain('saved-test-key');
    expect(result).not.toContain('private-test-token');
  });
  it('denies wrong base, API token access and non-admin mutation', async () => {
    await expect(controller.status('bseOther')).rejects.toThrow();
    await expect(controller.connect(ASK_BASE, { apiKey: 'new-key' })).rejects.toThrow();
    cls.get.mockImplementation((k) => (k === 'accessTokenId' ? 'token' : true));
    await expect(controller.status(ASK_BASE)).rejects.toThrow();
  });
  it('retains the old connection and hides provider errors on failed verification', async () => {
    cls.get.mockImplementation((k) => k === 'user.isAdmin');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(controller.connect(ASK_BASE, { apiKey: 'bad-test-key' })).rejects.toThrow(
      'saved connection has not changed'
    );
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).apiKey).toBe(
      'saved-test-key'
    );
  });
  it('validates fixed label access before storing a replacement and queues an update', async () => {
    cls.get.mockImplementation((k) => k === 'user.isAdmin');
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ result: 'success', catalog: [] }) });
    vi.stubGlobal('fetch', fetcher);
    await controller.connect(ASK_BASE, { apiKey: 'new-test-key' });
    expect(fetcher.mock.calls[0][0]).toContain('songstats_label_id=8n032k69');
    const stored = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(stored.apiKey).toBe('new-test-key');
    expect(stored.enabled).toBe(true);
    expect(stored.requestedAt).toBeTruthy();
  });
});
