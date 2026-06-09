from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import httpx
import os
import json
from datetime import datetime
import uuid
from supabase import create_client, Client

app = FastAPI(title="Virtual Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supabase
SUPABASE_URL = "https://pjnvsbxznhyrujiffjit.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqbnZzYnh6bmh5cnVqaWZmaml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4OTk2MzIsImV4cCI6MjA5NjQ3NTYzMn0.FD7fgNbPx_pXPdN5Vt5ue9jIjUBWRnraRs8SIlnE7HQ"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Groq
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")

def load_env():
    if not os.path.exists(ENV_PATH):
        return
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)

load_env()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

SYSTEM_PROMPT = """You are ARIA (Adaptive Responsive Intelligent Assistant), a highly capable virtual assistant.
You are helpful, concise, and friendly. You respond naturally and conversationally.
Keep responses clear and direct. When asked about yourself, you are ARIA, a virtual assistant powered by advanced AI.
Format responses in plain text unless the user asks for markdown."""


class ChatMessage(BaseModel):
    session_id: str
    message: str
    role: str = "user"


class ChatRequest(BaseModel):
    session_id: str
    message: str
    history: Optional[List[dict]] = []


class SetKeyRequest(BaseModel):
    key: str


class SessionCreate(BaseModel):
    title: Optional[str] = "New Conversation"


# ─── DB Setup ────────────────────────────────────────────────────────────────

def ensure_tables():
    """Create tables via RPC if they don't exist."""
    try:
        supabase.table("sessions").select("id").limit(1).execute()
    except Exception:
        pass
    try:
        supabase.table("messages").select("id").limit(1).execute()
    except Exception:
        pass


# ─── Sessions ─────────────────────────────────────────────────────────────────

@app.post("/api/sessions")
async def create_session(body: SessionCreate):
    session_id = str(uuid.uuid4())
    try:
        result = supabase.table("sessions").insert({
            "id": session_id,
            "title": body.title,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }).execute()
        return {"session_id": session_id, "title": body.title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions")
async def list_sessions():
    try:
        result = supabase.table("sessions").select("*").order("updated_at", desc=True).execute()
        return {"sessions": result.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    try:
        supabase.table("messages").delete().eq("session_id", session_id).execute()
        supabase.table("sessions").delete().eq("id", session_id).execute()
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Messages ─────────────────────────────────────────────────────────────────

@app.get("/api/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    try:
        result = supabase.table("messages").select("*").eq("session_id", session_id).order("created_at").execute()
        return {"messages": result.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def save_message(session_id: str, role: str, content: str):
    try:
        supabase.table("messages").insert({
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "role": role,
            "content": content,
            "created_at": datetime.utcnow().isoformat(),
        }).execute()
        supabase.table("sessions").update({"updated_at": datetime.utcnow().isoformat()}).eq("id", session_id).execute()
    except Exception as e:
        print(f"Save message error: {e}")


# ─── Chat ─────────────────────────────────────────────────────────────────────

@app.post("/api/chat")
async def chat(req: ChatRequest):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=400, detail="GROQ_API_KEY not configured")

    # Save user message
    save_message(req.session_id, "user", req.message)

    # Build messages for Groq
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in req.history[-20:]:  # last 20 for context
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": req.message})

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": messages,
                    "max_tokens": 1024,
                    "temperature": 0.7,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]

        save_message(req.session_id, "assistant", reply)

        # Auto-title session from first message
        if len(req.history) == 0:
            title = req.message[:50] + ("..." if len(req.message) > 50 else "")
            supabase.table("sessions").update({"title": title}).eq("id", req.session_id).execute()

        return {"reply": reply, "session_id": req.session_id}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Voice / STT ──────────────────────────────────────────────────────────────

@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=400, detail="GROQ_API_KEY not configured")
    try:
        audio_bytes = await audio.read()
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GROQ_STT_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                files={"file": (audio.filename or "audio.webm", audio_bytes, audio.content_type or "audio/webm")},
                data={"model": "whisper-large-v3-turbo", "response_format": "json"},
            )
            resp.raise_for_status()
            data = resp.json()
            return {"text": data.get("text", "")}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Health ───────────────────────────────────────────────────────────────────

@app.post("/api/set-key")
async def set_key(body: SetKeyRequest):
    global GROQ_API_KEY
    GROQ_API_KEY = body.key
    try:
        with open(ENV_PATH, "w", encoding="utf-8") as f:
            f.write(f"GROQ_API_KEY={body.key}\n")
    except Exception:
        pass
    return {"status": "ok"}


@app.get("/api/health")
async def health():
    return {"status": "ok", "groq_configured": bool(GROQ_API_KEY)}


# ─── Static Frontend ──────────────────────────────────────────────────────────

frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=os.path.join(frontend_path, "static")), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(frontend_path, "index.html"))

    @app.get("/{path:path}")
    async def serve_spa(path: str):
        file_path = os.path.join(frontend_path, path)
        if os.path.exists(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_path, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
