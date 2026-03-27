/**
 * @fileoverview Expone métricas Prometheus en GET /metrics.
 */
import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { getMetricsText, isMetricsDisabled } from './ingest-metrics';

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    if (isMetricsDisabled()) {
      throw new ServiceUnavailableException('Métricas desactivadas (METRICS_ENABLED=0).');
    }
    return getMetricsText();
  }
}
