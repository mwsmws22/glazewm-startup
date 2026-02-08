# GlazeWM Startup (JS)

JavaScript/Node version of the GlazeWM startup tool. Uses the [glazewm-js](https://github.com/glzr-io/glazewm-js) library for IPC (clear, and future startup steps).

## Step 1: Parse workspace

Parses the output of `glazewm query workspaces` (or the glazewm-js equivalent) and produces a minimal `config.json` that defines which workspaces and applications to open and how they are laid out.

### Usage

```bash
node src/cli-parse.js workspace.json 2 --output config.json
node src/cli-parse.js workspace.json 2 3 -o config.json -v
```

Or via npm:

```bash
npm run parse -- workspace.json 2 -o config.json
```

### Output format

`config.json` with workspace/split/window **tree** (no pixel position/size):

- `workspaces[]`: `name`, `tilingDirection`, `children[]` (camelCase, same style as workspace query).
- Each child is either:
  - **split**: `type: "split"`, `tilingDirection`, `tilingSize` (ratio 0–1), `children[]`
  - **window**: `type: "window"`, `title`, `application`, `tilingSize`; optional `args`, `link`, `fullscreen`.
- **`application`** (required for launch): one of
  - **.exe path** — launched directly (link/fullscreen/args apply; e.g. Firefox with URL).
  - **AUMID** (string containing `!`) — launched via `explorer.exe shell:AppsFolder\<AUMID>`.
  - **Exact Start Menu name** (e.g. `"WhatsApp"`, `"Phone Link"`) — on Windows only; resolved once per run via `Get-StartApps | ConvertTo-Json`, exact match only, then launched via shell:AppsFolder. No PowerShell window is shown.
- Open order = depth-first flatten of `children` (see `flattenApplications()`).
- No `settings` in config; delays are constants in code (e.g. `WAIT_TIME_BETWEEN_APPS_MS` in `openWorkspaces.js`).

### Tests

```bash
npm test
```

Runs Node built-in tests; expects `workspace.json` in the project root.

## Startup (clear → open → layout)

Main chain: **clear** workspaces (close all windows, with focus-then-close for stubborn apps), **open** applications (focus workspace, spawn apps in depth-first order, wait for windows), then **layout** (tiled only: set workspace tiling direction, use **move** + **toggle-tiling-direction** to build the split tree from config, then optional **resize** to approximate `tiling_size` ratios).

**Requires:** GlazeWM running, and `config.json` (or path via `--config`).

### Usage

```bash
node src/cli-startup.js
node src/cli-startup.js --config config.json
```

Or via npm:

```bash
npm run startup
npm run startup -- --config config.json
```

### Clear only (no open)

For testing or when you only want to close windows:

```bash
npm run clear
node src/cli-clear.js --config config.json
```

### Layout (code)

- **startup.js** – Main chain: `loadConfig`, create client, `runClearPhase` → `runOpenPhase` → `runLayoutPhase`, exit.
- **clearWorkspaces.js** – Clear phase: `runClearPhase`, `clearWorkspace`, `clearWorkspaceWithFocus`, `getCurrentWorkspace`.
- **openWorkspaces.js** – Open phase: `runOpenPhase` (focus workspace, launch each `application` as exe / AUMID / or by name via Get-StartApps once per run, wait for windows via WINDOW_MANAGED).
- **applyLayout.js** – Layout phase: `runLayoutPhase` (set workspace tiling direction, then `size --width/height` and `set-tiling`/`set-floating` per window to match config). Windows matched to config by index. Ref: [GlazeWM cheatsheet](https://nulldocs.com/windows/glazewm-cheatsheet/).
- **cli-startup.js** – CLI entry for full chain; **cli-clear.js** – CLI for clear-only.

## Requirements

- Node 18+ (for `node:test` and ES modules)
- GlazeWM running (for clear/startup)
- `npm install` (glazewm, ws)

## Next steps (optional)

- Fallback kill logic (e.g. taskkill) for apps that still don’t close after focus-then-close.
- Fine-tune `tiling_size` with more resize iterations or GlazeWM config if needed.
