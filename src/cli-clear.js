#!/usr/bin/env node
/**
 * CLI: Run only the clear phase (no open).
 * Useful for testing. For full chain use: node src/cli-startup.js
 *
 * Usage:
 *   node src/cli-clear.js [--config config.json]
 */

import { WmClient } from 'glazewm';
import { delay, runWithWorkspaceRestore } from './glazeCommon.js';
import { loadConfig } from './startup.js';
import { runClearPhase } from './clearWorkspaces.js';

const CONNECT_DELAY_MS = 1000;

const args = process.argv.slice(2);
let configPath = 'config.json';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' || args[i] === '-c') {
    configPath = args[++i] ?? 'config.json';
    break;
  }
}

async function main() {
  const log = (msg) => console.log(msg);
  const config = await loadConfig(configPath);

  if (!(config?.workspaces?.length > 0)) {
    log('No workspaces defined in config');
    process.exit(0);
  }

  const client = new WmClient();
  client.onConnect(() => log('Connected to GlazeWM'));
  client.onDisconnect(() => log('Disconnected from GlazeWM'));
  client.onError((err) => log(`GlazeWM error: ${err}`));

  await delay(CONNECT_DELAY_MS);
  log('Querying workspaces and windows...');
  await runWithWorkspaceRestore(client, { log }, async (client, _opts) => {
    await runClearPhase(client, config, { log });
  });
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
