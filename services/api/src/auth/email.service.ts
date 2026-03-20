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

    try {
      await trans.sendMail({
        from: `"${fromName}" <${fromUser}>`,
        to,
        subject: 'Tu código de acceso Ariadne',
        text: `Tu código de acceso es: ${code}\n\nVálido por 5 minutos.\n\nSi no solicitaste este código, ignora este correo.`,
        html: `
          <p>Tu código de acceso es: <strong style="font-size:1.5em;letter-spacing:0.2em;">${code}</strong></p>
          <p>Válido por 5 minutos.</p>
          <p style="color:#666;font-size:0.9em;">Si no solicitaste este código, ignora este correo.</p>
        `,
      });
      return true;
    } catch (err) {
      console.error('[email] Error enviando OTP:', (err as Error)?.message ?? err);
      return false;
    }
  }
}
