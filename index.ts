#!/usr/bin/env bun
import type { ServerWebSocket } from "bun";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type CliOptions = {
  port: number;
  command: string[];
  autoOpen: boolean;
};

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

type ServerMessage =
  | { type: "output"; data: string }
  | { type: "exit"; code?: number; signal?: number };

const encoder = new TextEncoder();
const lineDecoder = new TextDecoder();
const messageDecoder = new TextDecoder();
const outputDecoder = new TextDecoder();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_SOURCE = `#!/usr/bin/env python3
\"\"\"
Lightweight PTY proxy used by the ghostweb CLI.

The script spawns a command inside a pseudo-terminal and proxies
stdin/stdout over newline-delimited JSON messages. Payloads that
represent terminal data are base64-encoded to keep the stream text-safe.
\"\"\"

import base64
import json
import os
import select
import struct
import sys
import termios
import fcntl


def set_winsize(fd: int, rows: int, cols: int) -> None:
  \"\"\"Update the PTY window size.\"\"\"
  fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack(\"HHHH\", rows, cols, 0, 0))


def send(message: dict) -> None:
  sys.stdout.write(json.dumps(message) + \"\\n\")
  sys.stdout.flush()


def main() -> int:
  if len(sys.argv) < 2:
    sys.stderr.write(\"pty-proxy: missing command to execute\\n\")
    return 1

  cmd = sys.argv[1:]
  if cmd and cmd[0] == \"--\":
    cmd = cmd[1:]
  if not cmd:
    sys.stderr.write(\"pty-proxy: missing command after '--'\\n\")
    return 1

  pid, master_fd = os.forkpty()
  if pid == 0:
    try:
      os.execvp(cmd[0], cmd)
    except Exception as exc:  # pragma: no cover - best effort error path
      sys.stderr.write(f\"exec failed: {exc}\\n\")
      os._exit(1)

  buffer = \"\"

  try:
    while True:
      readable, _, _ = select.select([master_fd, sys.stdin], [], [])

      if master_fd in readable:
        try:
          data = os.read(master_fd, 8192)
        except OSError:
          data = b\"\"
        if not data:
          break
        send({\"type\": \"output\", \"data\": base64.b64encode(data).decode(\"ascii\")})

      if sys.stdin in readable:
        line = sys.stdin.readline()
        if not line:
          break
        try:
          message = json.loads(line)
        except json.JSONDecodeError:
          continue

        m_type = message.get(\"type\")
        if m_type == \"input\":
          payload = message.get(\"data\", \"\")
          if isinstance(payload, str):
            try:
              os.write(master_fd, base64.b64decode(payload))
            except Exception:
              pass
        elif m_type == \"resize\":
          cols = int(message.get(\"cols\", 0) or 0)
          rows = int(message.get(\"rows\", 0) or 0)
          if cols > 0 and rows > 0:
            try:
              set_winsize(master_fd, rows, cols)
            except Exception:
              pass
  finally:
    _, status = os.waitpid(pid, 0)
    code = None
    signal_num = None
    if os.WIFEXITED(status):
      code = os.WEXITSTATUS(status)
    elif os.WIFSIGNALED(status):
      signal_num = os.WTERMSIG(status)
    send({\"type\": \"exit\", \"code\": code, \"signal\": signal_num})
    try:
      os.close(master_fd)
    except Exception:
      pass

  return 0


if __name__ == \"__main__\":
  sys.exit(main())
`;

function usage(code: number = 1): never {
  console.log(
    [
      "Usage: ghostweb [--port <port>] [--no-open] -- <command> [args...]",
      "",
      "Examples:",
      "  ghostweb -- bash",
      "  ghostweb --port 8081 -- claude --dangerously-skip-permissions",
    ].join("\n"),
  );
  process.exit(code);
}

