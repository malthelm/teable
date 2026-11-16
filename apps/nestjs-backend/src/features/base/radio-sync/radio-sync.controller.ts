import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ASK_BASE } from '../ask-true-nature/ask-data';

const directory = () => process.env.TRUE_NATURE_RADIO_SYNC_DIR;
async function read(name: string) {
  const dir = directory();
  if (!dir) return {};
  try {
    return JSON.parse(await readFile(join(dir, name), 'utf8'));
  } catch {
    return {};
  }
}
async function save(config: Record<string, unknown>) {
  const dir = directory();
  if (!dir) throw new BadRequestException('Radio sync is not configured on this server.');
  const temporary = join(dir, `config-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
  await rename(temporary, join(dir, 'config.json'));
}
export async function radioSyncStatus() {
  const [config, state] = await Promise.all([read('config.json'), read('status.json')]);
  // Explicit allowlist: credentials and internal responses must never leave the server.
  return {
    connected: Boolean(config.apiKey),
    enabled: Boolean(config.apiKey && config.enabled),
    intervalMinutes: 60,
    running: Boolean(state.running && Date.now() - Date.parse(state.lastAttempt) < 30 * 60000),
    lastAttempt: state.lastAttempt || null,
    lastSuccess: state.lastSuccess || null,
    nextRun: config.apiKey && config.enabled ? state.nextRun || null : null,
    lastError: state.lastError || null,
    addedPlays: state.addedPlays ?? null,
    totalPlays: state.totalPlays ?? null,
    latestPlay: state.latestPlay || null,
    tracksChecked: state.tracksChecked ?? null,
    heartbeat: state.heartbeat || null,
    coverageWarnings: state.coverageWarnings || [],
  };
}
@Controller('api/base/:baseId/radio-sync')
export class RadioSyncController {
  private connecting = false;
  private lastConnect = 0;
  constructor(private readonly cls: ClsService<IClsStore>) {}
  private scope(baseId: string, admin = false) {
    if (baseId !== ASK_BASE) throw new NotFoundException();
    if (
      this.cls.get('accessTokenId') ||
      this.cls.get('baseShare') ||
      this.cls.get('template') ||
      this.cls.get('tempAuthBaseId')
    )
      throw new ForbiddenException();
    if (admin && !this.cls.get('user.isAdmin'))
      throw new ForbiddenException('An administrator must manage this connection.');
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Permissions('base|read')
  async status(@Param('baseId') baseId: string) {
    this.scope(baseId);
    return { ...(await radioSyncStatus()), canManage: Boolean(this.cls.get('user.isAdmin')) };
  }
  @Post('connect')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('base|update')
  async connect(@Param('baseId') baseId: string, @Body() body: { apiKey?: unknown }) {
    this.scope(baseId, true);
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey || apiKey.length > 2048 || /[\r\n]/.test(apiKey))
      throw new BadRequestException('Enter a valid Songstats API key.');
    if (this.connecting || Date.now() - this.lastConnect < 30000)
      throw new BadRequestException('Please wait 30 seconds before trying again.');
    this.connecting = true;
    this.lastConnect = Date.now();
    try {
      // eslint-disable-next-line teable/no-bare-fetch -- Fixed HTTPS origin and path, no user-controlled URL or redirects.
      const response = await fetch(
        'https://api.songstats.com/enterprise/v1/labels/catalog?songstats_label_id=8n032k69&limit=1&offset=0',
        {
          headers: { apikey: apiKey },
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
        }
      );
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (data.result !== 'success' || !Array.isArray(data.catalog)) throw new Error();
      const config = await read('config.json');
      if (!config.teableToken) throw new Error();
      await save({ ...config, apiKey, enabled: true, requestedAt: new Date().toISOString() });
    } catch {
      throw new BadRequestException(
        'Could not verify this connection. Check that the key has access to the True Nature label in Songstats, then try again. The saved connection has not changed.'
      );
    } finally {
      this.connecting = false;
    }
    return { connected: true, enabled: true };
  }
  @Post('refresh')
  @Permissions('base|update')
  async refresh(@Param('baseId') baseId: string) {
    this.scope(baseId, true);
    const config = await read('config.json');
    if (!config.apiKey) throw new BadRequestException('Connect Songstats first.');
    await save({ ...config, enabled: true, requestedAt: new Date().toISOString() });
    return { queued: true };
  }
  @Post('pause')
  @Permissions('base|update')
  async pause(@Param('baseId') baseId: string) {
    this.scope(baseId, true);
    await save({ ...(await read('config.json')), enabled: false });
    return { enabled: false };
  }
}
