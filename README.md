# ghostweb

A tiny launcher for serving interactive CLIs/TUIs through the browser with [ghostty-web](https://github.com/coder/ghostty-web).

## Install

```bash
bun install
```

## Usage

Start any command inside a browser terminal (default port `8080`):

```bash
bun run ghostweb -- -- bash
```

You can also omit the separator if you’re not passing flags:

```bash
ghostweb bash -lc "echo hi"
```

Pick a different port and pass arguments:

```bash
bun run ghostweb -- --port 8081 -- claude --dangerously-skip-permissions
```

Flags:

- `--port, -p <number>`: port for the ghostty-web server (default: `8080`)
- `--no-open`: skip auto-opening the browser
- `-- <command> [args...]`: command to launch inside the PTY

What it does:

- Spawns the provided command inside a real PTY (via a tiny Python helper)
- Serves a minimal ghostty-web client (HTML + JS) with live resize support
- Auto-reconnects the browser if the connection drops and the server returns
- Opens your browser pointed at the server (unless `--no-open`)

## Notes

- Requires Bun v1.3+ and a POSIX-like environment for PTY support.
- Python 3 must be available (used to host the PTY without native Node addons).
- The UI will resize the remote PTY to match the browser window automatically.

## Build a standalone binary

You can produce a self-contained executable that embeds the ghostty-web client and Python PTY helper:

```bash
bun build index.ts --compile --outfile ghostweb
./ghostweb --port 8080 -- bash
```

## Distribution recommendations

Two easy ways to ship this:

- **Publish as an npm package** (works with npm, pnpm, yarn, bun):
  - Keep `bin.ghostweb` pointing at `index.ts` with the Bun shebang.
  - Run `npm publish` (or `bun publish`) from the project root.
  - Users install globally with `npm i -g ghostweb` or `bun install --global ghostweb` and run `ghostweb`.
- **Attach prebuilt binaries** for convenience:
  - Build per target: `bun build index.ts --compile --outfile ghostweb-linux-x64` (and similarly for other platforms via your CI matrix).
  - Upload the artifacts (e.g., GitHub Releases) and document the Python 3 requirement for the PTY proxy.

Notes when distributing:
- The Bun-built binary does not require Bun on the target machine but still needs Python 3 available for the PTY proxy.
- `ghostty-web` assets are bundled via the local `node_modules/ghostty-web/dist` files when you build.
