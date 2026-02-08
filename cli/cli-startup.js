#!/usr/bin/env node
/**
 * CLI: Run GlazeWM startup phases (clear, open, layout, fullscreen).
 * With no phases: runs all. With phases: runs only those in order.
 *
 * Usage:
 *   node cli/cli-startup.js                    # all phases
 *   node cli/cli-startup.js clear              # clear only
 *   node cli/cli-startup.js fullscreen 2       # fullscreen workspace 2 only
 *   node cli/cli-startup.js clear open         # clear then open
 *   node cli/cli-startup.js [phases...] [--config path]
 *
 * Requires: GlazeWM running, config.json (or path via --config).
 */

import { PHASES, startupFromConfig } from '../src/startup.js';

const args = process.argv.slice(2);
let configPath = 'config.json';
const positionals = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--config' || a === '-c') {
    configPath = args[++i] ?? 'config.json';
  } else if (!a.startsWith('-')) {
    positionals.push(a);
  }
}

const validPhases = new Set(PHASES);
const phases = positionals.filter((p) => validPhases.has(p));
let workspaceName = null;
if (phases.includes('fullscreen') && positionals.length > phases.length) {
  const idx = positionals.indexOf('fullscreen');
  const next = positionals[idx + 1];
  if (next != null && !validPhases.has(next)) workspaceName = next;
}

startupFromConfig(configPath, {
  phases: phases.length ? phases : undefined,
  workspaceName,
}).catch((err) => {
  const msg = typeof err === 'string' ? err : err?.message ?? String(err);
  console.error(msg);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
