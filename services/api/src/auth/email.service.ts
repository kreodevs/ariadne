/**
 * @fileoverview Envío de emails vía SMTP (OTP, etc.).
 */
import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter | null {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) return null;

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    }

    return this.transporter;
  }

  /** Envía OTP por email. Devuelve true si se envió correctamente. */
  async sendOtp(to: string, code: string): Promise<boolean> {
    const trans = this.getTransporter();
    if (!trans) {
      console.warn('[email] SMTP no configurado (SMTP_HOST, SMTP_USER, SMTP_PASS)');
      return false;
    }

    const fromName = process.env.SMTP_FROM || 'Ariadne';
    const fromUser = process.env.SMTP_USER || 'noreply@localhost';

    // iOS domain-bound + magic link
    const rawHost = (process.env.WEB_APP_HOST || process.env.HOST || '').trim().toLowerCase();
    const appHost = rawHost
      ? rawHost.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/^\./, '')
      : null;
    const domainLine = appHost && /^[\w.-]+$/.test(appHost) && !appHost.includes('..')
      ? `@${appHost} #${code}`
      : null;
    const magicLink = domainLine
      ? `https://${appHost}/auth/magic-link?otp=${code}&email=${encodeURIComponent(to)}`
      : null;

    const textLines = [
      code,
      '',
      `Use ${code} as your Ariadne verification code.`,
      '',
      `Your verification code is: ${code}`,
      '',
      `Tu código de acceso es: ${code}. Válido por 5 minutos. Si no lo solicitaste, ignora.`,
    ];
    if (domainLine) textLines.push('', domainLine);
    if (magicLink) textLines.push('', `O toca este enlace: ${magicLink}`);
    const textBody = textLines.join('\n');

    const htmlMagicLink = magicLink
      ? `<a href="${magicLink}" style="display:inline-block;margin:16px 0;padding:14px 28px;background:#059669;color:#fff;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;text-align:center;">👉 Acceder al instante</a>
         <p style="margin:0 0 16px;font-size:13px;color:#64748b;">O ingresa el código manualmente.</p>`
      : '';
    const htmlDomainLine = domainLine
      ? `<p style="margin:12px 0 0;font-size:12px;color:#64748b;word-break:break-all;font-family:ui-monospace,monospace;">${domainLine}</p>`
      : '';

    try {
      await trans.sendMail({
        from: `"${fromName}" <${fromUser}>`,
        to,
        subject: `Ariadne verification code ${code}`,
        text: textBody,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:20px;color:#1e293b;max-width:480px;">
            <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#059669;">Ariadne</p>
            <p style="margin:0 0 8px;">Tu código de acceso:</p>
            <p style="margin:0 0 8px;font-size:28px;font-weight:800;color:#0f172a;">${code}</p>
            <p style="margin:0 0 8px;font-size:15px;color:#475569;">Use <strong>${code}</strong> as your verification code.</p>
            <p style="margin:0 0 16px;font-size:14px;color:#64748b;">Válido por 5 minutos.</p>
            ${htmlMagicLink}
            ${htmlDomainLine}
          </div>
        `,
      });
      return true;
    } catch (err) {
      console.error('[email] Error enviando OTP:', (err as Error)?.message ?? err);
      return false;
    }
  }
}
