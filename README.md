# ghostweb

A tiny launcher for serving interactive CLIs/TUIs through the browser with [ghostty-web](https://github.com/coder/ghostty-web).

## Install

```bash
npm i -g @dvroom-dev/ghostweb
```

## Usage

Start any command inside a browser terminal (default port `8080`):

```bash
ghostweb -- bash
```

You can also omit the separator if you're not passing flags:

```bash
ghostweb bash -lc "echo hi"
```

Pick a different port and pass arguments:

```bash
ghostweb --port 8081 -- claude --dangerously-skip-permissions
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

## Requirements

- **Node.js 18+** (or Bun)
- **Python 3** (used for PTY support without native addons)
- POSIX-like environment (Linux, macOS, WSL)

## Development

Building and testing requires [Bun](https://bun.sh):

```bash
bun install
bun test
bun run build
```

## Build a standalone binary

You can produce a self-contained executable that embeds the ghostty-web client and Python PTY helper:

```bash
bun build index.ts --compile --outfile ghostweb
./ghostweb --port 8080 -- bash
```

Note: The compiled binary still requires Python 3 on the target machine for PTY support.
