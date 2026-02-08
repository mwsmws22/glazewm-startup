/**
 * Common GlazeWM commands and helpers.
 * Shared by openWorkspaces, clearWorkspaces, fullscreen CLI, etc.
 */

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the name of the currently focused workspace.
 * @param {object} client - WmClient
 * @returns {Promise<string|null>}
 */
export async function getCurrentWorkspace(client) {
  const { workspaces } = await client.queryWorkspaces();
  const focused = workspaces?.find((w) => w?.hasFocus);
  return focused?.name ?? null;
}

/**
 * Focus a workspace by name, then wait so the WM can settle.
 * @param {object} client - WmClient
 * @param {string} workspaceName - Workspace name (e.g. "2")
 * @param {{ log?: (msg: string) => void }} opts
 */
export async function focusWorkspace(client, workspaceName, opts = {}) {
  const log = opts.log ?? (() => {});
  if (workspaceName) {
    log(`Focusing workspace ${workspaceName}`);
    await client.runCommand('focus --workspace ' + workspaceName);
  }
}

/**
 * Focus a window (or container) by id, then wait so the WM can settle.
 * @param {object} client - WmClient
 * @param {string} containerId - Container/window id
 */
export async function focusWindow(client, containerId) {
  if (!containerId) {
    throw new Error('containerId is required');
  }
  await client.runCommand('focus --container-id ' + containerId);
}

/**
 * Run a function, then restore workspace, close client, and exit the process.
 * Gets current workspace first, passes opts with originalWorkspace to fn.
 * On success: restore, close, process.exit(0). On error: log, restore, close, process.exit(1).
 * Never returns; callers do not need try/catch or process.exit after calling this.
 *
 * @param {object} client - WmClient
 * @param {object} opts - Options passed through to fn (and to restore); typically { log }
 * @param {(client: object, opts: object) => Promise<*>} fn - Async function to run; receives (client, { ...opts, originalWorkspace })
 */
export async function runWithWorkspaceRestore(client, opts, fn) {
  const originalWorkspace = await getCurrentWorkspace(client);
  const optsWithOriginal = { ...opts, originalWorkspace };
  const doRestoreAndClose = async () => {
    await focusWorkspace(client, originalWorkspace, opts);
    if (typeof client.closeConnection === 'function') {
      await client.closeConnection();
    } else if (typeof client.close === 'function') {
      client.close();
    }
  };
  try {
    await fn(client, optsWithOriginal);
    await doRestoreAndClose();
    process.exit(0);
  } catch (err) {
    const log = opts.log ?? (() => {});
    log(err?.message ?? String(err));
    try {
      await doRestoreAndClose();
    } catch (_) {}
    process.exit(1);
  }
}
