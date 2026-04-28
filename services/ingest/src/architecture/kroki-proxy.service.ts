/**
 * @fileoverview Proxy servidor → Kroki (PlantUML→SVG). Evita CORS/NetworkError del navegador.
 * URL base configurable con KROKI_URL (default https://kroki.io; self-hosted si aplica).
 */
import { BadGatewayException, Injectable, PayloadTooLargeException } from '@nestjs/common';

const DEFAULT_KROKI = 'https://kroki.io';
/** Límite defensivo del DSL enviado al render (Kroki también tiene límites). */
const MAX_DSL_CHARS = 2 * 1024 * 1024;

@Injectable()
export class KrokiProxyService {
  private baseUrl(): string {
    const raw = process.env.KROKI_URL?.trim() || DEFAULT_KROKI;
    return raw.replace(/\/$/, '');
  }

  /**
   * POST text/plain PlantUML a Kroki; devuelve SVG como buffer UTF-8.
   */
  async renderPlantumlSvg(dsl: string): Promise<Buffer> {
    if (dsl.length > MAX_DSL_CHARS) {
      throw new PayloadTooLargeException(`DSL supera el límite de ${MAX_DSL_CHARS} caracteres`);
    }
    const url = `${this.baseUrl()}/plantuml/svg`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: dsl,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadGatewayException(`No se pudo contactar con Kroki (${msg})`);
    }
    if (!res.ok) {
      const hint = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Kroki respondió ${res.status}${hint ? `: ${hint.slice(0, 400)}` : ''}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
