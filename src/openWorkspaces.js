/**
 * GlazeWM Open Workspaces
 *
 * Opens applications defined in config for each workspace:
 * focus workspace, spawn each app, then wait for windows via WINDOW_MANAGED events (or max 30s).
 * We use child_process.spawn instead of GlazeWM shell-exec to avoid IPC quoting issues.
 */

import { spawn } from 'child_process';
import { WmEventType } from 'glazewm';
import { findAllWindows, flattenApplications } from './parseWorkspace.js';

const BEFORE_OPEN_FOCUS_DELAY_MS = 500;
const WAIT_TIME_BETWEEN_APPS_MS = 1000;
const MAX_WAIT_FOR_WINDOWS_MS = 60_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * For each workspace: focus workspace, then shell-exec each app (path + args), delay between apps.
 *
 * @param {object} client - Connected glazewm-js WmClient
 * @param {object} config - Loaded config (workspaces[].applications[], settings.wait_time_between_apps)
 * @param {{ log: (msg: string) => void }} opts
 */
export async function runOpenPhase(client, config, opts = {}) {
  const log = opts.log ?? (() => {});
  const originalWorkspace = opts.originalWorkspace ?? null;
  const waitTimeMs = (config.settings?.wait_time_between_apps ?? 1.0) * 1000;

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
      const path = app?.path;
      const name = app?.title ?? app?.name ?? 'Unknown';
      const baseArgs = Array.isArray(app?.args) ? [...app.args] : [];
      let args = baseArgs;
      if (app?.link) {
        args = [...baseArgs, '-new-window'];
        if (app?.fullscreen) args.push('-kiosk');
        args.push(app.link);
      }

      if (!path || path === 'FILL ME IN') {
        log(`Skipping ${name}: no executable path`);
        continue;
      }

      log(`Opening: ${name}${app?.link ? ' ' + app.link : ''}`);
      try {
        spawn(path, args, {
          detached: true,
          stdio: 'ignore',
          shell: false,
        }).unref();
        expectedWindowCount += 1;
      } catch (err) {
        const msg = typeof err === 'string' ? err : err?.message ?? String(err);
        log(`Failed to open ${name}: ${msg}`);
        throw err;
      }
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
