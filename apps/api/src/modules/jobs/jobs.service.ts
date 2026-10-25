import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

export type JobHandler<T = any> = (data: T) => Promise<void>;
export interface JobOptions {
  retryLimit?: number;
  retryBackoff?: boolean;
  retryDelay?: number;
}

interface Registered {
  handler: JobHandler;
  options: JobOptions;
}

/**
 * Thin wrapper over pg-boss. Handlers register themselves at module init in every process; only the
 * worker process calls `startWorker()` to consume. In `memory` mode (tests) jobs queue in-process and
 * run when `drain()` is called.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, Registered>();
  private boss: PgBoss | undefined;
  private starting: Promise<PgBoss> | undefined;
  /** memory mode only */
  readonly pending: Array<{ name: string; data: any }> = [];
  readonly failures: Array<{ name: string; error: unknown }> = [];

  constructor(@Inject(ENV) private readonly env: Env) {}

  register<T>(name: string, handler: JobHandler<T>, options: JobOptions = {}): void {
    this.handlers.set(name, { handler, options });
  }

  private getBoss(): Promise<PgBoss> {
    this.starting ??= (async () => {
      const boss = new PgBoss(this.env.DATABASE_URL);
      boss.on('error', (e: unknown) => this.logger.error(e instanceof Error ? e.message : String(e)));
      await boss.start();
      for (const [name, r] of this.handlers) {
        await boss.createQueue(name, { retryLimit: r.options.retryLimit ?? 3, retryBackoff: r.options.retryBackoff ?? true, retryDelay: r.options.retryDelay ?? 5 });
      }
      this.boss = boss;
      return boss;
    })();
    return this.starting;
  }

  /** Enqueues a job. Never throws: a queue outage must not fail the user's request. */
  async send(name: string, data: object = {}): Promise<void> {
    try {
      if (this.env.JOBS_MODE === 'memory') {
        this.pending.push({ name, data });
        return;
      }
      const boss = await this.getBoss();
      await boss.send(name, data);
    } catch (e) {
      this.logger.error(`Could not enqueue ${name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Worker process: consume every registered queue. */
  async startWorker(): Promise<void> {
    if (this.env.JOBS_MODE === 'memory') return;
    const boss = await this.getBoss();
    for (const [name, r] of this.handlers) {
      await boss.work<any>(name, async (jobs) => {
        for (const job of jobs) await r.handler(job.data);
      });
    }
    this.logger.log(`Worker consuming: ${[...this.handlers.keys()].join(', ')}`);
  }

  async schedule(name: string, cron: string): Promise<void> {
    if (this.env.JOBS_MODE === 'memory') return;
    const boss = await this.getBoss();
    await boss.schedule(name, cron);
  }

  /** memory mode: run everything queued (including jobs queued by handlers) once. */
  async drain(): Promise<void> {
    while (this.pending.length) {
      const job = this.pending.shift()!;
      const r = this.handlers.get(job.name);
      if (!r) continue;
      try {
        await r.handler(job.data);
      } catch (error) {
        this.failures.push({ name: job.name, error });
      }
    }
  }

  async onApplicationShutdown() {
    await this.boss?.stop({ graceful: true, timeout: 5000 }).catch(() => {});
  }
}
