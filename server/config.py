"""Telepatty configuration."""

import os
import secrets

# Auth token — set TELEPATTY_TOKEN env var or a random one is generated on startup
TOKEN = os.environ.get("TELEPATTY_TOKEN", secrets.token_urlsafe(32))

# Server bind
HOST = os.environ.get("TELEPATTY_HOST", "127.0.0.1")
PORT = int(os.environ.get("TELEPATTY_PORT", "7857"))

# Terminal capture polling interval (seconds)
CAPTURE_INTERVAL = float(os.environ.get("TELEPATTY_CAPTURE_INTERVAL", "0.25"))

# Maximum capture history lines
CAPTURE_LINES = int(os.environ.get("TELEPATTY_CAPTURE_LINES", "200"))

# Whisper model for voice transcription (tiny, base, small, medium, large-v3)
WHISPER_MODEL = os.environ.get("TELEPATTY_WHISPER_MODEL", "base")