function parseArgs(argv: string[]): CliOptions {
  let port = 8080;
  let autoOpen = true;
  const command: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      command.push(...argv.slice(i + 1));
      break;
    }

    switch (arg) {
      case "--port":
      case "-p": {
        const next = argv[i + 1];
        if (!next) {
          console.error("Missing value after --port");
          usage();
        }
        port = Number(next);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          console.error(`Invalid port: ${next}`);
          usage();
        }
        i += 1; // skip port value
        break;
      }
      case "--no-open": {
        autoOpen = false;
        break;
      }
      case "--help":
      case "-h": {
        usage(0);
        break;
      }
      default: {
        // Treat the first unknown token as the start of the command, so
        // `ghostweb cmd args...` works without requiring `--`.
        command.push(...argv.slice(i));
        i = argv.length;
        break;
      }
    }
  }

  if (command.length === 0) {
    console.error("No command provided.");
    usage();
  }

  return { port, command, autoOpen };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildClientHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: radial-gradient(circle at 20% 20%, rgba(92, 197, 255, 0.08), transparent 25%),
               radial-gradient(circle at 80% 0%, rgba(255, 166, 81, 0.12), transparent 30%),
               #0c0f1a;
        --panel: rgba(255, 255, 255, 0.04);
        --accent: #5fc3e8;
        --fg: #e6edf3;
        --muted: #8aa0b7;
        --error: #ff6b6b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "JetBrains Mono", "Fira Code", "SFMono-Regular", "Menlo", "Consolas", monospace;
        min-height: 100vh;
        background: var(--bg);
        color: var(--fg);
        display: flex;
        align-items: stretch;
        justify-content: center;
        padding: 16px;
      }
      main {
        width: min(1200px, 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: var(--panel);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 14px;
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(6px);
        padding: 12px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.04);
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--accent), #8ee1ff);
        box-shadow: 0 0 16px rgba(95, 195, 232, 0.7);
      }
      .title {
        font-weight: 700;
        letter-spacing: 0.6px;
      }
      #status {
        margin-left: auto;
        font-size: 0.95rem;
        color: var(--muted);
        display: flex;
        gap: 6px;
        align-items: center;
      }
      #status .pill {
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      #terminal {
        flex: 1;
        min-height: calc(100vh - 140px);
        background: #05070d;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        position: relative;
        overflow: hidden;
      }
      canvas {
        width: 100% !important;
        height: 100% !important;
        display: block;
      }
      .hint {
        font-size: 0.9rem;
        color: var(--muted);
        padding: 4px 10px 10px 10px;
      }
      @media (max-width: 700px) {
        body { padding: 8px; }
        main { padding: 10px; }
        #terminal { min-height: 70vh; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="dot" aria-hidden="true"></div>
        <div class="title">ghostweb · ${title}</div>
        <div id="status"><span class="pill">starting</span></div>
      </header>
      <div id="terminal"></div>
      <div class="hint">Resize your window freely — the terminal auto-fits and resizes the remote PTY.</div>
    </main>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

const APP_JS = `import { init, Terminal, FitAddon } from '/ghostty-web.js';

const status = document.getElementById('status');
const terminalHost = document.getElementById('terminal');
if (!status || !terminalHost) {
  throw new Error('UI failed to load');
}

function setStatus(text, kind = 'info') {
  status.innerHTML = '<span class="pill">' + text + '</span>';
  const pill = status.querySelector('.pill');
  if (kind === 'error' && pill) pill.style.color = 'var(--error)';
}

await init();

const fitAddon = new FitAddon();
const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  theme: {
    background: '#05070d',
    foreground: '#e6edf3',
    cursor: '#8ee1ff',
    selectionBackground: '#19324b',
  },
});

term.loadAddon(fitAddon);
term.open(terminalHost);
fitAddon.fit();
term.focus();

const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
let ws;
let reconnectDelay = 500;
const maxReconnectDelay = 5000;
let reconnectTimer = null;

const send = (payload) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
};

const scheduleReconnect = () => {
  if (reconnectTimer) return;
  setStatus('reconnecting...');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, maxReconnectDelay);
};

function connect() {
  const socket = new WebSocket(wsProtocol + '://' + location.host + '/ws');
  socket.binaryType = 'arraybuffer';
  ws = socket;

  socket.addEventListener('open', () => {
    setStatus('connected');
    reconnectDelay = 500;
    send({ type: 'resize', cols: term.cols, rows: term.rows });
  });

  socket.addEventListener('close', () => scheduleReconnect());
  socket.addEventListener('error', () => scheduleReconnect());

  socket.addEventListener('message', (event) => {
    if (socket !== ws) return; // ignore stale sockets
    const raw = typeof event.data === 'string'
      ? event.data
      : new TextDecoder().decode(event.data);
    const message = JSON.parse(raw);
    if (message.type === 'output') {
      term.write(message.data);
    } else if (message.type === 'exit') {
      const code = message.code ?? '';
      const signal = message.signal != null ? ' signal ' + message.signal : '';
      term.write('\\r\\n\\u001b[38;2;255;166;81m[process exited with code ' + code + signal + ']\\u001b[0m\\r\\n');
      setStatus('process ended', 'error');
    }
  });
}

connect();

term.onData((data) => send({ type: 'input', data }));
term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));

let resizeTimer;
const reflow = () => {
  fitAddon.fit();
  send({ type: 'resize', cols: term.cols, rows: term.rows });
};

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(reflow, 80);
});

reflow();
`;

type ProxyEvent =
  | { type: "output"; data: string }
  | { type: "exit"; code?: number | null; signal?: number | null };

type PtyProxy = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  stop: () => void;
};

