/**
 * GlazeWM Open Workspaces
 *
 * Opens applications defined in config for each workspace:
 * focus workspace, spawn each app, wait for window via WINDOW_MANAGED (per-window timeout).
 * Config uses "application": exe path (.exe), AUMID (contains !), or exact Start Menu display name (Windows).
 */

import { spawn } from 'child_process';
import { WmEventType } from 'glazewm';
import { delay, focusWorkspace } from './glazeCommon.js';
import { findAllWindows, flattenApplications } from './parseWorkspace.js';

const PER_WINDOW_TIMEOUT_MS = 60_000;

const isWindows = process.platform === 'win32';

/** One-time in-memory dict: Get-StartApps Name → AppId (AUMID). Windows only. */
let startAppsDict = null;

/**
 * Get Start Menu apps as dict (Name → AppId). Runs PowerShell silently once per run.
 * @returns {Promise<Record<string, string>|null>} Name → AUMID, or null on error/non-Windows
 */
async function getStartAppsDict() {
  if (!isWindows) return null;
  if (startAppsDict !== null) return startAppsDict;

  const cmd = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json';
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const chunks = [];
  child.stdout?.on('data', (chunk) => chunks.push(chunk));
  const stderr = [];
  child.stderr?.on('data', (chunk) => stderr.push(chunk));

  try {
    await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`PowerShell exit ${code}`))));
    });
  } catch (_) {
    startAppsDict = {};
    return startAppsDict;
  }

  let raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    startAppsDict = {};
    for (const item of arr) {
      const name = item?.Name ?? item?.name;
      const appId = item?.AppId ?? item?.AppID ?? item?.appId;
      if (name != null && appId != null) {
        startAppsDict[String(name).trim()] = String(appId).trim();
      }
    }
  } catch (_) {
    startAppsDict = {};
  }
  return startAppsDict;
}

/**
 * Wait for one new window in the workspace (id not in previousIds) via WINDOW_MANAGED subscription.
 * Resolves with window id when a managed window belongs to wsName and is not in previousIds; null on timeout.
 * @param {object} client - WmClient
 * @param {string} workspaceName - Target workspace name
 * @param {string[]} previousIds - Window ids to ignore
 * @returns {Promise<string|null>} New window id or null
 */
async function waitForOneNewWindow(client, workspaceName, previousIds) {
  const seen = new Set(previousIds);
  let resolveWait;
  const waitPromise = new Promise((resolve) => {
    resolveWait = resolve;
  });

  const handler = async (event) => {
    const id = event?.managedWindow?.id;
    if (!id || seen.has(id)) return;
    const { workspaces } = await client.queryWorkspaces();
    const ws = workspaces?.find((w) => w?.name === workspaceName);
    if (!ws) return;
    const windows = findAllWindows(ws);
    const inWorkspace = windows.some((w) => w?.id === id);
    if (inWorkspace) resolveWait(id);
  };

  const unlisten = await client.subscribe(WmEventType.WINDOW_MANAGED, handler);

  try {
    return await Promise.race([waitPromise, delay(PER_WINDOW_TIMEOUT_MS).then(() => null)]);
  } finally {
    await unlisten();
  }
}

/**
 * Resolve application (exe / AUMID / name), spawn process. Handles child.on('error') via opts.onSpawnError and child.unref().
 * For by-name launch on non-Windows, throws. For by-name when app not found, throws.
 * Caller should pass onSpawnError so spawn errors reject a promise and the wrapper can restore workspace.
 * @param {object} app - Config node with application, title/name, args, link, etc.
 * @param {{ log: (msg: string) => void, onSpawnError?: (err: Error) => void }} opts
 */
