/**
 * GlazeWM Open Workspaces
 *
 * Opens applications defined in config for each workspace:
 * focus workspace, spawn each app, then wait for windows via WINDOW_MANAGED events (or max 30s).
 * Config uses "application": exe path (.exe), AUMID (contains !), or exact Start Menu display name (Windows).
 */

import { spawn } from 'child_process';
import { WmEventType } from 'glazewm';
import { findAllWindows, flattenApplications } from './parseWorkspace.js';

const BEFORE_OPEN_FOCUS_DELAY_MS = 500;
const WAIT_TIME_BETWEEN_APPS_MS = 1000;
const MAX_WAIT_FOR_WINDOWS_MS = 60_000;

const isWindows = process.platform === 'win32';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Wait for expectedCount windows in workspace by subscribing to WINDOW_MANAGED.
 * Each time GlazeWM manages a new window we re-check the workspace count; resolve when count >= expectedCount or maxWaitMs.
 * See https://github.com/glzr-io/glazewm-js – WmEventType.WINDOW_MANAGED.
 */
async function waitUntilWindowsUp(client, workspaceName, expectedCount, maxWaitMs, opts = {}) {
  const log = opts.log ?? (() => {});
  if (expectedCount <= 0) return;

  let resolveWait;
  const waitPromise = new Promise((resolve) => {
    resolveWait = resolve;
  });

  const check = async () => {
    const { workspaces } = await client.queryWorkspaces();
    const ws = workspaces?.find((w) => w?.name === workspaceName);
    const count = ws ? findAllWindows(ws).length : 0;
    if (count >= expectedCount) resolveWait();
  };

  const unlisten = await client.subscribe(WmEventType.WINDOW_MANAGED, check);

  try {
    await check();
    await Promise.race([waitPromise, delay(maxWaitMs)]);
    const { workspaces } = await client.queryWorkspaces();
    const ws = workspaces?.find((w) => w?.name === workspaceName);
    const finalCount = ws ? findAllWindows(ws).length : 0;
    if (finalCount >= expectedCount) {
      log(`Workspace ${workspaceName}: ${finalCount} window(s) up`);
    } else {
      log(`Workspace ${workspaceName}: timed out after ${maxWaitMs / 1000}s (${finalCount}/${expectedCount} windows)`);
    }
  } finally {
    unlisten();
  }
}

/**
 * Open applications in each workspace from config.
 * "application" can be: .exe path (spawn directly), AUMID (explorer shell:AppsFolder), or exact Start Menu name (Windows).
 *
 * @param {object} client - Connected glazewm-js WmClient
 * @param {object} config - Loaded config (workspaces[].children[] tree)
 * @param {{ log: (msg: string) => void }} opts
 */
export async function runOpenPhase(client, config, opts = {}) {
  const log = opts.log ?? (() => {});
  const originalWorkspace = opts.originalWorkspace ?? null;

  log('--- Opening applications ---');

  for (const workspace of config.workspaces ?? []) {
    const wsName = workspace?.name;
    const applications = flattenApplications(workspace);
    if (!wsName || applications.length === 0) continue;

    log(`Focusing workspace ${wsName}`);
    await client.runCommand('focus --workspace ' + wsName);
    await delay(BEFORE_OPEN_FOCUS_DELAY_MS);

    let expectedWindowCount = 0;
    for (const app of applications) {
      const application = app?.application ?? app?.path;
      const name = app?.title ?? app?.name ?? 'Unknown';

      if (!application || application === 'FILL ME IN') {
        log(`Skipping ${name}: no application`);
        continue;
      }

      let child;
      if (application.endsWith('.exe')) {
        const baseArgs = Array.isArray(app?.args) ? [...app.args] : [];
        let args = baseArgs;
        if (app?.link) {
          args = [...baseArgs, '-new-window'];
          if (app?.fullscreen) args.push('-kiosk');
          args.push(app.link);
        }
        log(`Opening: ${name}${app?.link ? ' ' + app.link : ''}`);
        child = spawn(application, args, { detached: true, stdio: 'ignore', shell: false });
      } else if (application.includes('!')) {
        log(`Opening: ${name} (AUMID)`);
        child = spawn('explorer.exe', ['shell:AppsFolder\\' + application], { detached: true, stdio: 'ignore', shell: false });
      } else {
        if (!isWindows) {
          log(`Skipping ${name}: launch by name is Windows-only`);
          continue;
        }
        const dict = await getStartAppsDict();
        const aumid = dict?.[application];
        if (aumid == null) {
          log(`App not found: ${application}`);
          if (originalWorkspace) {
            log(`Focusing back to workspace ${originalWorkspace} (after error)`);
            await client.runCommand('focus --workspace ' + originalWorkspace).catch(() => {});
            await delay(300);
          }
          process.exit(1);
        }
        log(`Opening: ${name}`);
        child = spawn('explorer.exe', ['shell:AppsFolder\\' + aumid], { detached: true, stdio: 'ignore', shell: false });
      }

      child.on('error', async (err) => {
        const msg = err?.message ?? String(err);
        log(`Failed to open ${name}: ${msg}`);
        if (originalWorkspace) {
          log(`Focusing back to workspace ${originalWorkspace} (after spawn error)`);
          try {
            await client.runCommand('focus --workspace ' + originalWorkspace);
            await delay(300);
          } catch (_) {}
        }
        process.exit(1);
      });
      child.unref();
      expectedWindowCount += 1;
      await delay(WAIT_TIME_BETWEEN_APPS_MS);
    }

    if (expectedWindowCount > 0) {
      log(`Waiting for windows in workspace ${wsName} (max ${MAX_WAIT_FOR_WINDOWS_MS / 1000}s)...`);
      await waitUntilWindowsUp(client, wsName, expectedWindowCount, MAX_WAIT_FOR_WINDOWS_MS, { log });
    }
  }

  if (originalWorkspace) {
    log(`Focusing back to workspace ${originalWorkspace}`);
    await client.runCommand('focus --workspace ' + originalWorkspace);
    await delay(300);
  }

  log('Done.');
}
