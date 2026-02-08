/**
 * GlazeWM Clear Workspaces
 *
 * Closes all windows in each workspace defined in config:
 * close by ID, then for any remaining (e.g. WhatsApp) focus workspace and close, then focus back.
 */

import { delay, getWorkspace } from './glazeCommon.js';
import { findAllWindows } from './parseWorkspace.js';

const CLOSE_DELAY_MS = 300;

/**
 * Clear all windows in the given workspace via GlazeWM close command.
 */
export async function clearWorkspace(client, workspaceName, opts = {}) {
  const log = opts.log ?? (() => {});

  log(`Clearing workspace ${workspaceName}`);

  const target = await getWorkspace(client, workspaceName);
  if (!target) return;

  const allWindows = findAllWindows(target);

  let closed = 0;
  for (const window of allWindows) {
    const id = window?.id;
    const title = window?.title ?? 'Unknown';
    if (!id) throw new Error(`Window has no ID: ${title}`);

    log(`Closing window: ${title} (ID: ${id})`);
    await client.runCommand('close', id);
    closed += 1;
  }

  log(`Closed ${closed} windows from workspace ${workspaceName}`);
}

/**
 * Run the full clear phase: for each workspace in config, close by ID;
 * if any windows remain, focus workspace and close then focus back.
 * Throws if any workspace still has windows after clear.
 *
 * @param {object} client - Connected WmClient
 * @param {object} config - Loaded config (workspaces[].name)
 * @param {{ log: (msg: string) => void }} opts
 */
export async function runClearPhase(client, config, opts = {}) {
  const log = opts.log ?? (() => {});

  const workspaceNames = (config?.workspaces ?? []).map((w) => w?.name).filter(Boolean);
  if (workspaceNames.length === 0) {
    log('No workspaces defined in config');
    return;
  }

  let { workspaces } = await client.queryWorkspaces();
  const workspacesToClear = workspaceNames.filter((name) => workspaces?.some((w) => w?.name === name));

  log('--- Clearing Workspaces ---');

  // TODO - subscribe on workspace instead of delay
  for (const name of workspacesToClear) {
    await clearWorkspace(client, name, { log });
    await delay(CLOSE_DELAY_MS);
    const ws = await getWorkspace(client, name);
    if (ws !== null) throw new Error(`Workspace ${name} still has windows after clearing`);
  }

  log('All configured workspaces cleared.');
}
