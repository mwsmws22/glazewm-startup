#!/usr/bin/env node
/**
 * CLI: Parse GlazeWM workspace JSON and write config.json.
 *
 * Usage:
 *   node src/cli-parse.js <workspace_json_file> <workspace_number> [<workspace_number> ...]
 *   node src/cli-parse.js workspace.json 2
 *   node src/cli-parse.js workspace.json 2 3 --output config.json
 *
 * Options:
 *   --output, -o   Output file (default: config.json)
 *   --verbose, -v  Log what we're doing
 */

import { parseWorkspaceFromFile } from './parseWorkspace.js';
import { writeFile, rename, unlink } from 'fs/promises';

const args = process.argv.slice(2);
let outputPath = 'config.json';
let verbose = false;
const positional = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--output' || a === '-o') {
    outputPath = args[++i] ?? 'config.json';
  } else if (a === '--verbose' || a === '-v') {
    verbose = true;
  } else if (!a.startsWith('-')) {
    positional.push(a);
  }
}

if (positional.length < 2) {
  console.error('Usage: node cli-parse.js <workspace_json_file> <workspace_number> [<workspace_number> ...] [--output config.json]');
  process.exit(1);
}

const [workspaceJsonPath, ...workspaceNumbers] = positional;

async function main() {
  if (verbose) {
    console.log(`Parsing: ${workspaceJsonPath}`);
    console.log(`Workspaces: ${workspaceNumbers.join(', ')}`);
    console.log(`Output: ${outputPath}`);
  }

  const config = await parseWorkspaceFromFile(workspaceJsonPath, workspaceNumbers);
  const json = JSON.stringify(config, null, 2);
  const tmpPath = outputPath + '.tmp';
  await writeFile(tmpPath, json, 'utf-8');
  try {
    await unlink(outputPath).catch((err) => { if (err?.code !== 'ENOENT') throw err; });
    await rename(tmpPath, outputPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
  console.log(`Configuration saved to '${outputPath}'`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
