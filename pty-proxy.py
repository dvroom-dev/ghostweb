#!/usr/bin/env python3
"""
Lightweight PTY proxy used by the ghostweb CLI.

The script spawns a command inside a pseudo-terminal and proxies
stdin/stdout over newline-delimited JSON messages. Payloads that
represent terminal data are base64-encoded to keep the stream text-safe.
"""

import base64
import json
import os
import select
import struct
import sys
import termios
import fcntl


def set_winsize(fd: int, rows: int, cols: int) -> None:
  """Update the PTY window size."""
  fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def send(message: dict) -> None:
  sys.stdout.write(json.dumps(message) + "\n")
  sys.stdout.flush()


def main() -> int:
  if len(sys.argv) < 2:
    sys.stderr.write("pty-proxy: missing command to execute\n")
    return 1

  cmd = sys.argv[1:]
  if cmd and cmd[0] == "--":
    cmd = cmd[1:]
  if not cmd:
    sys.stderr.write("pty-proxy: missing command after '--'\n")
    return 1

  pid, master_fd = os.forkpty()
  if pid == 0:
    try:
      os.execvp(cmd[0], cmd)
    except Exception as exc:  # pragma: no cover - best effort error path
      sys.stderr.write(f"exec failed: {exc}\n")
      os._exit(1)

  buffer = ""

  try:
    while True:
      readable, _, _ = select.select([master_fd, sys.stdin], [], [])

      if master_fd in readable:
        try:
          data = os.read(master_fd, 8192)
        except OSError:
          data = b""
        if not data:
          break
        send({"type": "output", "data": base64.b64encode(data).decode("ascii")})

      if sys.stdin in readable:
        line = sys.stdin.readline()
        if not line:
          break
        try:
          message = json.loads(line)
        except json.JSONDecodeError:
          continue

        m_type = message.get("type")
        if m_type == "input":
          payload = message.get("data", "")
          if isinstance(payload, str):
            try:
              os.write(master_fd, base64.b64decode(payload))
            except Exception:
              pass
        elif m_type == "resize":
          cols = int(message.get("cols", 0) or 0)
          rows = int(message.get("rows", 0) or 0)
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
    send({"type": "exit", "code": code, "signal": signal_num})
    try:
      os.close(master_fd)
    except Exception:
      pass

  return 0


if __name__ == "__main__":
  sys.exit(main())
