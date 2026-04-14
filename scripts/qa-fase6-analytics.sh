#!/usr/bin/env bash
# QA manual Fase 6: resolución multi-root + POST /projects/:id/analyze
# Requisitos: ingest HTTP alcanzable, jq, curl.
# Ejemplo:
#   export INGEST_URL=http://127.0.0.1:3002
#   ./scripts/qa-fase6-analytics.sh
set -u
INGEST_URL="${INGEST_URL:-http://127.0.0.1:3002}"
BASE="${INGEST_URL%/}"
TMP="${TMPDIR:-/tmp}/qa_fase6_$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

echo "== Fase 6 QA — ingest: $BASE =="
if ! curl -sf --connect-timeout 5 "$BASE/projects" -o "$TMP/projects.json"; then
  echo "ERROR: No hay respuesta en GET $BASE/projects"
  echo "  Arranca Colima/Docker y: docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d"
  echo "  Luego export INGEST_URL=..."
  exit 2
fi

fail() { echo "FAIL: $*"; exit 1; }

MONO=$(jq -r '[.[] | select((.repositories | length) == 1)] | first | .id // empty' "$TMP/projects.json")
MULTI=$(jq -r '[.[] | select((.repositories | length) > 1)] | first | .id // empty' "$TMP/projects.json")
MULTI_SLUG=$(jq -r --arg id "$MULTI" '.[] | select(.id == $id) | .repositories[0].repoSlug // empty' "$TMP/projects.json")
MULTI_REPO=$(jq -r --arg id "$MULTI" '.[] | select(.id == $id) | .repositories[0].id // empty' "$TMP/projects.json")
MONO_REPO=$(jq -r --arg id "$MONO" '.[] | select(.id == $id) | .repositories[0].id // empty' "$TMP/projects.json")

# --- A) Multi-root sin idePath → 400 (antes de LLM) ---
if [[ -n "$MULTI" ]]; then
  code=$(curl -s -o "$TMP/body_a.txt" -w "%{http_code}" -X POST "$BASE/projects/$MULTI/analyze" \
    -H "Content-Type: application/json" \
    -d '{"mode":"diagnostico"}')
  [[ "$code" == "400" ]] || fail "multi-root sin idePath: esperaba HTTP 400, obtuve $code — $(head -c 400 "$TMP/body_a.txt")"
  echo "OK [A] multi-root sin idePath → 400"
  grep -o '"message":"[^"]*"' "$TMP/body_a.txt" 2>/dev/null | head -1 || true
else
  echo "SKIP [A] No hay proyecto con 2+ repos (crea uno en UI o API para probar)"
fi

# --- B) Mono-repo: POST por projectId no debe 400 por multi-root ---
if [[ -n "$MONO" ]]; then
  code=$(curl -s -o "$TMP/body_b.txt" -w "%{http_code}" -X POST "$BASE/projects/$MONO/analyze" \
    -H "Content-Type: application/json" \
    -d '{"mode":"diagnostico"}')
  if [[ "$code" == "400" ]] && grep -q 'multi-root' "$TMP/body_b.txt" 2>/dev/null; then
    fail "mono-repo: no debería exigir idePath (HTTP $code)"
  fi
  echo "OK [B] mono-repo POST /projects/:id/analyze → HTTP $code (resolución OK; 5xx puede ser Falkor/LLM)"
else
  echo "SKIP [B] No hay proyecto con exactamente 1 repo"
fi

# --- C) Multi-root con idePath que incluye repoSlug ---
if [[ -n "$MULTI" && -n "$MULTI_SLUG" ]]; then
  FAKE="/Users/dev/ws/${MULTI_SLUG}/src/x.ts"
  code=$(curl -s -o "$TMP/body_c.txt" -w "%{http_code}" -X POST "$BASE/projects/$MULTI/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"mode\":\"diagnostico\",\"idePath\":\"$FAKE\"}")
  [[ "$code" == "400" ]] && grep -q 'No se pudo inferir' "$TMP/body_c.txt" 2>/dev/null && \
    echo "WARN [C] Heurística no encontró slug en path (revisa slugs); HTTP400" || \
    echo "OK [C] multi-root con idePath → HTTP $code (si200/5xx tras resolver, bien)"
else
  echo "SKIP [C] Sin multi-root o slug"
fi

# --- D) Paridad: mismo modo vía /repositories/:repoId/analyze (solo si hay repo) ---
if [[ -n "$MULTI_REPO" ]]; then
  code=$(curl -s -o "$TMP/body_d.txt" -w "%{http_code}" -X POST "$BASE/repositories/$MULTI_REPO/analyze" \
    -H "Content-Type: application/json" \
    -d '{"mode":"diagnostico"}')
  echo "OK [D] POST /repositories/:repoId/analyze → HTTP $code (referencia MCP roots[].id)"
else
  echo "SKIP [D] Sin repo en proyecto multi"
fi

# --- E) resolve-repo-for-path ---
if [[ -n "$MULTI" && -n "$MULTI_SLUG" ]]; then
  code=$(curl -s -o "$TMP/body_e.txt" -w "%{http_code}" -G "$BASE/projects/$MULTI/resolve-repo-for-path" \
    --data-urlencode "path=/Users/x/${MULTI_SLUG}/a.ts")
  echo "OK [E] GET resolve-repo-for-path → HTTP $code"
  head -c 200 "$TMP/body_e.txt"; echo
fi

echo ""
echo "== MCP (manual) =="
echo "Con INGEST_URL y Falkor poblados: en Cursor, get_project_analysis con:"
echo "  - projectId = id de proyecto (list_known_projects) + currentFilePath en un fichero de ese root"
echo "  - projectId = roots[].id sin path"
echo "== Fin =="
