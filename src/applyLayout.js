/**
 * GlazeWM Apply Layout (tiled only)
 *
 * After windows are open, build the split tree to match config using
 * tiling_direction and tiling_size (ratios). No floating, no pixel position/size.
 *
 * - Set workspace tiling direction
 * - Use move (--direction left/right/up/down) and toggle-tiling-direction to create
 *   the split structure (vertical stacks where config has split with 2 children)
 * - Optionally use resize (--width / --height with +/- N%) to approximate tiling_size ratios
 */

import { findAllWindows, flattenApplications } from './parseWorkspace.js';

const LAYOUT_DELAY_MS = 500;
/** Very tight tolerance for tiling_size ratio (aim for near-perfect match). */
const TOLERANCE_RATIO = 0.002;
/** Max resize iterations per container to avoid infinite loops. */
const MAX_RESIZE_ITERATIONS = 80;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Set workspace tiling direction to match config by toggling the workspace container until query matches.
 */
async function setWorkspaceTilingDirection(client, workspaceName, targetDirection, opts = {}) {
  const log = opts.log ?? (() => {});

  const wantHorizontal = (targetDirection ?? 'horizontal').toLowerCase() === 'horizontal';

  for (let i = 0; i < 5; i++) {
    const { workspaces } = await client.queryWorkspaces();
    const ws = workspaces?.find((w) => w?.name === workspaceName);
    if (!ws) return;

    const current = (ws.tilingDirection ?? 'horizontal').toLowerCase();
    const isHorizontal = current === 'horizontal';
    if (isHorizontal === wantHorizontal) {
      log(`Workspace ${workspaceName}: tiling direction already ${current}`);
      return;
    }

    log(`Workspace ${workspaceName}: toggling tiling direction (current: ${current}, want: ${targetDirection})`);
    await client.runCommand('toggle-tiling-direction', ws.id);
    await delay(LAYOUT_DELAY_MS);
  }
}

/**
 * Find a split container whose direct children are exactly two windows with the given ids.
 */
