/**
 * @fileoverview Controlador para indexar código propuesto en grafo shadow (POST /shadow). Usado por el flujo SDD compare.
 */
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ShadowService } from './shadow.service';

/** Expone POST /shadow para indexar archivos en FalkorSpecsShadow. */
@Controller()
export class ShadowController {
  constructor(private readonly shadowService: ShadowService) {}

  /**
   * Indexa los archivos enviados en el grafo shadow. Body: { files: [{ path, content }] }.
   * @param {{ files?: { path: string; content: string }[] }} body - Lista de archivos con path y contenido.
   * @returns {Promise<{ ok: boolean; indexed: number; statements: number }>}
   */
  @Post('shadow')
  async index(@Body() body: { files?: { path: string; content: string }[] }) {
    if (!body?.files || !Array.isArray(body.files)) {
      throw new BadRequestException({ error: 'body.files array required' });
    }
    return this.shadowService.indexShadow(body.files);
  }
}
