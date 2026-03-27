/**
 * @fileoverview POST /shadow: indexa en grafo Falkor por sesión (FalkorSpecsShadow:<shadowSessionId>). Flujo SDD compare.
 */
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ShadowService } from './shadow.service';

/** Expone POST /shadow (namespace shadow en FalkorDB por sesión). */
@Controller()
export class ShadowController {
  constructor(private readonly shadowService: ShadowService) {}

  /**
   * Indexa los archivos enviados en el grafo shadow. Body: { files: [{ path, content }] }.
   * @param {{ files?: { path: string; content: string }[] }} body - Lista de archivos con path y contenido.
   * @returns {Promise<{ ok: boolean; indexed: number; statements: number }>}
   */
  @Post('shadow')
  async index(
    @Body() body: { files?: { path: string; content: string }[]; shadowSessionId?: string },
  ) {
    if (!body?.files || !Array.isArray(body.files)) {
      throw new BadRequestException({ error: 'body.files array required' });
    }
    return this.shadowService.indexShadow(body.files, {
      shadowSessionId: body.shadowSessionId,
    });
  }
}
