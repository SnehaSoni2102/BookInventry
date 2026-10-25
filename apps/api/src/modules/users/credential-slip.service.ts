import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { createPdf, drawText, pdfToBuffer } from '../../common/pdf/pdf-text.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { qrPng } from '../labels/qr.js';
import { SettingsService } from '../settings/settings.service.js';

interface Pending {
  userId: string;
  username: string;
  displayName: string;
  password: string;
  expires: number;
}

const TTL_MS = 10 * 60_000;

/**
 * The plaintext password exists only in this process's memory for a few minutes, so the admin can print
 * the slip right after creating/resetting an account. Single use; never written to the DB or logs.
 */
@Injectable()
export class CredentialSlipService {
  private readonly pending = new Map<string, Pending>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  issue(p: Omit<Pending, 'expires'>): string {
    for (const [k, v] of this.pending) if (v.expires < Date.now()) this.pending.delete(k);
    const token = randomBytes(24).toString('base64url');
    this.pending.set(token, { ...p, expires: Date.now() + TTL_MS });
    return token;
  }

  async render(userId: string, token: string): Promise<Buffer> {
    const p = this.pending.get(token);
    this.pending.delete(token); // single use, even if the request below fails
    if (!p || p.userId !== userId || p.expires < Date.now()) {
      throw new AppError('NOT_FOUND', 'This slip has expired or was already printed; reset the password to get a new one');
    }
    const org = await this.settings.get<string>('org.name');
    const appUrl = this.env.PUBLIC_APP_URL;
    const doc = createPdf({ margin: 0, info: { Title: 'Login details' } });
    doc.addPage({ size: 'A5', margin: 0 });
    const W = doc.page.width;
    drawText(doc, org, 36, 40, { size: 12, color: '#555555' });
    drawText(doc, 'Your login details', 36, 62, { size: 24, bold: true });
    drawText(doc, p.displayName, 36, 100, { size: 14 });
    drawText(doc, 'Username', 36, 150, { size: 10, color: '#555555' });
    drawText(doc, p.username, 36, 164, { size: 22, bold: true });
    drawText(doc, 'Temporary password', 36, 210, { size: 10, color: '#555555' });
    drawText(doc, p.password, 36, 224, { size: 26, bold: true });
    drawText(doc, 'You will be asked to choose a new password the first time you sign in.', 36, 280, { size: 10 });
    drawText(doc, 'App', 36, 330, { size: 10, color: '#555555' });
    drawText(doc, appUrl, 36, 344, { size: 12, bold: true });
    doc.image(await qrPng(appUrl), W - 36 - 100, 320, { width: 100 });
    drawText(doc, 'Keep this slip private. Hand it over, then destroy it.', 36, doc.page.height - 50, { size: 9, color: '#a00000' });
    return pdfToBuffer(doc);
  }
}
