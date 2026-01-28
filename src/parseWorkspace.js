/**
 * GlazeWM Workspace Parser (JS)
 *
 * Parses GlazeWM "query workspaces" JSON and produces a reduced config: same field style
 * (camelCase) as workspace.json, just fewer fields. No settings (delays etc. are constants in code).
 *
 * Input: workspace JSON (data.workspaces).
 * Output: { workspaces: [{ name, tilingDirection, children }] }.
 */

/**
 * Recursively find all windows in a container (workspace or nested split container).
 * @param {object} container - Workspace or container node from GlazeWM JSON
 * @returns {object[]} - List of window objects
 */
export function findAllWindows(container) {
  const windows = [];

  if (container?.type === 'window') {
    windows.push(container);
    return windows;
  }

  const children = container?.children ?? [];
  for (const child of children) {
    if (child?.type === 'window') {
      windows.push(child);
    } else if (child?.children) {
      windows.push(...findAllWindows(child));
    }
  }

  return windows;
}

/**
 * Convert a GlazeWM container (split or window) to config node. Matches workspace.json style (camelCase).
 * Omits empty args. Output is a reduced subset of the query node.
 */
function containerToConfigNode(node) {
  if (node?.type === 'window') {
    const out = {
      type: 'window',
      title: node.title ?? '',
      path: node.processName ? 'FILL ME IN' : '',
      tilingSize: node.tilingSize ?? 1,
    };
    if (Array.isArray(node.args) && node.args.length > 0) out.args = node.args;
    return out;
  }
  if (node?.type === 'split') {
    return {
      type: 'split',
      tilingDirection: node.tilingDirection ?? 'horizontal',
      tilingSize: node.tilingSize ?? 1,
      children: (node.children ?? []).map(containerToConfigNode),
    };
  }
  return null;
}

/**
 * Flatten workspace config tree to list of window nodes (depth-first) for open order.
 * @param {object} workspaceConfig - Workspace with children[] (split or window)
 * @returns {object[]} - List of window nodes { type: 'window', title, path?, tilingSize }
 */
export function flattenApplications(workspaceConfig) {
  const list = [];
  function walk(nodes) {
    for (const n of nodes ?? []) {
      if (n?.type === 'window') {
        list.push(n);
      } else if (n?.type === 'split' && Array.isArray(n.children)) {
        walk(n.children);
      }
    }
  }
  walk(workspaceConfig?.children ?? []);
  return list;
}

/**
 * Parse workspace JSON and extract the specified workspaces into tree config format.
 *
 * @param {object} workspaceJson - Parsed JSON from "glazewm query workspaces" (must have data.workspaces)
 * @param {string[]} workspaceNumbers - Workspace names to extract (e.g. ['2', '3'])
 * @returns {object} - Config { workspaces: [{ name, tilingDirection, children }] }
 */
export function parseWorkspace(workspaceJson, workspaceNumbers) {
  if (!workspaceJson?.data?.workspaces) {
    throw new Error("Invalid workspace JSON format (missing 'data.workspaces')");
  }

  const workspaces = workspaceJson.data.workspaces;

  const config = { workspaces: [] };

  const foundWorkspaces = [];
  for (const num of workspaceNumbers) {
    const ws = workspaces.find((w) => w?.name === num);
    if (ws) {
      foundWorkspaces.push(ws);
    } else {
      console.warn(`Warning: Workspace '${num}' not found in the data`);
    }
  }

  if (foundWorkspaces.length === 0) {
    throw new Error('None of the specified workspaces were found');
  }

  for (const workspace of foundWorkspaces) {
    const children = (workspace.children ?? []).map(containerToConfigNode).filter(Boolean);
    config.workspaces.push({
      name: workspace.name ?? 'Unknown',
      tilingDirection: workspace.tilingDirection ?? 'horizontal',
      children,
    });
  }

  return config;
}

/**
 * Read and parse a workspace JSON file, then run parseWorkspace.
 *
 * @param {string} workspaceJsonPath - Path to the workspace JSON file
 * @param {string[]} workspaceNumbers - Workspace names to extract
 * @returns {Promise<object>} - Config object
 */
export async function parseWorkspaceFromFile(workspaceJsonPath, workspaceNumbers) {
  const fs = await import('fs/promises');
  let raw;
  try {
    raw = await fs.readFile(workspaceJsonPath, { encoding: 'utf-8' });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(`File '${workspaceJsonPath}' not found`);
    }
    throw new Error(`Error reading file: ${e.message}`);
  }

  let workspaceJson;
  try {
    workspaceJson = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Error parsing JSON: ${e.message}`);
  }

  return parseWorkspace(workspaceJson, workspaceNumbers);
}
