#!/usr/bin/env node
/**
 * CLI: Run only the fullscreen (F11) phase for one workspace.
 * Matches windows to config by index and fullscreens those with fullscreen: true.
 *
 * Usage:
 *   npm run fullscreen 2
 *   node src/cli-fullscreen.js 2 [--config config.json]
 *
 * Requires: GlazeWM running, workspace name (e.g. 2), config.json (or path via --config).
 */

import { WmClient } from 'glazewm';
import { delay, runWithWorkspaceRestore } from './glazeCommon.js';
import { runFullscreenPhase } from './fullscreenWindows.js';
import { loadConfig } from './startup.js';

const CONNECT_DELAY_MS = 1000;

const args = process.argv.slice(2);
let configPath = 'config.json';
let workspaceName = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' || args[i] === '-c') {
    configPath = args[++i] ?? 'config.json';
  } else if (workspaceName === null) {
    workspaceName = String(args[i]);
  }
}

async function main() {
  if (workspaceName == null || workspaceName === '') {
    console.error('Usage: npm run fullscreen <workspace>   e.g. npm run fullscreen 2');
    process.exit(1);
  }
  const log = (msg) => console.log(msg);
  const config = await loadConfig(configPath);

  const client = new WmClient();
  client.onConnect(() => log('Connected to GlazeWM'));
  client.onDisconnect(() => log('Disconnected from GlazeWM'));
  client.onError((err) => log(`GlazeWM error: ${err}`));

  await delay(CONNECT_DELAY_MS);
  await runWithWorkspaceRestore(client, { log, workspaceName }, async (client, opts) => {
    await runFullscreenPhase(client, config, opts);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
