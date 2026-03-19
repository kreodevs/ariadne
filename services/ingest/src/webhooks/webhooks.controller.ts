/**
 * @fileoverview Controlador de webhooks: Bitbucket repo:push. Valida firma y delega a WebhooksService.
 */
import { Body, Controller, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { CredentialsService } from '../credentials/credentials.service';
import { RepositoriesService } from '../repositories/repositories.service';
import { WebhooksService } from './webhooks.service';

/**
 * Verifica la firma X-Hub-Signature (sha256=hex) del webhook Bitbucket.
 * @param {string} secret - Webhook secret configurado en Bitbucket.
 * @param {Buffer} rawBody - Cuerpo crudo del request.
 * @param {string | undefined} signatureHeader - Valor del header X-Hub-Signature.
 * @returns {boolean} True si la firma coincide.
 */
function verifyBitbucketSignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  const match = signatureHeader.trim().match(/^sha256=([a-f0-9]+)$/i);
  if (!match) return false;
  const expected = match[1].toLowerCase();
  const hmac = createHmac('sha256', secret);
  hmac.update(rawBody);
  const actual = hmac.digest('hex');
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  } catch {
    return false;
  }
}

/** Endpoints de webhooks: POST /webhooks/bitbucket. */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly credentials: CredentialsService,
    private readonly repos: RepositoriesService,
  ) {}

  /**
   * Recibe webhook de Bitbucket. Valida firma (si hay secret), procesa solo repo:push.
   * @param {Request} req - Request (debe tener rawBody para verificar firma).
   * @param {Record<string, unknown>} payload - Body JSON del webhook.
   * @param {string} [eventKey] - Header X-Event-Key (repo:push).
   * @param {string} [hubSignature] - Header X-Hub-Signature.
   * @returns {Promise<{ received: boolean; skipped?: string }>}
   */
  @Post('bitbucket')
  async bitbucket(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() payload: Record<string, unknown>,
    @Headers('x-event-key') eventKey?: string,
    @Headers('x-hub-signature') hubSignature?: string,
  ) {
    const repoInfo = payload?.repository as { full_name?: string } | undefined;
    const fullName = repoInfo?.full_name ?? '';
    const [workspace, repoSlug] = fullName.split('/');
    const secret =
      workspace && repoSlug
        ? await this.repos.getWebhookSecretForBitbucket(workspace, repoSlug)
        : null;
    const fallbackSecret = secret ?? (await this.credentials.getWebhookSecret('bitbucket'));
    if (fallbackSecret) {
      const raw = req.rawBody;
      if (!raw || !verifyBitbucketSignature(fallbackSecret, raw, hubSignature)) {
        throw new UnauthorizedException('Invalid webhook signature');
      }
    }
    if (eventKey !== 'repo:push') {
      return { received: true, skipped: 'not a push event' };
    }
    await this.webhooks.handleBitbucketPush(payload as any);
    return { received: true };
  }
}
