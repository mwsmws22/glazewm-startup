/**
 * Fullscreen phase: match config fullscreen: true to current windows by index, then F11 each.
 * Used after layout in startup (all workspaces) and by cli-fullscreen (one workspace).
 */

import { spawn } from 'child_process';
import { focusWindow, focusWorkspace } from './glazeCommon.js';
import { findAllWindows, flattenApplications } from './parseWorkspace.js';

const isWindows = process.platform === 'win32';

async function sendF11Key() {
  if (!isWindows) return;
  const cmd =
    'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'{F11}\')';
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], {
    windowsHide: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.on('exit', resolve);
    child.on('error', reject);
  });
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
    await focusWindow(client, id);
    await sendF11Key();
  }
}

/**
 * Fullscreen phase: for each target workspace, focus the workspace then F11 its fullscreen windows.
 * If opts.workspaceName is set, only that workspace is processed (with validation and log messages).
 * Otherwise all workspaces in config are processed.
 *
 * @param {object} client - WmClient
 * @param {object} config - Loaded config (workspaces[].children[] tree)
 * @param {{ log?: (msg: string) => void, workspaceName?: string }} opts - workspaceName = single workspace (e.g. "2"); omit for all
 */
export async function runFullscreenPhase(client, config, opts = {}) {
  const log = opts.log ?? (() => {});
  const workspaceName = opts.workspaceName;

  const workspaces =
    workspaceName != null && workspaceName !== ''
      ? (config.workspaces ?? []).filter((w) => w?.name === workspaceName)
      : config.workspaces ?? [];

  if (workspaceName != null && workspaceName !== '' && workspaces.length === 0) {
    log(`Workspace "${workspaceName}" not found in config.`);
    return;
  }

  for (const workspace of workspaces) {
    const wsName = workspace?.name;
    if (!wsName) continue;
    const windows = await getFullscreenWindowIdsForWorkspace(client, workspace, wsName);
    if (windows.length === 0) {
      if (workspaceName != null && workspaceName !== '') {
        log(`No fullscreen windows in workspace "${wsName}" (config fullscreen: true matched to current windows).`);
      }
      continue;
    }
    await focusWorkspace(client, wsName, opts);
    await fullscreenWindowIds(client, windows, opts);
  }
}
