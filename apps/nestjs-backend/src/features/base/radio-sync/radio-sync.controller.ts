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
  private retryAt = 0;
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
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Explicit sanitized outcomes for each connection failure stage.
  async connect(@Param('baseId') baseId: string, @Body() body: { apiKey?: unknown }) {
    this.scope(baseId, true);
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey || apiKey.length > 2048 || /[\r\n]/.test(apiKey))
      throw new BadRequestException('Enter a valid Songstats API key.');
    if (this.connecting || Date.now() - this.lastConnect < 30000 || Date.now() < this.retryAt)
      throw new BadRequestException(
        'Please wait before trying again. Songstats rate-limit waiting periods still apply.'
      );
    this.connecting = true;
    this.lastConnect = Date.now();
    let phase = 'server configuration';
    let httpStatus: number | null = null;
    let failure =
      'The server could not read its radio sync configuration. Please contact the workspace administrator.';
    const attemptId = randomUUID();
    try {
      const config = await read('config.json');
      if (!directory() || !config.teableToken) throw new Error();
      phase = 'label access';
      failure = 'The server could not reach Songstats. Please try again later.';
      // eslint-disable-next-line teable/no-bare-fetch -- Fixed HTTPS origin and path, no user-controlled URL or redirects.
      const response = await fetch(
        'https://api.songstats.com/enterprise/v1/labels/catalog?songstats_label_id=8n032k69&source=radio&limit=1&offset=0',
        { headers: { apikey: apiKey }, redirect: 'error', signal: AbortSignal.timeout(20000) }
      );
      httpStatus = response.status;
      if (!response.ok) {
        if (response.status === 401)
          failure =
            'Songstats rejected the key (HTTP 401). Copy the complete current Member API key from Songstats Account Settings → API & MCP.';
        else if (response.status === 403)
          failure =
            'Songstats denied this request (HTTP 403). Check that the current Member API key is enabled and has access to True Nature. This response alone does not distinguish a rejected key from missing access.';
        else if (response.status === 429) {
          const value = response.headers.get('retry-after') || '';
          const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
          this.retryAt = Date.now() + Math.max(60000, Number.isFinite(delay) ? delay : 60000);
          failure = `Songstats has temporarily limited requests (HTTP 429). Try again after ${new Date(this.retryAt).toISOString()}.`;
        } else if (response.status >= 500)
          failure = `Songstats is currently unavailable (HTTP ${response.status}). Please try again later.`;
        else
          failure = `Songstats could not verify label access (HTTP ${response.status}). Please contact the workspace administrator.`;
        throw new Error();
      }
      phase = 'response validation';
      failure =
        'Songstats responded, but its catalog response was not recognized. This may be an integration issue; please contact the workspace administrator.';
      const data = await response.json();
      if (data.result !== 'success' || !Array.isArray(data.catalog)) throw new Error();
      phase = 'credential storage';
      failure =
        'Songstats accepted the key, but Teable could not save the connection. Please contact the workspace administrator.';
      await save({ ...config, apiKey, enabled: true, requestedAt: new Date().toISOString() });
      // Diagnostic metadata is separate from credentials and contains no response bodies.
      await this.recordAttempt({ attemptId, phase: 'connected', httpStatus, success: true });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        failure = 'Songstats did not respond within 20 seconds. Please try again later.';
      await this.recordAttempt({ attemptId, phase, httpStatus, success: false });
      throw new BadRequestException(
        `${failure} The saved connection has not changed. Reference: ${attemptId.slice(0, 8)}.`
      );
    } finally {
      this.connecting = false;
    }
    return { connected: true, enabled: true };
  }
  private async recordAttempt(value: {
    attemptId: string;
    phase: string;
    httpStatus: number | null;
    success: boolean;
  }) {
    const dir = directory();
    if (!dir) return;
    try {
      const temporary = join(dir, `attempt-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify({ ...value, at: new Date().toISOString() }), {
        mode: 0o600,
      });
      await rename(temporary, join(dir, 'connection-attempt.json'));
    } catch {
      /* Diagnostics must not change the result of saving a valid connection. */
    }
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
