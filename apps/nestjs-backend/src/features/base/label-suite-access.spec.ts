import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), options: undefined as unknown }));
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      mock.options = options;
    }
    query = mock.query;
    end = mock.end;
    listenerCount = () => 1;
  },
}));
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { LabelSuiteController } from './label-suite.controller';

describe('read-only Label Suite connector', () => {
  beforeEach(() => {
    vi.stubEnv('LABEL_SUITE_BASE_ID', 'permitted-base');
    vi.stubEnv('LABEL_SUITE_DATABASE_URL', 'postgres://fixture');
    vi.stubEnv('LABEL_SUITE_ORIGIN', 'https://suite.example');
    mock.query.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());
  it('requires native base read permission and refuses a different base before querying', async () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LabelSuiteController.prototype.releases)).toEqual([
      'base|read',
    ]);
    await expect(new LabelSuiteController().releases('other-base')).rejects.toMatchObject({
      status: 404,
    });
    expect(mock.query).not.toHaveBeenCalled();
  });
  it('uses a bounded read-only pool and returns the complete source projection', async () => {
    mock.query.mockResolvedValue({
      rows: [{ payload: { releases: [{ id: 'r' }], tracks: [], campaigns: [], milestones: [] } }],
    });
    const result = await new LabelSuiteController().releases('permitted-base');
    expect(result.releases).toEqual([{ id: 'r' }]);
    expect(mock.options).toMatchObject({
      max: 2,
      statement_timeout: 5000,
      options: '-c default_transaction_read_only=on',
    });
    expect(mock.query).toHaveBeenCalledWith('SELECT payload FROM teable_release_reader.workspace');
  });
  it('fails closed and does not expose database connection errors', async () => {
    mock.query.mockRejectedValue(new Error('postgres://sensitive-connection'));
    await expect(new LabelSuiteController().releases('permitted-base')).rejects.toMatchObject({
      status: 503,
      message: 'Label Suite could not be refreshed. Please try again.',
    });
  });
});
