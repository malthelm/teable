import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASK_BASE, RADIO_TABLE } from './ask-data';
import { AskTrueNatureController } from './ask.controller';
vi.mock('./codex-provider', () => ({
  codexCredential: vi.fn().mockResolvedValue({}),
  codexTurn: vi.fn(),
}));

describe('Ask True Nature access boundaries', () => {
  const records = { getRecords: vi.fn() };
  const permissions = { validPermissions: vi.fn() };
  const releases = { releases: vi.fn() };
  const cls = { get: vi.fn() };
  let controller: AskTrueNatureController;
  beforeEach(() => {
    vi.clearAllMocks();
    cls.get.mockReset();
    controller = new AskTrueNatureController(
      records as never,
      permissions as never,
      releases as never,
      cls as never
    );
  });
  it('does not expose the adapter in another base or to API tokens', async () => {
    await expect(controller.status('bseOther')).rejects.toThrow();
    cls.get.mockImplementation((key) => (key === 'accessTokenId' ? 'token' : undefined));
    await expect(controller.status(ASK_BASE)).rejects.toThrow();
  });
  it('does not read records when record permission is denied', async () => {
    permissions.validPermissions.mockRejectedValueOnce(new Error('denied'));
    await expect(
      controller['query']('radio_plays', '{}', new AbortController().signal)
    ).rejects.toThrow();
    expect(permissions.validPermissions).toHaveBeenCalledWith(
      RADIO_TABLE,
      ['record|read'],
      undefined
    );
    expect(records.getRecords).not.toHaveBeenCalled();
  });
  it('validates tool arguments and rejects arbitrary tools before data access', async () => {
    await expect(
      controller['query']('radio_plays', '{"sql":"select *"}', new AbortController().signal)
    ).rejects.toThrow();
    await expect(
      controller['query']('delete_records', '{}', new AbortController().signal)
    ).rejects.toThrow();
    expect(records.getRecords).not.toHaveBeenCalled();
    expect(releases.releases).not.toHaveBeenCalled();
  });
  it('checks base access again before fetching live release data', async () => {
    permissions.validPermissions.mockRejectedValueOnce(new Error('denied'));
    await expect(
      controller['query']('release_readiness', '{}', new AbortController().signal)
    ).rejects.toThrow();
    expect(releases.releases).not.toHaveBeenCalled();
  });
  it('honors a cancelled radio read before querying records', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(controller['query']('radio_plays', '{}', abort.signal)).rejects.toThrow();
    expect(records.getRecords).not.toHaveBeenCalled();
  });
});
