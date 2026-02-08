/**
 * GlazeWM Startup
 *
 * Main chain: clear workspaces -> open applications.
 * Loads config, connects client, runs clear phase then open phase.
 */

import { WmClient } from 'glazewm';
import { readFile } from 'fs/promises';
import { runClearPhase } from './clearWorkspaces.js';
import { runFullscreenPhaseAll, runFullscreenPhase } from './fullscreenWindows.js';
import { delay, runWithWorkspaceRestore } from './glazeCommon.js';
import { runOpenPhase } from './openWorkspaces.js';
import { runLayoutPhase, runVerifyLayout } from './applyLayout.js';

const CONNECT_DELAY_MS = 1000;

/** All phases in default order. */
export const PHASES = ['clear', 'open', 'layout', 'fullscreen'];

/**
 * Load config from path.
 * @param {string} configPath - Path to config.json
 * @returns {Promise<object>} - Config with workspaces[]
 */
export async function loadConfig(configPath) {
  const raw = await readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Run selected phases in order. Loads config, creates client, runs each requested phase.
 *
 * @param {string} configPath - Path to config.json (default: config.json)
 * @param {{ log?: (msg: string) => void, phases?: string[], workspaceName?: string, skipLayout?: boolean }} opts
 *   - phases: list of 'clear' | 'open' | 'layout' | 'fullscreen' (default: all)
 *   - workspaceName: for fullscreen phase only, run fullscreen for this workspace (e.g. "2"); omit for all workspaces
 *   - skipLayout: when layout is run, skip applying layout (only if phases include layout)
 */
export async function startupFromConfig(configPath = 'config.json', opts = {}) {
  const log = opts.log ?? ((msg) => console.log(msg));
  const skipLayout = opts.skipLayout === true;
  const phases = opts.phases?.length ? opts.phases : PHASES;
  const workspaceName = opts.workspaceName;

  const config = await loadConfig(configPath);

  if (!(config?.workspaces?.length > 0)) {
    log('No workspaces defined in config');
    return;
  }

  const client = new WmClient();
  client.onConnect(() => log('Connected to GlazeWM'));
  client.onDisconnect(() => log('Disconnected from GlazeWM'));
  client.onError((err) => log(`GlazeWM error: ${err}`));

  await delay(CONNECT_DELAY_MS);
  log('Querying workspaces and windows...');

  const runOpts = { log, workspaceName };

  await runWithWorkspaceRestore(client, runOpts, async (client, innerOpts) => {
    if (phases.includes('clear')) await runClearPhase(client, config, { log });
    if (phases.includes('open')) await runOpenPhase(client, config, innerOpts);
    if (phases.includes('layout')) {
      await runLayoutPhase(client, config, innerOpts);
      await runVerifyLayout(client, config, { log });
    }
    if (phases.includes('fullscreen')) {
      if (workspaceName != null && workspaceName !== '') {
        await runFullscreenPhase(client, config, { ...innerOpts, workspaceName });
      } else {
        await runFullscreenPhaseAll(client, config, innerOpts);
      }
    }
  });
}
