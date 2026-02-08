/**
 * GlazeWM Startup
 *
 * Main chain: clear workspaces -> open applications.
 * Loads config, connects client, runs clear phase then open phase.
 */

import { WmClient } from 'glazewm';
import { readFile } from 'fs/promises';
import { runClearPhase } from './clearWorkspaces.js';
import { runWithWorkspaceRestore } from './glazeCommon.js';
import { runOpenPhase } from './openWorkspaces.js';
import { runLayoutPhase, runVerifyLayout } from './applyLayout.js';

const CONNECT_DELAY_MS = 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load config from path.
 * @param {string} configPath - Path to config.json
 * @returns {Promise<object>} - Config with workspaces[]
 */
export async function loadConfig(configPath) {
  const raw = await readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Run the full startup chain: clear -> open.
 * Loads config, creates client, runs runClearPhase then runOpenPhase.
 *
 * @param {string} configPath - Path to config.json (default: config.json)
 * @param {{ log: (msg: string) => void }} opts
 */
export async function startupFromConfig(configPath = 'config.json', opts = {}) {
  const log = opts.log ?? ((msg) => console.log(msg));
  const skipLayout = opts.skipLayout === true;

  const config = await loadConfig(configPath);

  if (!(config?.workspaces?.length > 0)) {
    log('No workspaces defined in config');
    return;
  }

  const client = new WmClient();
  client.onConnect(() => log('Connected to GlazeWM'));
  client.onDisconnect(() => log('Disconnected from GlazeWM'));
  client.onError((err) => log(`GlazeWM error: ${err}`));

  await delay(CONNECT_DELAY_MS);
  log('Querying workspaces and windows...');

  await runWithWorkspaceRestore(client, { log }, async (client, opts) => {
    await runClearPhase(client, config, { log });
    await runOpenPhase(client, config, opts);
    if (!skipLayout) {
      await runLayoutPhase(client, config, opts);
      await runVerifyLayout(client, config, { log });
    } else {
      log('Skipping layout (--no-layout)');
    }
  });
}
