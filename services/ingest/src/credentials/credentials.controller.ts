/**
 * @fileoverview CRUD de credenciales (Bitbucket/GitHub): list, get, create, update, delete. Filtro opcional por provider.
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CredentialsService } from './credentials.service';

@Controller('credentials')
export class CredentialsController {
  constructor(private readonly service: CredentialsService) {}

  /** GET /credentials?provider= — Lista credenciales (opcional: filtrar por provider). */
  @Get()
  findAll(@Query('provider') provider?: string) {
    return this.service.findAll(provider);
  }

  /** GET /credentials/:id — Una credencial por ID (sin value en respuesta). */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  /** POST /credentials — Crear credencial (provider, kind, value, name?, extra?). */
  @Post()
  create(@Body() dto: import('./dto/create-credential.dto').CreateCredentialDto) {
    return this.service.create(dto);
  }

  /** PATCH /credentials/:id — Actualizar value, name o extra. */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: import('./dto/update-credential.dto').UpdateCredentialDto,
  ) {
    return this.service.update(id, dto);
  }

  /** DELETE /credentials/:id — Elimina credencial. */
  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
  }
}
