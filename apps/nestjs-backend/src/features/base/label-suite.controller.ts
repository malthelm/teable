import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { Permissions } from '../auth/decorators/permissions.decorator';

/** A read-only integration. The database role can SELECT only the scoped projection view. */
@Controller('api/base/:baseId/label-suite')
export class LabelSuiteController implements OnModuleDestroy {
  private pool?: Pool;

  @Get('releases')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('base|read')
  async releases(@Param('baseId') baseId: string) {
    if (!process.env.LABEL_SUITE_BASE_ID || baseId !== process.env.LABEL_SUITE_BASE_ID) {
      throw new NotFoundException();
    }
    if (!process.env.LABEL_SUITE_DATABASE_URL) {
      throw new ServiceUnavailableException('Label Suite is not connected.');
    }
    try {
      this.pool ??= new Pool({
        connectionString: process.env.LABEL_SUITE_DATABASE_URL,
        max: 2,
        connectionTimeoutMillis: 4000,
        idleTimeoutMillis: 30000,
        statement_timeout: 5000,
        options: '-c default_transaction_read_only=on',
      });
      // Prevent idle connection errors from becoming uncaught process errors.
      if (!this.pool.listenerCount('error')) this.pool.on('error', () => undefined);
      const { rows } = await this.pool.query('SELECT payload FROM teable_release_reader.workspace');
      if (rows.length !== 1 || !Array.isArray(rows[0].payload?.releases))
        throw new Error('Invalid projection');
      return {
        ...rows[0].payload,
        refreshedAt: new Date().toISOString(),
        sourceOrigin: process.env.LABEL_SUITE_ORIGIN,
      };
    } catch {
      // Never return connection strings or database errors to clients/logs.
      throw new ServiceUnavailableException(
        'Label Suite could not be refreshed. Please try again.'
      );
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
