/**
 * @fileoverview REST dominios (gobierno C4).
 */
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { DomainsService } from './domains.service';

@Controller('domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  findAll() {
    return this.domains.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.domains.findOne(id);
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      description?: string | null;
      color?: string;
      metadata?: Record<string, unknown> | null;
    },
  ) {
    return this.domains.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      name: string;
      description: string | null;
      color: string;
      metadata: Record<string, unknown> | null;
    }>,
  ) {
    return this.domains.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.domains.remove(id);
    return { ok: true };
  }
}
