"""Telepatty — FastAPI server bridging tmux to WebSocket."""

import asyncio
import io
import logging
import tempfile
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, Depends, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.websockets import WebSocketState

from . import tmux
from .config import TOKEN, CAPTURE_INTERVAL, CAPTURE_LINES

logger = logging.getLogger("telepatty")

app = FastAPI(title="Telepatty")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


# --- Auth ---

def verify_token(token: str = Query(alias="token")):
    if token != TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")


class TokenAuthMiddleware(BaseHTTPMiddleware):
    """Require ?token= on all API/WS routes except static files."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Allow static files and the root page without token (token checked in JS)
        if path.startswith("/static") or path == "/":
            response = await call_next(request)
            # Prevent Cloudflare from caching stale assets
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
            return response
        # API and WS routes need token
        token = request.query_params.get("token")
        if token != TOKEN:
            return JSONResponse({"detail": "Invalid token"}, status_code=403)
        return await call_next(request)


app.add_middleware(TokenAuthMiddleware)


# --- Static files ---

app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


@app.get("/")
async def index():
    index_path = WEB_DIR / "index.html"
    return HTMLResponse(index_path.read_text())


# --- REST endpoints for tmux management ---

@app.get("/api/tree")
async def api_tree():
    """Get full tmux session/window/pane tree."""
    return await tmux.get_tree()


@app.post("/api/session")
async def api_new_session(name: str = Query()):
    ok = await tmux.new_session(name)
    if not ok:
        raise HTTPException(400, "Failed to create session")
    return {"ok": True}


@app.delete("/api/session")
async def api_kill_session(name: str = Query()):
    ok = await tmux.kill_session(name)
    if not ok:
        raise HTTPException(400, "Failed to kill session")
    return {"ok": True}


@app.post("/api/window")
async def api_new_window(session: str = Query(), name: str = Query(default=None)):
    ok = await tmux.new_window(session, name)
    if not ok:
        raise HTTPException(400, "Failed to create window")
    return {"ok": True}


@app.delete("/api/window")
async def api_kill_window(target: str = Query()):
    ok = await tmux.kill_window(target)
    if not ok:
        raise HTTPException(400, "Failed to kill window")
    return {"ok": True}


@app.post("/api/split")
async def api_split(target: str = Query(), horizontal: bool = Query(default=False)):
    ok = await tmux.split_window(target, horizontal)
    if not ok:
        raise HTTPException(400, "Failed to split")
    return {"ok": True}


@app.delete("/api/pane")
async def api_kill_pane(target: str = Query()):
    ok = await tmux.kill_pane(target)
    if not ok:
        raise HTTPException(400, "Failed to kill pane")
    return {"ok": True}


@app.post("/api/zoom")
async def api_zoom(target: str = Query()):
    ok = await tmux.zoom_pane(target)
    if not ok:
        raise HTTPException(400, "Failed to zoom")
    return {"ok": True}


@app.post("/api/send")
async def api_send_keys(target: str = Query(), keys: str = Query(), literal: bool = Query(default=True)):
    ok = await tmux.send_keys(target, keys, literal)
    if not ok:
        raise HTTPException(400, "Failed to send keys")
    return {"ok": True}


@app.post("/api/send-special")
async def api_send_special(target: str = Query(), key: str = Query()):
    ok = await tmux.send_special_key(target, key)
    if not ok:
        raise HTTPException(400, "Failed to send special key")
    return {"ok": True}


# --- Voice transcription ---

_whisper_model = None


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel
            from .config import WHISPER_MODEL
            logger.info(f"Loading Whisper model: {WHISPER_MODEL}")
            _whisper_model = WhisperModel(WHISPER_MODEL, compute_type="int8")
            logger.info("Whisper model loaded")
        except ImportError:
            logger.warning("faster-whisper not installed — voice transcription unavailable")
            return None
    return _whisper_model


@app.post("/api/transcribe")
async def api_transcribe(audio: UploadFile = File()):
    """Transcribe audio file using Whisper."""
    model = _get_whisper_model()
    if model is None:
        raise HTTPException(501, "Whisper not available — install faster-whisper")
    data = await audio.read()
    # Write to temp file (faster-whisper needs a file path)
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(data)
        tmp_path = f.name
    try:
        segments, _ = model.transcribe(tmp_path, language=None)
        text = " ".join(s.text.strip() for s in segments)
        return {"text": text.strip()}
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# --- WebSocket for terminal streaming ---

@app.websocket("/ws/terminal")
async def ws_terminal(ws: WebSocket, target: str = Query(), token: str = Query()):
    """Stream terminal content for a pane. Client can also send input."""
    if token != TOKEN:
        await ws.close(code=4003, reason="Invalid token")
        return
    await ws.accept()
    last_content = ""
    try:
        # Start background task for receiving input
        async def receive_input():
            try:
                while True:
                    msg = await ws.receive_json()
                    msg_type = msg.get("type")
                    if msg_type == "keys":
                        await tmux.send_keys(target, msg["data"], literal=True)
                    elif msg_type == "special":
                        await tmux.send_special_key(target, msg["data"])
                    elif msg_type == "resize":
                        pass  # Could resize pane in future
            except WebSocketDisconnect:
                pass

        input_task = asyncio.create_task(receive_input())

        # Stream terminal content
        while ws.client_state == WebSocketState.CONNECTED:
            content = await tmux.capture_pane(target, CAPTURE_LINES)
            if content != last_content:
                last_content = content
                await ws.send_json({"type": "content", "data": content})
            await asyncio.sleep(CAPTURE_INTERVAL)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        input_task.cancel()


# --- Startup ---

@app.on_event("startup")
async def startup():
    logger.info(f"Telepatty running — token: {TOKEN[:8]}...")
    sessions = await tmux.list_sessions()
    if sessions:
        logger.info(f"Found tmux sessions: {', '.join(s['name'] for s in sessions)}")
    else:
        logger.warning("No tmux sessions found")
