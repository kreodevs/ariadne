/**
 * @fileoverview Controller raíz: openapi.json, health.
 */
import { Controller, Get } from '@nestjs/common';
import { openApiSpec } from './openapi';

/** Controller raíz: OpenAPI spec y health check. */
@Controller()
export class AppController {
  @Get('openapi.json')
  openApi() {
    return openApiSpec;
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
