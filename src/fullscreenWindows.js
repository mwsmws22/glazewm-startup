/**
 * Fullscreen phase: match config fullscreen: true to current windows by index, then F11 each.
 * Used after layout in startup (all workspaces) and by cli-fullscreen (one workspace).
 */

import { spawn } from 'child_process';
import { delay, focusWindow, focusWorkspace, FOCUS_DELAY_MS } from './glazeCommon.js';
import { findAllWindows, flattenApplications } from './parseWorkspace.js';

const isWindows = process.platform === 'win32';

function sendF11Key() {
  if (!isWindows) return;
  const cmd =
    'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'{F11}\')';
  spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], {
    windowsHide: true,
    stdio: 'ignore',
  }).unref();
}

/**
 * Get windows that have fullscreen: true in config for a workspace, by matching config to current windows by index.
 * @param {object} client - WmClient
 * @param {object} workspaceConfig - Config workspace node (name, children / flattenApplications)
 * @param {string} workspaceName - Workspace name (e.g. "2")
 * @returns {Promise<Array<{ id: string, title: string }>>} Windows to fullscreen (id + title for logging)
 */
export async function getFullscreenWindowIdsForWorkspace(client, workspaceConfig, workspaceName) {
  const { workspaces: liveWorkspaces } = await client.queryWorkspaces();
  const liveWs = liveWorkspaces?.find((w) => w?.name === workspaceName);
  if (!liveWs) return [];
  const apps = flattenApplications(workspaceConfig);
  const windows = findAllWindows(liveWs);
  const list = [];
  for (let i = 0; i < apps.length && i < windows.length; i++) {
    if (apps[i]?.fullscreen && windows[i]?.id) {
      list.push({
        id: windows[i].id,
        title: windows[i].title ?? apps[i]?.title ?? apps[i]?.name ?? 'Unknown',
      });
    }
  }
  return list;
}

/**
 * Fullscreen a list of windows: focus each, send F11, delay between. Logs window title and id.
 * @param {object} client - WmClient
 * @param {Array<{ id: string, title: string }>} windows - Windows to fullscreen (id + title for logging)
 * @param {{ log?: (msg: string) => void }} opts
 */
export async function fullscreenWindowIds(client, windows, opts = {}) {
  const log = opts.log ?? (() => {});
  if (windows.length === 0) return;
  log(`Fullscreening ${windows.length} window(s)...`);
  for (const { id, title } of windows) {
    log(`Fullscreening: ${title} (id: ${id})`);
    await focusWindow(client, id, opts);
    sendF11Key();
    await delay(FOCUS_DELAY_MS);
  }
}

/**
 * Fullscreen phase for all workspaces: get fullscreen window ids from each workspace, then fullscreen them all.
 * @param {object} client - WmClient
 * @param {object} config - Loaded config (workspaces[].children[] tree)
 * @param {{ log?: (msg: string) => void }} opts
 */
export async function runFullscreenPhaseAll(client, config, opts = {}) {
  const allFullscreenWindowIds = [];
  for (const workspace of config.workspaces ?? []) {
    const wsName = workspace?.name;
    if (!wsName) continue;
    const ids = await getFullscreenWindowIdsForWorkspace(client, workspace, wsName);
    allFullscreenWindowIds.push(...ids);
  }
  await fullscreenWindowIds(client, allFullscreenWindowIds, opts);
}

/**
 * Fullscreen phase for one workspace: match current windows to config by index, then fullscreen those with fullscreen: true.
 * Use for testing (e.g. npm run fullscreen 2).
 *
 * @param {object} client - WmClient
 * @param {object} config - Loaded config (workspaces[].children[] tree)
 * @param {{ log?: (msg: string) => void, workspaceName: string }} opts - workspaceName is the single workspace (e.g. "2")
 */
export async function runFullscreenPhase(client, config, opts = {}) {
  const log = opts.log ?? (() => {});
  const workspaceName = opts.workspaceName;
  if (!workspaceName) {
    log('workspaceName is required (e.g. npm run fullscreen 2).');
    return;
  }

  const workspace = config.workspaces?.find((w) => w?.name === workspaceName);
  if (!workspace) {
    log(`Workspace "${workspaceName}" not found in config.`);
    return;
  }

  const windows = await getFullscreenWindowIdsForWorkspace(client, workspace, workspaceName);
  if (windows.length === 0) {
    log(`No fullscreen windows in workspace "${workspaceName}" (config fullscreen: true matched to current windows).`);
    return;
  }

  await focusWorkspace(client, workspaceName, opts);
  await fullscreenWindowIds(client, windows, opts);
}
