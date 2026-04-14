#!/usr/bin/env node
/**
 * Agrega líneas de log JSON con event=chat_unified_pipeline (p. ej. volcado de ingest con CHAT_TELEMETRY_LOG).
 *
 * Uso:
 *   node scripts/aggregate-chat-telemetry.mjs [archivo.log]
 *   pnpm metrics:chat-telemetry -- ingest.log
 *
 * Sin argumento: lee stdin.
 */
import fs from 'node:fs';
import readline from 'node:readline';

const file = process.argv[2];
const input = file ? fs.createReadStream(file, { encoding: 'utf8' }) : process.stdin;

let total = 0;
let sumRatio = 0;
let ratioCount = 0;
let preflightOn = 0;
let inferredScope = 0;
let projectScopeOn = 0;

const rl = readline.createInterface({ input, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return;
  let o;
  try {
    o = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (o.event !== 'chat_unified_pipeline') return;
  total += 1;
  if (typeof o.pathGroundingRatio === 'number') {
    sumRatio += o.pathGroundingRatio;
    ratioCount += 1;
  }
  const eff = o.chat_scope_effective;
  if (eff?.preflightPathRepoApplied) preflightOn += 1;
  if (eff?.inferred) inferredScope += 1;
  if (eff?.projectScope) projectScopeOn += 1;
});

rl.on('close', () => {
  const avgRatio = ratioCount ? (sumRatio / ratioCount).toFixed(4) : 'n/a';
  console.log(
    JSON.stringify(
      {
        chat_unified_pipeline_events: total,
        avg_pathGroundingRatio: avgRatio,
        preflightPathRepoApplied_count: preflightOn,
        scopeInferred_count: inferredScope,
        projectScope_count: projectScopeOn,
      },
      null,
      2,
    ),
  );
});
