/**
 * @fileoverview Controller de autenticación OTP: request y verify.
 */
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() body: { email?: string }) {
    const email = body?.email;
    if (!email || typeof email !== 'string') {
      throw new BadRequestException('email es requerido');
    }
    return this.authService.requestOtp(email);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() body: { email?: string; code?: string },
  ): Promise<{ valid: boolean; token?: string; user?: { id: string; email: string; role: string; name: string | null } }> {
    const email = body?.email;
    const code = body?.code;
    if (!email || typeof email !== 'string' || !code || typeof code !== 'string') {
      return { valid: false };
    }
    const result = await this.authService.verifyOtp(email, code);
    return {
      valid: result.valid,
      token: result.token,
      user: result.user,
    };
  }

  /**
   * POST /auth/sso/login
   * Login mediante SSO externo. El SSO debe proporcionar un token que la API valida
   * contra SSO_URL/verify. El SSO_URL debe devolver { email, role, name }.
   * Solo disponible si SSO_URL está configurada.
   */
  @Post('sso/login')
  @HttpCode(HttpStatus.OK)
  async ssoLogin(@Body() body: { token?: string }): Promise<{
    valid: boolean;
    token?: string;
    user?: { id: string; email: string; role: string; name: string | null };
    ssoUrl?: string;
  }> {
    const ssoUrl = process.env.SSO_URL?.trim();
    if (!ssoUrl) {
      return { valid: false };
    }
    if (!body?.token || typeof body.token !== 'string') {
      return { valid: false };
    }
    return this.authService.ssoLogin(body.token, ssoUrl);
  }
}
