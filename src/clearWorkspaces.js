/**
 * GlazeWM Clear Workspaces
 *
 * Closes all windows in each workspace defined in config:
 * close by ID, then for any remaining (e.g. WhatsApp) focus workspace and close, then focus back.
 */

import { delay, getCurrentWorkspace } from './glazeCommon.js';
import { findAllWindows } from './parseWorkspace.js';

export { getCurrentWorkspace };

const CLOSE_DELAY_MS = 500;
const AFTER_FOCUS_DELAY_MS = 500;

/**
 * Focus workspace, close all windows in it, then focus back to original.
 * Used when close-by-ID left some windows (e.g. WhatsApp).
 */
export async function clearWorkspaceWithFocus(client, workspaceName, originalWorkspace, opts = {}) {
  const log = opts.log ?? (() => {});

  log(`Focusing workspace ${workspaceName} and closing remaining windows...`);
  await client.runCommand('focus --workspace ' + workspaceName);
  await delay(AFTER_FOCUS_DELAY_MS);

  const { workspaces } = await client.queryWorkspaces();
  const target = workspaces?.find((w) => w?.name === workspaceName);
  if (!target) {
    log(`Workspace ${workspaceName} not found after focus`);
    return;
  }

  const windows = findAllWindows(target);
  for (const win of windows) {
    const id = win?.id;
    const title = win?.title ?? 'Unknown';
    if (!id) throw new Error(`Window has no ID: ${title}`);
    log(`Closing: ${title} (ID: ${id})`);
    await client.runCommand('close', id);
    await delay(CLOSE_DELAY_MS);
  }

  if (originalWorkspace) {
    log(`Focusing back to workspace ${originalWorkspace}`);
    await client.runCommand('focus --workspace ' + originalWorkspace);
    await delay(300);
  }
}

/**
 * Clear all windows in the given workspace via GlazeWM close command.
 */
export async function clearWorkspace(client, workspaceName, opts = {}) {
  const log = opts.log ?? (() => {});

  log(`Clearing workspace ${workspaceName}`);

  const { workspaces } = await client.queryWorkspaces();
  const target = workspaces?.find((w) => w?.name === workspaceName);

  if (!target) {
    log(`Workspace ${workspaceName} not found`);
    return;
  }

  const allWindows = findAllWindows(target);
  let closed = 0;

  for (const window of allWindows) {
    const id = window?.id;
    const title = window?.title ?? 'Unknown';

    if (!id) {
      throw new Error(`Window has no ID: ${title}`);
    }

    log(`Closing window: ${title} (ID: ${id})`);
    await client.runCommand('close', id);
    await delay(CLOSE_DELAY_MS);
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
  let { windows } = await client.queryWindows();

  log('--- Before clear ---');
  log(`Workspaces: ${workspaces?.length ?? 0}`);
  log(`Total windows: ${windows?.length ?? 0}`);
  for (const name of workspaceNames) {
    const ws = workspaces?.find((w) => w?.name === name);
    const count = ws ? findAllWindows(ws).length : 0;
    log(`  Workspace "${name}": ${count} windows`);
  }

  const originalWorkspace = await getCurrentWorkspace(client);
  log(`Original workspace: ${originalWorkspace ?? '(unknown)'}`);

  for (const name of workspaceNames) {
    await clearWorkspace(client, name, { log });

    ({ workspaces } = await client.queryWorkspaces());
    const ws = workspaces?.find((w) => w?.name === name);
    const remaining = ws ? findAllWindows(ws).length : 0;
    if (remaining > 0) {
      await clearWorkspaceWithFocus(client, name, originalWorkspace, { log });
    }
  }

  // Verify all closed
  ({ workspaces } = await client.queryWorkspaces());
  ({ windows } = await client.queryWindows());
  log('--- After clear ---');
  log(`Workspaces: ${workspaces?.length ?? 0}`);
  log(`Total windows: ${windows?.length ?? 0}`);
  for (const name of workspaceNames) {
    const ws = workspaces?.find((w) => w?.name === name);
    const count = ws ? findAllWindows(ws).length : 0;
    log(`  Workspace "${name}": ${count} windows`);
    if (count > 0) {
      throw new Error(`Workspace "${name}" still has ${count} window(s) after clear`);
    }
  }
  log('All configured workspaces cleared.');
}
