#!/usr/bin/env node
/**
 * CLI: Run GlazeWM startup chain (clear -> open).
 *
 * Usage:
 *   node src/cli-startup.js [--config config.json]
 *
 * Requires: GlazeWM running, config.json (or path via --config).
 */

import { startupFromConfig } from './startup.js';

const args = process.argv.slice(2);
let configPath = 'config.json';
let skipLayout = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' || args[i] === '-c') {
    configPath = args[++i] ?? 'config.json';
  } else if (args[i] === '--no-layout') {
    skipLayout = true;
  }
}

startupFromConfig(configPath, { skipLayout }).catch((err) => {
  const msg = typeof err === 'string' ? err : err?.message ?? String(err);
  console.error(msg);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
