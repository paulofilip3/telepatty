# Telepatty

Watch and interact with your tmux sessions from a phone or tablet — no VNC, no native app, just a browser.

Telepatty is a lightweight web app that streams your tmux terminal output in real time via WebSocket, lets you type or speak commands, and manages sessions, windows, and panes — all from a mobile-friendly Catppuccin-themed UI.

## Why

I run Claude Code and other tools inside tmux on my workstation. I wanted to monitor and interact with them from my iPad mini without:
- VNC (unusable on a small screen)
- An iOS app ($99/year developer fee just to run on my own device)
- Paying for DDNS or cloud services

Telepatty uses an SSH reverse tunnel through a cheap VPS, so your home IP never needs to be exposed.

## Features

- **Live terminal streaming** — WebSocket-based, with ANSI colors mapped to Catppuccin palette
- **Multi-pane window view** — Click a window to see all its panes in the actual tmux layout
- **Session/window/pane management** — Create, split, zoom, kill — all from the sidebar
- **Voice input** — Tap the mic, speak, auto-submits when you stop (Web Speech API on iOS/Chrome, Whisper fallback on desktop)
- **Fit to client** — Toggle button resizes the tmux window to match your browser viewport
- **Scrollback history** — Scroll up to lazy-load tmux's full scrollback buffer (100k lines)
- **Auto-reconnect** — WebSocket reconnects automatically when your internet drops and returns
- **Catppuccin theme** — Dark (Mocha) and light (Latte) with one-tap toggle
- **Nerd Font icons** — Bundled webfont renders tmux-nerd-font-window-name icons on any device

## Architecture

```
Phone/Tablet (Safari/Chrome)
    ↕ HTTPS/WSS
Cloudflare (DNS proxy, free tier)
    ↕ HTTPS
VPS — nginx reverse proxy (Scaleway, Hetzner, etc.)
    ↕ SSH reverse tunnel (autossh)
Your workstation — FastAPI + uvicorn
    ↕ subprocess
tmux
```

No ports opened on your home network. Your workstation initiates the outbound SSH tunnel.

## Quick Start

### Prerequisites

- Python 3.11+
- tmux running on your machine
- A VPS with nginx (for remote access) or just use locally

### Install and run locally

```bash
git clone https://github.com/interpt/telepatty.git
cd telepatty
pip install -e .

# Start the server
TELEPATTY_TOKEN=mysecret uvicorn server.main:app --host 127.0.0.1 --port 7857

# Open http://127.0.0.1:7857 and enter your token
```

### Deploy for remote access

1. **DNS**: Point `tty.yourdomain.com` to your VPS (Cloudflare proxy recommended)

2. **VPS (nginx)**:
```bash
# Copy deploy/nginx.conf to /etc/nginx/sites-available/tty.conf
# Update server_name and SSL cert paths
# Generate a self-signed cert (Cloudflare handles public SSL):
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/ssl/tty/privkey.pem -out /etc/ssl/tty/fullchain.pem \
    -subj '/CN=tty.yourdomain.com'
nginx -t && systemctl reload nginx
```

3. **Your workstation (systemd)**:
```bash
# Edit deploy/telepatty.service — set your token and paths
# Edit deploy/telepatty-tunnel.service — set your VPS user@host
sudo cp deploy/telepatty.service deploy/telepatty-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now telepatty telepatty-tunnel
```

## Configuration

All via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEPATTY_TOKEN` | (random) | Auth token — required for all API/WS access |
| `TELEPATTY_HOST` | `127.0.0.1` | Bind address |
| `TELEPATTY_PORT` | `7857` | Bind port |
| `TELEPATTY_CAPTURE_INTERVAL` | `0.25` | Terminal poll rate (seconds) |
| `TELEPATTY_CAPTURE_LINES` | `200` | Lines captured per poll |
| `TELEPATTY_WHISPER_MODEL` | `tiny` | Whisper model for voice fallback |

## Voice Input

**Primary (iOS Safari, Chrome):** Uses the Web Speech API which runs entirely on-device. Tap the mic, speak, and it auto-submits when you stop talking. Requires Siri to be enabled on iOS.

**Fallback (other browsers):** Records audio via MediaRecorder and sends it to the server for transcription with [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Install with:

```bash
pip install -e ".[voice]"
```

## Project Structure

```
telepatty/
├── server/
│   ├── main.py        # FastAPI app — WebSocket, REST API, static files
│   ├── tmux.py        # tmux subprocess bridge
│   └── config.py      # Environment-based settings
├── web/
│   ├── index.html     # Single page app
│   ├── style.css      # Catppuccin Mocha/Latte, mobile-first
│   ├── app.js         # WebSocket client, ANSI parser, voice, pane tree
│   └── fonts/         # Symbols Nerd Font Mono (bundled)
├── deploy/
│   ├── nginx.conf     # VPS reverse proxy config
│   ├── telepatty.service        # systemd unit for the server
│   ├── telepatty-tunnel.service # systemd unit for autossh
│   └── setup-scaleway.sh        # One-time VPS setup script
└── pyproject.toml
```

## Tech Stack

- **Server**: Python, FastAPI, uvicorn, WebSocket
- **Frontend**: Vanilla HTML/CSS/JS (no build step, no framework)
- **Theme**: [Catppuccin](https://catppuccin.com/) Mocha & Latte
- **Icons**: [Nerd Fonts](https://www.nerdfonts.com/) Symbols Only (bundled)
- **Voice**: Web Speech API + faster-whisper fallback
- **Tunnel**: autossh + nginx reverse proxy
- **Auth**: Simple token-based (query parameter)

## License

MIT
