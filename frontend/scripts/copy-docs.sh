#!/bin/sh
# Copia docs de ayuda al public para dev y build
cd "$(dirname "$0")/.."
mkdir -p public
cp ../docs/MCP_AYUDA.md public/ayuda-mcp.md 2>/dev/null
cp ../.cursor/skills/falkorspecs-mcp/SKILL.md public/ayuda-skills.md 2>/dev/null
cp ../docs/manual/README.md public/ayuda-manual.md 2>/dev/null
cp ../docs/manual/CONFIGURACION_Y_USO.md public/ayuda-manual-configuracion.md 2>/dev/null
cp ../docs/README.md public/ayuda-manual-indice.md 2>/dev/null
cp ../docs/architecture.md public/ayuda-manual-architecture.md 2>/dev/null
cp ../docs/bitbucket_webhook.md public/ayuda-manual-bitbucket.md 2>/dev/null
cp ../docs/db_schema.md public/ayuda-manual-db-schema.md 2>/dev/null
cp ../docs/indexing_engine.md public/ayuda-manual-indexing.md 2>/dev/null
cp ../docs/ingestion_flow.md public/ayuda-manual-ingestion.md 2>/dev/null
cp ../docs/CHAT_Y_ANALISIS.md public/ayuda-manual-chat.md 2>/dev/null
cp ../docs/INSTALACION_MCP_CURSOR.md public/ayuda-manual-mcp-instalacion.md 2>/dev/null
