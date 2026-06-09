# ARIA — Virtual Assistant

A Siri-inspired AI assistant with voice & chat modes, powered by **Groq** and **Supabase**.

---

## Features

- 🎙️ **Voice Mode** — Whisper STT via Groq + Web Speech TTS
- 💬 **Chat Mode** — Streaming chat with Llama 3.3 70B
- 🗂️ **Chat History** — All sessions stored in Supabase
- 🌊 **Siri-like Orb** — Real-time audio waveform visualizer
- ✨ **Dark glass UI** — Modern, responsive design

---

## Setup

### 1. Supabase — Create Tables

Open your Supabase project → SQL Editor → paste and run `supabase_schema.sql`.

### 2. Get a Groq API Key

Sign up at https://console.groq.com and create a free API key.

### 3. Install Backend

```bash
cd backend
pip install -r requirements.txt
```

### 4. Run

```bash
cd backend
GROQ_API_KEY=gsk_your_key_here uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Then open http://localhost:8000 in your browser.

---

## Structure

```
virtual-assistant/
├── backend/
│   ├── main.py              # FastAPI app
│   └── requirements.txt
├── frontend/
│   ├── index.html           # Main UI
│   └── static/
│       ├── css/style.css
│       └── js/app.js
├── supabase_schema.sql      # Run this in Supabase SQL Editor
└── README.md
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Your Groq API key (required) |

---

## Models Used

| Purpose | Model |
|---|---|
| Chat | `llama-3.3-70b-versatile` |
| Speech-to-Text | `whisper-large-v3-turbo` |
