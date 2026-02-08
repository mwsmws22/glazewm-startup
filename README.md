# GlazeWM Startup (JS)

JavaScript/Node version of the GlazeWM startup tool. Uses the [glazewm-js](https://github.com/glzr-io/glazewm-js) library for IPC (clear, and future startup steps).

## Step 1: Parse workspace

Parses the output of `glazewm query workspaces` (or the glazewm-js equivalent) and produces a minimal `config.json` that defines which workspaces and applications to open and how they are laid out.

### Usage

```bash
node cli/cli-parse.js workspace.json 2 --output config.json
node cli/cli-parse.js workspace.json 2 3 -o config.json -v
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
  - **.exe path** — launched directly (link/args apply). If `fullscreen: true`, the script waits for the window to open, focuses it, then sends F11 (no kiosk mode).
  - **AUMID** (string containing `!`) — launched via `explorer.exe shell:AppsFolder\<AUMID>`.
  - **Exact Start Menu name** (e.g. `"WhatsApp"`, `"Phone Link"`) — on Windows only; resolved once per run via `Get-StartApps | ConvertTo-Json`, exact match only, then launched via shell:AppsFolder. No PowerShell window is shown.
- Open order = depth-first flatten of `children` (see `flattenApplications()`).
- No `settings` in config; delays are constants in code (e.g. `WAIT_TIME_BETWEEN_APPS_MS` in `openWorkspaces.js`).

### Tests

```bash
npm test
```

Runs Node built-in tests; expects `workspace.json` in the project root.

## Startup (phases: clear → open → layout → fullscreen)

One CLI runs **phases** in order. Phases: **clear** (close all windows), **open** (spawn apps per config), **layout** (tile and resize to match config), **fullscreen** (F11 for windows with `fullscreen: true`).

**Requires:** GlazeWM running, and `config.json` (or path via `--config`).

### Usage

Run all phases (default):

```bash
npm run startup
node cli/cli-startup.js [--config config.json]
```

Run only specific phases (positional args):

```bash
npm run clear                              # clear only
npm run fullscreen 2                       # fullscreen phase, workspace 2 only
node cli/cli-startup.js clear              # clear only
node cli/cli-startup.js fullscreen 2       # fullscreen workspace 2
node cli/cli-startup.js clear open        # clear then open
```

### Layout (code)

- **startup.js** – Load config, create client; runs only requested phases: `runClearPhase`, `runOpenPhase`, `runLayoutPhase` + `runVerifyLayout`, `runFullscreenPhase` (all workspaces or single workspace via opts.workspaceName).
- **clearWorkspaces.js** – Clear phase.
- **openWorkspaces.js** – Open phase.
- **applyLayout.js** – Layout phase. Ref: [GlazeWM cheatsheet](https://nulldocs.com/windows/glazewm-cheatsheet/).
- **cli/cli-startup.js** – Single CLI; pass phases as positionals (e.g. `clear`, `fullscreen 2`); npm scripts `startup`, `clear`, `fullscreen` call it with the right phases.

## Requirements

- Node 18+ (for `node:test` and ES modules)
- GlazeWM running (for clear/startup)
- `npm install` (glazewm, ws)

## Next steps (optional)

- Fallback kill logic (e.g. taskkill) for apps that still don’t close after focus-then-close.
- Fine-tune `tiling_size` with more resize iterations or GlazeWM config if needed.
