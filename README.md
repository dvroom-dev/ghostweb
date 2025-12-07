# web-tui

A tiny launcher for serving interactive CLIs/TUIs through the browser with [ghostty-web](https://github.com/coder/ghostty-web).

## Install

```bash
bun install
```

## Usage

Start any command inside a browser terminal (default port `8080`):

```bash
bun run webify -- -- bash
```

You can also omit the separator if you’re not passing flags:

```bash
webify bash -lc "echo hi"
```

Pick a different port and pass arguments:

```bash
bun run webify -- --port 8081 -- claude --dangerously-skip-permissions
```

Flags:

- `--port, -p <number>`: port for the ghostty-web server (default: `8080`)
- `--no-open`: skip auto-opening the browser
- `-- <command> [args...]`: command to launch inside the PTY

What it does:

- Spawns the provided command inside a real PTY (via a tiny Python helper)
- Serves a minimal ghostty-web client (HTML + JS) with live resize support
- Opens your browser pointed at the server (unless `--no-open`)

## Notes

- Requires Bun v1.3+ and a POSIX-like environment for PTY support.
- Python 3 must be available (used to host the PTY without native Node addons).
- The UI will resize the remote PTY to match the browser window automatically.
