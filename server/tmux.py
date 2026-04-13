"""Tmux bridge — subprocess wrapper for all tmux interactions."""

import asyncio
from dataclasses import dataclass


@dataclass
class Pane:
    session: str
    window_index: str
    window_name: str
    pane_index: str
    pane_id: str
    active: bool
    width: int
    height: int
    top: int
    left: int
    current_command: str
    zoomed: bool

    def target(self) -> str:
        return f"{self.session}:{self.window_index}.{self.pane_index}"

    def to_dict(self) -> dict:
        return {
            "session": self.session,
            "window_index": self.window_index,
            "window_name": self.window_name,
            "pane_index": self.pane_index,
            "pane_id": self.pane_id,
            "active": self.active,
            "width": self.width,
            "height": self.height,
            "top": self.top,
            "left": self.left,
            "current_command": self.current_command,
            "target": self.target(),
            "zoomed": self.zoomed,
        }


async def _run(args: list[str]) -> tuple[str, int]:
    """Run a command using execvp-style (no shell), return (stdout, returncode)."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    return stdout.decode("utf-8", errors="replace"), proc.returncode


async def list_sessions() -> list[dict]:
    """Return list of tmux sessions with name and id, sorted by creation order."""
    fmt = "#{session_id}\t#{session_name}"
    out, rc = await _run(["tmux", "list-sessions", "-F", fmt])
    if rc != 0:
        return []
    sessions = []
    for line in out.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        if len(parts) < 2:
            continue
        # session_id is like "$0", "$1" — parse the number for sorting
        sid = parts[0].lstrip("$")
        try:
            idx = int(sid)
        except ValueError:
            idx = 999
        sessions.append({"name": parts[1].strip(), "idx": idx})
    sessions.sort(key=lambda s: s["idx"])
    return sessions


async def list_panes(session: str | None = None) -> list[Pane]:
    """List all panes, optionally filtered by session."""
    fmt = "\t".join([
        "#{session_name}", "#{window_index}", "#{window_name}",
        "#{pane_index}", "#{pane_id}", "#{pane_active}",
        "#{pane_width}", "#{pane_height}", "#{pane_top}", "#{pane_left}",
        "#{pane_current_command}", "#{window_zoomed_flag}",
    ])
    if session:
        cmd = ["tmux", "list-panes", "-F", fmt, "-t", session, "-s"]
    else:
        cmd = ["tmux", "list-panes", "-F", fmt, "-a"]
    out, rc = await _run(cmd)
    if rc != 0:
        return []
    panes = []
    for line in out.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 12:
            continue
        panes.append(Pane(
            session=parts[0],
            window_index=parts[1],
            window_name=parts[2],
            pane_index=parts[3],
            pane_id=parts[4],
            active=parts[5] == "1",
            width=int(parts[6]),
            height=int(parts[7]),
            top=int(parts[8]),
            left=int(parts[9]),
            current_command=parts[10],
            zoomed=parts[11] == "1",
        ))
    return panes


async def capture_pane(target: str, lines: int = 200) -> str:
    """Capture pane content with ANSI escape sequences."""
    out, rc = await _run([
        "tmux", "capture-pane", "-t", target, "-p", "-e",
        "-S", str(-lines),
    ])
    if rc != 0:
        return ""
    return out


async def capture_pane_range(target: str, start: int, end: int) -> str:
    """Capture a range of pane history. start/end are negative line offsets."""
    out, rc = await _run([
        "tmux", "capture-pane", "-t", target, "-p", "-e",
        "-S", str(start), "-E", str(end),
    ])
    if rc != 0:
        return ""
    return out


async def send_keys(target: str, keys: str, literal: bool = True) -> bool:
    """Send keystrokes to a tmux pane."""
    cmd = ["tmux", "send-keys", "-t", target]
    if literal:
        cmd.append("-l")
    cmd.append(keys)
    _, rc = await _run(cmd)
    return rc == 0


async def send_special_key(target: str, key: str) -> bool:
    """Send a special key (Enter, C-c, etc.) to a tmux pane."""
    _, rc = await _run(["tmux", "send-keys", "-t", target, key])
    return rc == 0


async def zoom_pane(target: str) -> bool:
    """Toggle zoom on a pane."""
    _, rc = await _run(["tmux", "resize-pane", "-t", target, "-Z"])
    return rc == 0


async def split_window(target: str, horizontal: bool = False) -> bool:
    """Split a window. horizontal=True means side-by-side (-h)."""
    cmd = ["tmux", "split-window", "-t", target]
    if horizontal:
        cmd.append("-h")
    _, rc = await _run(cmd)
    return rc == 0


async def new_window(session: str, name: str | None = None) -> bool:
    """Create a new window in a session."""
    cmd = ["tmux", "new-window", "-t", session]
    if name:
        cmd += ["-n", name]
    _, rc = await _run(cmd)
    return rc == 0


async def new_session(name: str) -> bool:
    """Create a new detached tmux session."""
    _, rc = await _run(["tmux", "new-session", "-d", "-s", name])
    return rc == 0


async def kill_pane(target: str) -> bool:
    """Kill a tmux pane."""
    _, rc = await _run(["tmux", "kill-pane", "-t", target])
    return rc == 0


async def kill_window(target: str) -> bool:
    """Kill a tmux window."""
    _, rc = await _run(["tmux", "kill-window", "-t", target])
    return rc == 0


async def kill_session(name: str) -> bool:
    """Kill a tmux session."""
    _, rc = await _run(["tmux", "kill-session", "-t", name])
    return rc == 0


async def resize_window(target: str, width: int, height: int) -> bool:
    """Resize a tmux window (affects all panes in it) using aggressive-resize."""
    # Force the client size by resizing the window via a helper session
    # The cleanest way: set window size directly
    _, rc = await _run([
        "tmux", "resize-window", "-t", target, "-x", str(width), "-y", str(height),
    ])
    return rc == 0


async def get_tree() -> list[dict]:
    """Get full tmux tree: sessions -> windows -> panes, ordered by index."""
    sessions = await list_sessions()
    tree = []
    for session_info in sessions:
        session_name = session_info["name"]
        panes = await list_panes(session_name)
        windows: dict[str, dict] = {}
        for p in panes:
            key = p.window_index
            if key not in windows:
                windows[key] = {
                    "index": p.window_index,
                    "name": p.window_name,
                    "panes": [],
                }
            windows[key]["panes"].append(p.to_dict())
        tree.append({
            "name": session_name,
            "windows": list(windows.values()),
        })
    return tree