function launchApplication(app, opts = {}) {
  const log = opts.log ?? (() => {});
  const onSpawnError = opts.onSpawnError;
  const application = app?.application ?? app?.path;
  const name = app?.title ?? app?.name ?? 'Unknown';

  if (!application || application === 'FILL ME IN') {
    throw new Error(`No application for ${name}`);
  }

  let child;
  if (application.endsWith('.exe')) {
    const baseArgs = Array.isArray(app?.args) ? [...app.args] : [];
    let args = baseArgs;
    if (app?.link) {
      args = [...baseArgs, '-new-window'];
      args.push(app.link);
    }
    log(`Opening: ${name}${app?.link ? ' ' + app.link : ''}`);
    child = spawn(application, args, { detached: true, stdio: 'ignore', shell: false });
  } else if (application.includes('!')) {
    log(`Opening: ${name} (AUMID)`);
    child = spawn('explorer.exe', ['shell:AppsFolder\\' + application], { detached: true, stdio: 'ignore', shell: false });
  } else {
    if (!isWindows) {
      throw new Error(`Launch by name is Windows-only: ${name}`);
    }
    const dict = startAppsDict;
    if (dict == null) {
      throw new Error('getStartAppsDict must be called before launch by name');
    }
    const aumid = dict[application];
    if (aumid == null) {
      throw new Error(`App not found: ${application}`);
    }
    log(`Opening: ${name}`);
    child = spawn('explorer.exe', ['shell:AppsFolder\\' + aumid], { detached: true, stdio: 'ignore', shell: false });
  }

  child.on('error', (err) => {
    const msg = err?.message ?? String(err);
    log(`Failed to open ${name}: ${msg}`);
    onSpawnError?.(err);
  });
  child.unref();
}

/**
 * Open all apps in one workspace: focus workspace, then for each app launch → wait for window.
 * Does not collect fullscreen ids; use getFullscreenWindowIdsForWorkspace after all workspaces are open.
 * @param {object} client - WmClient
 * @param {object} workspace - Config workspace node (name, children / flattenApplications)
 * @param {{ log: (msg: string) => void, client: object, originalWorkspace: string|null }} opts
 */
async function openAppsInWorkspace(client, workspace, opts = {}) {
  const log = opts.log ?? (() => {});
  const wsName = workspace?.name;
  const applications = flattenApplications(workspace);
  if (!wsName || applications.length === 0) return;

  await focusWorkspace(client, wsName, opts);

  for (const app of applications) {
    const application = app?.application ?? app?.path;
    const name = app?.title ?? app?.name ?? 'Unknown';

    if (!application || application === 'FILL ME IN') {
      log(`Skipping ${name}: no application`);
      continue;
    }

    const { workspaces } = await client.queryWorkspaces();
    const ws = workspaces?.find((w) => w?.name === wsName);
    const previousIds = ws ? findAllWindows(ws).map((w) => w.id).filter(Boolean) : [];

    let rejectLaunch;
    const launchPromise = new Promise((_, rej) => {
      rejectLaunch = rej;
    });
    try {
      launchApplication(app, { ...opts, onSpawnError: (err) => rejectLaunch(err) });
    } catch (err) {
      log(err?.message ?? String(err));
      throw err;
    }

    const newWindowId = await Promise.race([
      waitForOneNewWindow(client, wsName, previousIds),
      launchPromise.then(() => null),
    ]);

    if (newWindowId == null) {
      log(`Timed out waiting for window in ${wsName} (${name})`);
      throw new Error(`Timed out waiting for window in ${wsName} (${name})`);
    }
  }
}

/**
 * Open applications in each workspace from config.
 * For every window: open app → wait for window (WINDOW_MANAGED); per-window timeout.
 *
 * @param {object} client - Connected glazewm-js WmClient
 * @param {object} config - Loaded config (workspaces[].children[] tree)
 * @param {{ log: (msg: string) => void, originalWorkspace?: string|null }} opts
 */
export async function runOpenPhase(client, config, opts = {}) {
  const log = opts.log ?? (() => {});
  const originalWorkspace = opts.originalWorkspace ?? null;

  log('--- Opening applications ---');

  if (isWindows) {
    await getStartAppsDict();
  }

  for (const workspace of config.workspaces ?? []) {
    await openAppsInWorkspace(client, workspace, { ...opts, client, originalWorkspace });
  }
}

