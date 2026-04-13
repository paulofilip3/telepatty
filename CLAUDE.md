# Telepatty

Watch and interact with tmux sessions from an iPad via a web-based terminal viewer.

## Architecture

```
iPad Safari <-> Cloudflare (tty.paulorosario.com) <-> Scaleway nginx <-> SSH tunnel <-> Local FastAPI+WS server <-> tmux
```

## Tech Stack

- **Server**: Python, FastAPI, uvicorn, WebSocket
- **Web UI**: Vanilla HTML/CSS/JS, Catppuccin Mocha/Latte themes, mobile-first
- **Voice**: MediaRecorder API (browser) -> faster-whisper (server, optional)
- **Infra**: autossh reverse tunnel, nginx on Scaleway, Cloudflare DNS proxy (orange cloud)

## Project Structure

- `server/` — Python FastAPI app
  - `main.py` — WebSocket endpoints, REST API, static file serving
  - `tmux.py` — tmux subprocess bridge
  - `config.py` — settings via env vars
- `web/` — Static frontend (served by FastAPI)
  - `index.html` — Single page app
  - `style.css` — Catppuccin themed, mobile-first
  - `app.js` — WebSocket client, ANSI parser, voice input, pane tree
- `deploy/` — Infrastructure configs
  - `nginx.conf` — Scaleway vhost config
  - `telepatty.service` — systemd unit for local server
  - `telepatty-tunnel.service` — systemd unit for autossh tunnel
  - `setup-scaleway.sh` — Initial server setup script

## Development

```bash
pip install -e .
TELEPATTY_TOKEN=test123 uvicorn server.main:app --host 127.0.0.1 --port 7857
# Open http://127.0.0.1:7857, enter token "test123"
```

## Environment Variables

- `TELEPATTY_TOKEN` — Auth token (required)
- `TELEPATTY_HOST` — Bind address (default: 127.0.0.1)
- `TELEPATTY_PORT` — Bind port (default: 7857)
- `TELEPATTY_CAPTURE_INTERVAL` — Terminal poll rate in seconds (default: 0.25)
- `TELEPATTY_CAPTURE_LINES` — Max captured lines (default: 200)
- `TELEPATTY_WHISPER_MODEL` — Whisper model size (default: base)

## Deployment

### Systemd services (local machine)

```bash
sudo cp deploy/telepatty.service /etc/systemd/system/
sudo cp deploy/telepatty-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now telepatty telepatty-tunnel
```

### Scaleway (already deployed)

- nginx vhost at `/etc/nginx/sites-available/tty.conf`
- Self-signed origin cert at `/etc/ssl/tty/` (Cloudflare handles public SSL)
- DNS: tty.paulorosario.com -> Cloudflare proxy -> 212.47.228.17

### Production token

Stored in `deploy/telepatty.service`. To change:
1. Edit the service file
2. `sudo systemctl daemon-reload && sudo systemctl restart telepatty`
3. Clear `tp-token` from localStorage on iPad

## Key Design Decisions

- **No iOS app** — Web-based to avoid $99 Apple Developer fee
- **Server-side Whisper** — iOS Safari doesn't support Web Speech API; MediaRecorder captures audio, server transcribes
- **SSH reverse tunnel** — No DDNS needed; workstation initiates outbound connection
- **Self-signed origin cert** — Cloudflare proxy handles public SSL (Full mode)
- **Token auth** — Simple shared secret, personal infrastructure