function ensureProxyScript(): string {
  const projectPath = join(__dirname, "pty-proxy.py");
  if (existsSync(projectPath)) {
    return projectPath;
  }

  const cacheBase = Bun.env.XDG_CACHE_HOME ?? (Bun.env.HOME ? join(Bun.env.HOME, ".cache") : "/tmp");
  const targetDir = join(cacheBase, "ghostweb");
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch {
    // best effort; fall through
  }
  const targetPath = join(targetDir, "pty-proxy.py");
  try {
    if (!existsSync(targetPath)) {
      writeFileSync(targetPath, PROXY_SOURCE, "utf8");
    }
    return targetPath;
  } catch {
    // fall through to tmp fallback
  }

  const tmpPath = join("/tmp", "ghostweb-pty-proxy.py");
  try {
    writeFileSync(tmpPath, PROXY_SOURCE, "utf8");
    return tmpPath;
  } catch (error) {
    throw new Error(`Failed to create PTY proxy script: ${String(error)}`);
  }
}

function startPtyProxy(command: string[], onEvent: (event: ProxyEvent) => void): PtyProxy {
  const proxyScript = ensureProxyScript();
  const subprocess = Bun.spawn({
    cmd: ["python3", "-u", proxyScript, "--", ...command],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      TERM: process.env.TERM ?? "xterm-256color",
    },
  });

  const { stdin, stdout, stderr } = subprocess;
  if (!stdin || !stdout) {
    throw new Error("Failed to start PTY proxy (missing pipes).");
  }

  let exitSent = false;

  const send = (payload: object) => {
    if (typeof stdin.write === "function") {
      stdin.write(`${JSON.stringify(payload)}\n`);
    }
  };

  const forwardOutput = async () => {
    const reader = stdout.getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += lineDecoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line) as ProxyEvent;
          onEvent(event);
          if (event.type === "exit") {
            exitSent = true;
          }
        } catch (error) {
          console.error("Failed to parse PTY proxy message:", error, line);
        }
      }
    }
  };

  forwardOutput().catch((error) => console.error("PTY proxy stream failed:", error));

  if (stderr) {
    (async () => {
      const reader = stderr.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const message = lineDecoder.decode(value);
        if (message.trim().length > 0) {
          console.error("[pty-proxy]", message.trim());
        }
      }
    })().catch((error) => console.error("PTY proxy stderr failed:", error));
  }

  subprocess.exited
    .then(() => {
      if (!exitSent) {
        onEvent({ type: "exit", code: subprocess.exitCode, signal: null });
      }
    })
    .catch((error) => console.error("Proxy exit error:", error));

  return {
    write(data: string) {
      send({ type: "input", data: Buffer.from(data, "utf-8").toString("base64") });
    },
    resize(cols: number, rows: number) {
      send({ type: "resize", cols, rows });
    },
    stop() {
      try {
        subprocess.kill();
      } catch {
        // ignore
      }
    },
  };
}

const args = parseArgs(process.argv.slice(2));

