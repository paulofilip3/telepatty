# Telepatty — Developer Notes

Web-based tmux remote controller. See README.md for overview and setup.

## Tech Stack

Pure Python backend (FastAPI + uvicorn), vanilla HTML/CSS/JS frontend. No build tools, no frameworks, no dependencies beyond FastAPI.

## Development Workflow

```bash
pip install -e .
TELEPATTY_TOKEN=test123 uvicorn server.main:app --host 127.0.0.1 --port 7857
```

After changing CSS or JS: bump `?v=N` in `web/index.html` (Cloudflare caches aggressively).

To restart reliably: `fuser -k 7857/tcp; TELEPATTY_TOKEN=... nohup uvicorn ...`

## Architecture

- `server/main.py` — FastAPI app. TokenAuthMiddleware checks `?token=` on all non-static routes. WebSocket at `/ws/terminal` streams `tmux capture-pane` output at 250ms intervals. REST endpoints for tmux management.
- `server/tmux.py` — All tmux interaction via `asyncio.create_subprocess_exec` (no shell). Pane data includes `pane_top`/`pane_left` for multi-pane layout positioning.
- `web/app.js` — IIFE, no modules. ANSI parser maps SGR codes to Catppuccin CSS classes. WebSocket connections auto-reconnect with exponential backoff. History lazy-loads 500 lines per chunk on scroll-up.

## Key Patterns

- **Session order**: `list_sessions()` returns dicts with `idx` (from tmux `$session_id`) for creation-order sorting
- **Multi-pane layout**: Absolute positioning using `pane_top/left/width/height` as percentages of the total window dimensions
- **Voice**: Web Speech API primary (client-side, auto-stops on silence), server-side Whisper fallback (loaded in background thread on startup)
- **Fit-to-client**: Measures monospace character cell size, calculates cols/rows from terminal viewport, subtracts margin (-4 cols, -2 rows), calls `tmux resize-window`
- **Cache busting**: `?v=N` on CSS/JS hrefs + `Cache-Control: no-cache` header from middleware

## Deployment

- Scaleway VPS: nginx at `/etc/nginx/sites-available/tty.conf` (coexists with dxea*.interpt.co)
- Self-signed origin cert at `/etc/ssl/tty/` (Cloudflare proxy handles public SSL in Full mode)
- Local systemd: `telepatty.service` (server) + `telepatty-tunnel.service` (autossh)
- Token stored in systemd unit file environment
