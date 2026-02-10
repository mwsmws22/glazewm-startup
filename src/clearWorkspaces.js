/**
 * GlazeWM Clear Workspaces
 *
 * Closes all windows in each workspace. Waits for WINDOW_UNMANAGED per window (like open phase waits for WINDOW_MANAGED).
 */

import { WmEventType } from 'glazewm';
import { focusWorkspace, getWorkspace } from './glazeCommon.js';
import { delay } from './glazeCommon.js';
import { findAllWindows } from './parseWorkspace.js';

const CLEAR_TIMEOUT = 1_000;

/**
 * Subscribe to WINDOW_UNMANAGED, run closeAction, then wait for that window to unmanage.
 * Resolves when event.unmanagedId === windowId. Rejects on timeout. Subscribes before close so the event is not missed.
 * @param {object} client - WmClient
 * @param {string} windowId - Window/container id
 * @param {() => Promise<any>} closeAction - Called after subscribing (e.g. () => client.runCommand('close', id)); return value ignored
 * @returns {Promise<void>}
 */
async function waitForWindowClosed(client, windowId, closeAction) {
  let resolveWait;
  let rejectWait;
  const waitPromise = new Promise((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });

  const handler = (event) => {
    if (event?.unmanagedId === windowId) resolveWait();
  };

  const unlisten = await client.subscribe(WmEventType.WINDOW_UNMANAGED, handler);
  const timeout = delay(CLEAR_TIMEOUT).then(() => {
    rejectWait(new Error(`Timeout waiting for window ${windowId} to close`));
  });

  try {
    await closeAction();
    await Promise.race([waitPromise, timeout]);
  } finally {
    await unlisten();
  }
}

/**
 * Clear all windows in the given workspace via GlazeWM close command.
 * Waits for each window to close (WINDOW_UNMANAGED) before proceeding to the next.
 */
export async function clearWorkspace(client, workspaceName, opts = {}) {
  const log = opts.log ?? (() => {});

  log(`Clearing workspace ${workspaceName}`);

  const target = await focusWorkspace(client, workspaceName, opts);
  if (!target) return;

  const allWindows = findAllWindows(target);

  for (const window of allWindows) {
    const id = window?.id;
    const title = window?.title ?? 'Unknown';
    if (!id) throw new Error(`Window has no ID: ${title}`);

    log(`Closing window: ${title} (ID: ${id})`);
    await waitForWindowClosed(
      client,
      id,
      () => client.runCommand('close', id),
    );
  }

  log(`Closed ${allWindows.length} windows from workspace ${workspaceName}`);
}

/**
 * Wait for one workspace event (WORKSPACE_UPDATED or WORKSPACE_DEACTIVATED) for the given workspace.
 * Use after all window closes so the WM has emitted an updated state before we query window count.
 * @param {object} client - WmClient
 * @param {string} workspaceName - Workspace name
 * @returns {Promise<void>}
 */
async function waitForWorkspaceEvent(client, workspaceName) {
  let resolveWait;
  const waitPromise = new Promise((resolve) => {
    resolveWait = resolve;
  });

  const handler = (event) => {
    if (event?.eventType === WmEventType.WORKSPACE_UPDATED && event?.updatedWorkspace?.name === workspaceName) {
      resolveWait();
    } else if (event?.eventType === WmEventType.WORKSPACE_DEACTIVATED && event?.deactivatedName === workspaceName) {
      resolveWait();
    }
  };

  const unlisten = await client.subscribeMany(
    [WmEventType.WORKSPACE_UPDATED, WmEventType.WORKSPACE_DEACTIVATED],
    handler,
  );
  const timeout = delay(CLEAR_TIMEOUT).then(() => resolveWait());

  try {
    await Promise.race([waitPromise, timeout]);
  } finally {
    await unlisten();
  }
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

  for (const name of workspacesToClear) {
    await clearWorkspace(client, name, { log });
    await waitForWorkspaceEvent(client, name);
    const ws = await getWorkspace(client, name);
    const remaining = ws ? findAllWindows(ws).length : 0;
    if (remaining > 0) {
      throw new Error(`Workspace "${name}" still has ${remaining} window(s) after clearing`);
    }
  }

  log('All configured workspaces cleared.');
}
