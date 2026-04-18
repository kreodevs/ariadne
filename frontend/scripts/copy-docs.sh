#!/bin/sh
# Copia docs de ayuda al public para dev y build (rutas canónicas bajo docs/notebooklm/ cuando aplica).
cd "$(dirname "$0")/.."
mkdir -p public
cp ../docs/notebooklm/MCP_AYUDA.md public/ayuda-mcp.md 2>/dev/null
cp ../.cursor/skills/ariadnespecs-mcp/SKILL.md public/ayuda-skills.md 2>/dev/null
cp ../docs/manual/README.md public/ayuda-manual.md 2>/dev/null
cp ../docs/manual/CONFIGURACION_Y_USO.md public/ayuda-manual-configuracion.md 2>/dev/null
cp ../docs/README.md public/ayuda-manual-indice.md 2>/dev/null
cp ../docs/notebooklm/architecture.md public/ayuda-manual-architecture.md 2>/dev/null
cp ../docs/notebooklm/bitbucket_webhook.md public/ayuda-manual-bitbucket.md 2>/dev/null
cp ../docs/notebooklm/db_schema.md public/ayuda-manual-db-schema.md 2>/dev/null
cp ../docs/notebooklm/indexing_engine.md public/ayuda-manual-indexing.md 2>/dev/null
cp ../docs/notebooklm/ingestion_flow.md public/ayuda-manual-ingestion.md 2>/dev/null
cp ../docs/notebooklm/CHAT_Y_ANALISIS.md public/ayuda-manual-chat.md 2>/dev/null
cp ../docs/notebooklm/INSTALACION_MCP_CURSOR.md public/ayuda-manual-mcp-instalacion.md 2>/dev/null
cp ../docs/notebooklm/mcp_server_specs.md public/mcp_server_specs.md 2>/dev/null
