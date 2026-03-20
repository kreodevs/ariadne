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
  ): Promise<{ valid: boolean; token?: string }> {
    const email = body?.email;
    const code = body?.code;
    if (!email || typeof email !== 'string' || !code || typeof code !== 'string') {
      return { valid: false };
    }
    return this.authService.verifyOtp(email, code);
  }
}