function findSplitContainingTwoWindows(container, idA, idB) {
  if (container?.type !== 'split' && container?.type !== 'workspace') return null;
  const children = container?.children ?? [];
  for (const child of children) {
    if (child?.type === 'split') {
      const cids = (child.children ?? []).map((c) => c?.id).filter(Boolean);
      if (cids.length === 2 && cids.includes(idA) && cids.includes(idB)) {
        return child;
      }
      const found = findSplitContainingTwoWindows(child, idA, idB);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find the parent container of a window by id (workspace or split).
 */
function findParentOfWindow(container, windowId) {
  const children = container?.children ?? [];
  for (const child of children) {
    if (child?.id === windowId) return container;
    if (child?.type === 'split' || child?.type === 'workspace') {
      const found = findParentOfWindow(child, windowId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Walk query workspace by path (array of child indices) to get the container node.
 * @param {object} ws - Workspace node from query
 * @param {number[]} path - Path from workspace root, e.g. [0] = first child, [0,1] = second child of first
 * @returns {object|null} - Container at path or null
 */
function getQueryNodeByPath(ws, path) {
  let node = ws;
  for (const i of path) {
    const children = node?.children ?? [];
    if (i < 0 || i >= children.length) return null;
    node = children[i];
  }
  return node;
}

/**
 * Collect every container (workspace or split) that has children, by walking config and query in parallel.
 * Returns list in BFS order (depth 0 = workspace children, then depth 1, etc.) so we apply outer ratios first.
 * Ratio refers to parent tiling direction: vertical parent → height ratio; horizontal parent → width ratio.
 */
function collectRatioContainers(configNode, queryNode, path = [], depth = 0, out = []) {
  const configChildren = configNode?.children ?? [];
  const queryChildren = queryNode?.children ?? [];
  if (configChildren.length === 0 || queryChildren.length !== configChildren.length) return out;

  const parentTilingDirection = (configNode?.tiling_direction ?? configNode?.tilingDirection ?? 'horizontal').toLowerCase();
  out.push({ depth, path, parentTilingDirection, configChildren, queryChildren });

  for (let i = 0; i < configChildren.length; i++) {
    collectRatioContainers(configChildren[i], queryChildren[i], path.concat(i), depth + 1, out);
  }
  return out;
}

/**
 * Build the tiled split tree: for each vertical split (w0, w1), focus w0, set-tiling-direction vertical (no id),
 * then focus w1 and move left so w1 stacks with w0. Re-query after each grouping so we have current tree.
 */
async function buildTiledTree(client, ws, workspaceConfig, windowsByFlattenIndex, opts = {}) {
  const log = opts.log ?? (() => {});
  const children = workspaceConfig?.children ?? [];
  if (children.length === 0) return;

  const applications = flattenApplications(workspaceConfig);
  const nodeToIndex = new Map();
  applications.forEach((node, i) => nodeToIndex.set(node, i));

  let currentWindows = [...windowsByFlattenIndex];

  for (const node of children) {
    if (node?.type !== 'split' || !Array.isArray(node.children) || node.children.length !== 2) continue;

    const splitDirection = (node.tiling_direction ?? node.tilingDirection ?? 'vertical').toLowerCase();
    const app0 = node.children[0];
    const app1 = node.children[1];
    if (app0?.type !== 'window' || app1?.type !== 'window') continue;

    const idx0 = nodeToIndex.get(app0);
    const idx1 = nodeToIndex.get(app1);
    if (idx0 == null || idx1 == null || idx0 === idx1) continue;

    const win0 = currentWindows[idx0];
    const win1 = currentWindows[idx1];
    if (!win0?.id || !win1?.id) continue;

    const name0 = app0?.title ?? app0?.name ?? win0?.title ?? '?';
    const name1 = app1?.title ?? app1?.name ?? win1?.title ?? '?';
    log(`Grouping into ${splitDirection} split: ${name0} (idx ${idx0}), ${name1} (idx ${idx1})`);

    try {
      await client.runCommand('focus --workspace ' + (workspaceConfig?.name ?? ''));
      await delay(LAYOUT_DELAY_MS);
      await client.runCommand('focus --container-id ' + win0.id);
      await delay(LAYOUT_DELAY_MS);
      await client.runCommand('set-tiling-direction ' + splitDirection);
      await delay(LAYOUT_DELAY_MS);
      await client.runCommand('focus --container-id ' + win1.id);
      await delay(LAYOUT_DELAY_MS);
      await client.runCommand('move --direction left', win1.id);
      await delay(LAYOUT_DELAY_MS);
    } catch (err) {
      log(`Error during grouping: ${err?.message ?? err}`);
      continue;
    }

    const { workspaces } = await client.queryWorkspaces();
    const wsCurrent = workspaces?.find((w) => w?.name === workspaceConfig?.name);
    if (!wsCurrent) {
      log(`Workspace ${workspaceConfig?.name} not found after grouping`);
      continue;
    }

    const split = findSplitContainingTwoWindows(wsCurrent, win0.id, win1.id);
    if (split?.id) {
      await client.runCommand('set-tiling-direction ' + splitDirection, split.id);
      await delay(LAYOUT_DELAY_MS);
      log(`Focusing split container for next grouping`);
      await client.runCommand('focus --container-id ' + split.id);
      await delay(LAYOUT_DELAY_MS);
    }
    currentWindows = findAllWindows(wsCurrent);
  }
}

/**
 * Apply tiling_size ratios using resize. Ratio is relative to parent tiling direction:
 * - Parent horizontal → resize --width (child's share of width).
 * - Parent vertical → resize --height (child's share of height).
 * Walks config/query in parallel (BFS), applies resize per container, re-queries after each step for accuracy.
 */
async function applyTilingSizes(client, wsName, workspaceConfig, queryWorkspace, opts = {}) {
  const log = opts.log ?? (() => {});

  const containers = collectRatioContainers(workspaceConfig, queryWorkspace);
  containers.sort((a, b) => a.depth - b.depth);

  const axisFromDirection = (dir) => ((dir ?? 'horizontal').toLowerCase() === 'vertical' ? 'height' : 'width');

  for (const { path, parentTilingDirection, configChildren } of containers) {
    const axis = axisFromDirection(parentTilingDirection);
    let iterations = 0;

    while (iterations < MAX_RESIZE_ITERATIONS) {
      const { workspaces } = await client.queryWorkspaces();
      const wsCurrent = workspaces?.find((w) => w?.name === wsName);
      if (!wsCurrent) break;

      const node = getQueryNodeByPath(wsCurrent, path);
      const queryChildren = node?.children ?? [];
      if (queryChildren.length !== configChildren.length) break;

      const totalSize = queryChildren.reduce((s, c) => s + (c?.tilingSize ?? 0), 0);
      if (totalSize <= 0) break;

      const currentRatios = queryChildren.map((c) => (c?.tilingSize ?? 0) / totalSize);
      const targetRatios = configChildren.map((c) => c?.tilingSize ?? c?.tiling_size ?? 0.5);
      let maxError = 0;
      let worstIndex = -1;
      let worstDiff = 0;

      for (let i = 0; i < configChildren.length; i++) {
        const err = Math.abs((targetRatios[i] ?? 0) - (currentRatios[i] ?? 0));
        if (err > maxError) {
          maxError = err;
          worstIndex = i;
          worstDiff = (targetRatios[i] ?? 0) - (currentRatios[i] ?? 0);
        }
      }

      if (maxError < TOLERANCE_RATIO || worstIndex < 0) break;

      const childId = queryChildren[worstIndex]?.id;
      if (!childId) break;

      const stepPct = Math.min(5, Math.max(1, Math.round(Math.abs(worstDiff) * 100)));
      const sign = worstDiff > 0 ? '+' : '-';
      const cmd = `resize --${axis} ${sign}${stepPct}%`;
      log(`Resize path [${path.join(',')}] child ${worstIndex}: ${cmd} (target ${((targetRatios[worstIndex] ?? 0) * 100).toFixed(2)}%, current ${((currentRatios[worstIndex] ?? 0) * 100).toFixed(2)}%)`);

      await client.runCommand('focus --container-id ' + childId);
      await delay(LAYOUT_DELAY_MS);
      await client.runCommand(cmd, childId);
      await delay(LAYOUT_DELAY_MS);

      iterations++;
    }
  }
}

/**
 * Run the layout phase: set workspace tiling direction, build split tree (move + toggle), then optionally resize.
 * Config uses workspace.children[] (split or window) with tiling_direction and tiling_size only.
 */
export async function runLayoutPhase(client, config, opts = {}) {
  const log = opts.log ?? (() => {});

  log('--- Applying layout (tiled) ---');

  for (const workspace of config.workspaces ?? []) {
    const wsName = workspace?.name;
    const targetTilingDirection = workspace?.tiling_direction ?? workspace?.tilingDirection ?? 'horizontal';
    const applications = flattenApplications(workspace);
    if (!wsName || applications.length === 0) continue;

    log(`Focusing workspace ${wsName}`);
    await client.runCommand('focus --workspace ' + wsName);
    await delay(LAYOUT_DELAY_MS);

    await setWorkspaceTilingDirection(client, wsName, targetTilingDirection, { log });
    await delay(LAYOUT_DELAY_MS);

    const { workspaces } = await client.queryWorkspaces();
    const ws = workspaces?.find((w) => w?.name === wsName);
    if (!ws) {
      log(`Workspace ${wsName} not found`);
      continue;
    }

    const windows = findAllWindows(ws);
    if (windows.length !== applications.length) {
      log(`Workspace ${wsName}: ${windows.length} windows, ${applications.length} in config (skip layout)`);
      continue;
    }

    log(`Initial workspace structure: ${(ws.children ?? []).length} direct children`);
    await buildTiledTree(client, ws, workspace, windows, { log });
    await delay(LAYOUT_DELAY_MS);

    const { workspaces: workspacesAfterLayout } = await client.queryWorkspaces();
    const wsAfterLayout = workspacesAfterLayout?.find((w) => w?.name === wsName);
    if (wsAfterLayout) {
      await applyTilingSizes(client, wsName, workspace, wsAfterLayout, { log });
      await delay(LAYOUT_DELAY_MS);
    }
  }

  const originalWorkspace = opts.originalWorkspace ?? null;
  if (originalWorkspace) {
    log(`Focusing back to workspace ${originalWorkspace}`);
    await client.runCommand('focus --workspace ' + originalWorkspace);
    await delay(LAYOUT_DELAY_MS);
  }

  log('Layout applied.');
}

/**
 * Extract structure from config node (workspace or split): type, tiling_direction, children (structure only).
 */
function configStructure(node) {
  if (!node) return null;
  if (node.type === 'window') return { type: 'window' };
  if (node.type === 'split') {
    return {
      type: 'split',
      tiling_direction: (node.tiling_direction ?? node.tilingDirection ?? 'vertical').toLowerCase(),
      children: (node.children ?? []).map(configStructure).filter(Boolean),
    };
  }
  if (node.type === 'workspace' || (node.name && node.children)) {
    return {
      type: 'workspace',
      tiling_direction: (node.tiling_direction ?? node.tilingDirection ?? 'horizontal').toLowerCase(),
      children: (node.children ?? []).map(configStructure).filter(Boolean),
    };
  }
  return null;
}

/**
 * Extract structure from query node (workspace or split from GlazeWM): type, tilingDirection, children.
 */
function queryStructure(node) {
  if (!node) return null;
  if (node.type === 'window') return { type: 'window' };
  if (node.type === 'split') {
    return {
      type: 'split',
      tiling_direction: (node.tilingDirection ?? 'vertical').toLowerCase(),
      children: (node.children ?? []).map(queryStructure).filter(Boolean),
    };
  }
  if (node.type === 'workspace') {
    return {
      type: 'workspace',
      tiling_direction: (node.tilingDirection ?? 'horizontal').toLowerCase(),
      children: (node.children ?? []).map(queryStructure).filter(Boolean),
    };
  }
  return null;
}

/**
 * Compare two structures (from config vs query). Exact match: same types, same tiling_direction, same child count and structure.
 * @returns {{ match: boolean, path: string, message?: string }}
 */
function compareStructure(want, actual, path = '') {
  if (!want && !actual) return { match: true, path };
  if (!want) return { match: false, path, message: `config has no node at ${path}, actual has ${actual?.type}` };
  if (!actual) return { match: false, path, message: `actual has no node at ${path}, config expects ${want?.type}` };
  if (want.type !== actual.type) {
    return { match: false, path, message: `type mismatch: want ${want.type}, actual ${actual.type}` };
  }
  if (want.tiling_direction !== undefined && actual.tiling_direction !== undefined) {
    if (want.tiling_direction !== actual.tiling_direction) {
      return { match: false, path, message: `tiling_direction mismatch: want ${want.tiling_direction}, actual ${actual.tiling_direction}` };
    }
  }
  const wantChildren = want.children ?? [];
  const actualChildren = actual.children ?? [];
  if (wantChildren.length !== actualChildren.length) {
    return { match: false, path, message: `children count: want ${wantChildren.length}, actual ${actualChildren.length}` };
  }
  for (let i = 0; i < wantChildren.length; i++) {
    const result = compareStructure(wantChildren[i], actualChildren[i], path ? `${path}.children[${i}]` : `children[${i}]`);
    if (!result.match) return result;
  }
  return { match: true, path };
}

/**
 * Compare tiling_size ratios at each container. Returns first mismatch if any.
 */
function compareRatios(want, actual, path = '') {
  const wantChildren = want?.children ?? [];
  const actualChildren = actual?.children ?? [];
  if (wantChildren.length === 0 || wantChildren.length !== actualChildren.length) return { match: true, path };

  const total = actualChildren.reduce((s, c) => s + (c?.tilingSize ?? 0), 0) || 1;
  for (let i = 0; i < wantChildren.length; i++) {
    const target = wantChildren[i]?.tilingSize ?? wantChildren[i]?.tiling_size ?? 0.5;
    const current = (actualChildren[i]?.tilingSize ?? 0) / total;
    const err = Math.abs(target - current);
    if (err > TOLERANCE_RATIO) {
      return { match: false, path: path ? `${path}.children[${i}]` : `children[${i}]`, message: `ratio: want ${(target * 100).toFixed(2)}%, got ${(current * 100).toFixed(2)}%` };
    }
  }
  for (let i = 0; i < wantChildren.length; i++) {
    const result = compareRatios(wantChildren[i], actualChildren[i], path ? `${path}.children[${i}]` : `children[${i}]`);
    if (!result.match) return result;
  }
  return { match: true, path };
}

/**
 * Verify layout: structure + tiling_direction (exact) and tiling_size ratios (within TOLERANCE_RATIO).
 */
export async function runVerifyLayout(client, config, opts = {}) {
  const log = opts.log ?? (() => {});

  log('--- Verifying layout (structure + tiling_direction + ratios) ---');

  const { workspaces } = await client.queryWorkspaces();
  let allStructureMatch = true;
  let allRatioMatch = true;

  for (const workspace of config.workspaces ?? []) {
    const wsName = workspace?.name;
    if (!wsName) continue;

    const ws = workspaces?.find((w) => w?.name === wsName);
    if (!ws) {
      log(`Workspace ${wsName}: not found`);
      allStructureMatch = false;
      allRatioMatch = false;
      continue;
    }

    const wantStruct = configStructure(workspace);
    const actualStruct = queryStructure(ws);
    const structResult = compareStructure(wantStruct, actualStruct, wsName);

    if (structResult.match) {
      log(`Workspace ${wsName}: structure + tiling_direction MATCH`);
    } else {
      log(`Workspace ${wsName}: structure MISMATCH at ${structResult.path}: ${structResult.message}`);
      allStructureMatch = false;
    }

    const ratioResult = compareRatios(workspace, ws, wsName);
    if (ratioResult.match) {
      log(`Workspace ${wsName}: ratios MATCH (within ${(TOLERANCE_RATIO * 100).toFixed(2)}%)`);
    } else {
      log(`Workspace ${wsName}: ratio MISMATCH at ${ratioResult.path}: ${ratioResult.message}`);
      allRatioMatch = false;
    }
  }
  const allMatch = allStructureMatch && allRatioMatch;
  log(allMatch ? 'Verify done: structure and ratios match config.' : 'Verify done: some mismatches.');
  return allMatch;
}