function findGhosttyDist(): string {
  const possiblePaths = [
    // Development: running from source
    join(__dirname, "node_modules", "ghostty-web", "dist"),
    // Built: cli.js in dist/, node_modules at package root
    join(__dirname, "..", "node_modules", "ghostty-web", "dist"),
    // npm installed with hoisting: ghostty-web is a sibling
    join(__dirname, "..", "..", "ghostty-web", "dist"),
  ];

  for (const p of possiblePaths) {
    if (existsSync(join(p, "ghostty-web.js"))) {
      return p;
    }
  }

  throw new Error("Could not find ghostty-web. Make sure ghostty-web is installed.");
}

const ghosttyDist = findGhosttyDist();

const ghosttyFiles = new Map<string, string>([
  ["/ghostty-web.js", join(ghosttyDist, "ghostty-web.js")],
  ["/ghostty-vt.wasm", join(ghosttyDist, "ghostty-vt.wasm")],
  ["/__vite-browser-external-2447137e.js", join(ghosttyDist, "__vite-browser-external-2447137e.js")],
]);

const mimeLookup: Record<string, string> = {
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".cjs": "application/javascript",
};

const clients = new Set<ServerWebSocket>();
let server: ReturnType<typeof Bun.serve> | null = null;
let shuttingDown = false;
let ptyProxy: PtyProxy;
try {
  ptyProxy = startPtyProxy(args.command, (event) => {
    if (event.type === "output") {
      const decoded = outputDecoder.decode(Buffer.from(event.data, "base64"), { stream: true });
      if (decoded.length > 0) {
        broadcast({ type: "output", data: decoded });
      }
    } else if (event.type === "exit") {
      const remaining = outputDecoder.decode();
      if (remaining.length > 0) {
        broadcast({ type: "output", data: remaining });
      }
      broadcast({ type: "exit", code: event.code ?? undefined, signal: event.signal ?? undefined });
      stopServerSoon();
    }
  });
} catch (error) {
  console.error("Failed to start command:", error);
  process.exit(1);
}

function broadcast(message: ServerMessage) {
  const serialized = JSON.stringify(message);
  for (const client of clients) {
    try {
      client.send(serialized);
    } catch {
      // Ignore broken pipes
    }
  }
}

function stopServerSoon() {
  if (shuttingDown) return;
  shuttingDown = true;
  setTimeout(() => {
    server?.stop();
    ptyProxy.stop();
  }, 500);
}

function handleClientMessage(raw: string | Buffer) {
  const text = typeof raw === "string" ? raw : messageDecoder.decode(raw);
  let parsed: ClientMessage;
  try {
    parsed = JSON.parse(text) as ClientMessage;
  } catch (error) {
    console.error("Failed to parse client message:", error);
    return;
  }

  switch (parsed.type) {
    case "input": {
      ptyProxy.write(parsed.data);
      break;
    }
    case "resize": {
      if (
        Number.isFinite(parsed.cols) &&
        Number.isFinite(parsed.rows) &&
        parsed.cols > 0 &&
        parsed.rows > 0
      ) {
        ptyProxy.resize(Math.floor(parsed.cols), Math.floor(parsed.rows));
      }
      break;
    }
  }
}

server = Bun.serve({
  port: args.port,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/app.js") {
      return new Response(APP_JS, {
        headers: {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-store",
        },
      });
    }

    const ghosttyPath = ghosttyFiles.get(url.pathname);
    if (ghosttyPath) {
      const file = Bun.file(ghosttyPath);
      const contentType =
        mimeLookup[url.pathname.slice(url.pathname.lastIndexOf("."))] ??
        "application/octet-stream";
      return new Response(file, {
        headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
      });
    }

    return new Response(buildClientHtml(args.command.join(" ")), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(JSON.stringify({ type: "output", data: "" }));
    },
    close(ws) {
      clients.delete(ws);
    },
    message(ws, message) {
      handleClientMessage(message);
    },
  },
});

const handleShutdown = () => {
  ptyProxy.stop();
  server?.stop();
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
process.on("exit", () => ptyProxy.stop());

const url = `http://localhost:${args.port}`;
console.log(`Serving ghostty-web at ${url}`);
console.log(`Running: ${args.command.map(shellEscape).join(" ")}`);

function openBrowser(target: string) {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? ["open", target]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", target]
        : ["xdg-open", target];

  try {
    Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  } catch (error) {
    console.warn("Unable to auto-open browser:", error);
  }
}

if (args.autoOpen) {
  openBrowser(url);
}
