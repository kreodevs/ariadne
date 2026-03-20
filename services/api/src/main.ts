/**
 * @fileoverview Entry point del API NestJS. Proxy a ingest, OpenAPI, CORS, auth OTP.
 */
import { NestFactory } from '@nestjs/core';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { createOtpAuthMiddleware } from './auth/otp.middleware';

/** Inicia el servidor, configura CORS, prefijo /api, auth OTP y proxy a ingest. */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  const authService = app.get(AuthService);
  app.use(createOtpAuthMiddleware(authService));

  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });

  // Proxy /api/projects, /api/repositories, /api/credentials, /api/webhooks al ingest (quita /api al reenviar)
  const ingestUrl = process.env.INGEST_URL ?? 'http://localhost:3002';
  const ingestProxy = createProxyMiddleware({
    pathFilter: (pathname) =>
      pathname.startsWith('/api/projects') ||
      pathname.startsWith('/api/repositories') ||
      pathname.startsWith('/api/credentials') ||
      pathname.startsWith('/api/providers') ||
      pathname.startsWith('/api/webhooks'),
    target: ingestUrl,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
  });
  app.use(ingestProxy);

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`FalkorSpecs API (NestJS + OpenAPI 3.1) listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
