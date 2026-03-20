/**
 * @fileoverview Servicio OTP: generar código, enviar por email (SMTP) y emitir JWT.
 */
import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EmailService } from './email.service';

const OTP_TTL_SEC = 300; // 5 min
const OTP_LENGTH = 6;
const JWT_SECRET = process.env.JWT_SECRET || 'ariadne-dev-secret-change-in-prod';
// 7 días en segundos (JWT_EXPIRES: segundos, ej. 604800)
const JWT_EXPIRES_SEC = parseInt(process.env.JWT_EXPIRES ?? '604800', 10) || 604800;

/** Whitelist opcional: si EMAIL_OTP está definido, solo ese email puede solicitar OTP. */
const EMAIL_OTP_WHITELIST = process.env.EMAIL_OTP?.trim().toLowerCase() || null;

/** Store en memoria. key = email, value = { code, expiresAt } */
const memoryStore = new Map<string, { code: string; expiresAt: number }>();

export interface OtpRequestResult {
  sent: boolean;
  /** Solo en OTP_DEV_MODE: código para testing (cuando SMTP falla o no está configurado) */
  devCode?: string;
}

export interface VerifyResult {
  valid: boolean;
  token?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly emailService: EmailService) {}

  /** Genera OTP, lo envía por email (SMTP) y lo almacena. */
  async requestOtp(email: string): Promise<OtpRequestResult> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new Error('Email requerido');
    }

    if (EMAIL_OTP_WHITELIST && normalized !== EMAIL_OTP_WHITELIST) {
      throw new Error('Email no autorizado para solicitar OTP');
    }

    const code = Array.from({ length: OTP_LENGTH }, () =>
      Math.floor(Math.random() * 10),
    ).join('');
    const expiresAt = Date.now() + OTP_TTL_SEC * 1000;

    memoryStore.set(normalized, { code, expiresAt });

    const devMode = process.env.OTP_DEV_MODE === 'true';
    const emailSent = await this.emailService.sendOtp(normalized, code);

    if (!emailSent && !devMode) {
      throw new Error('No se pudo enviar el email. Comprueba la configuración SMTP.');
    }

    return {
      sent: true,
      ...(devMode && { devCode: code }),
    };
  }

  /** Valida OTP y devuelve JWT si es correcto. */
  async verifyOtp(email: string, code: string): Promise<VerifyResult> {
    const normalized = email.trim().toLowerCase();
    const stored = memoryStore.get(normalized);
    if (!stored) {
      return { valid: false };
    }
    if (Date.now() > stored.expiresAt) {
      memoryStore.delete(normalized);
      return { valid: false };
    }
    if (stored.code !== code.trim()) {
      return { valid: false };
    }

    memoryStore.delete(normalized);

    const token = jwt.sign(
      { sub: normalized, email: normalized },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_SEC },
    );

    return { valid: true, token };
  }

  /** Verifica JWT y devuelve payload o null. */
  verifyToken(token: string): { sub: string; email?: string } | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        sub?: string;
        email?: string;
      };
      if (decoded?.sub) {
        return { sub: decoded.sub, email: decoded.email };
      }
      return null;
    } catch {
      return null;
    }
  }
}
