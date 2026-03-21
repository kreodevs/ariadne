# AriadneSpecs MCP Skill

Skill para que Cursor use correctamente las herramientas del MCP AriadneSpecs Oracle.

## Instalación global (recomendado)

Para que aplique en **cualquier proyecto** (oohbp2, ariadne-ai-scout, etc.) cuando uses el MCP:

```bash
cp -r .cursor/skills/ariadnespecs-mcp ~/.cursor/skills/
```

## Instalación por proyecto

Para que aplique solo en un repo concreto:

```bash
# En la raíz del repo que mantienes (ej. oohbp2)
mkdir -p .cursor/skills
cp -r /ruta/a/Ariadne/.cursor/skills/ariadnespecs-mcp .cursor/skills/
```

## Alternativa: reglas .mdc

Si prefieres reglas en lugar de Skill, copia los `.mdc` de `.cursor/rules/` al repo destino.
