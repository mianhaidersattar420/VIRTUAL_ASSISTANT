/* ─── Config ─────────────────────────────────────────────────────── */
const API_BASE = window.location.origin;

/* ─── State ──────────────────────────────────────────────────────── */
let currentSessionId = null;
let messageHistory = [];
let sessions = [];
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let currentMode = 'chat';
let pendingDeleteId = null;
let animFrame = null;
let audioCtx = null;
let analyser = null;
let micStream = null;
let waveData = null;

/* ─── DOM ─────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const sidebar = document.querySelector('.sidebar');
const sessionsList = $('sessionsList');
const messagesContainer = $('messagesContainer');
const welcomeScreen = $('welcomeScreen');
const chatInput = $('chatInput');
const sendBtn = $('sendBtn');
const sessionTitle = $('sessionTitle');
const chatView = $('chatView');
const voiceView = $('voiceView');
const voiceMicBtn = $('voiceMicBtn');
const voiceStopBtn = $('voiceStopBtn');
const voiceStatus = $('voiceStatus');
const voiceTranscript = $('voiceTranscript');
const voiceResponse = $('voiceResponse');
const siriOrb = $('siriOrb');
const waveCanvas = $('waveCanvas');
const deleteModal = $('deleteModal');
const configPanel = $('configPanel');
const apiStatus = $('apiStatus');

/* ─── Init ───────────────────────────────────────────────────────── */
async function init() {
  await checkHealth();
  await loadSessions();
  setupEventListeners();
  setupWaveCanvas();
}

async function checkHealth() {
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    const d = await r.json();
    if (d.groq_configured) {
      setStatus('ok', 'Connected');
    } else {
      setStatus('err', 'No API Key');
      showConfigPanel();
    }
  } catch {
    setStatus('err', 'Offline');
  }
}

function setStatus(type, text) {
  const dot = apiStatus.querySelector('.status-dot');
  const txt = apiStatus.querySelector('.status-text');
  dot.className = `status-dot ${type}`;
  txt.textContent = text;
}

/* ─── Config Panel ───────────────────────────────────────────────── */
function showConfigPanel() {
  configPanel.classList.remove('hidden');
}

$('configSave').addEventListener('click', async () => {
  const key = $('groqKeyInput').value.trim();
  if (!key) return;
  try {
    const r = await fetch(`${API_BASE}/api/set-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (r.ok) {
      configPanel.classList.add('hidden');
      setStatus('ok', 'Connected');
    }
  } catch {
    // key might need to be set in env; show instructions
    alert('Set GROQ_API_KEY in your environment and restart the server.');
  }
  configPanel.classList.add('hidden');
});

/* ─── Sessions ───────────────────────────────────────────────────── */
async function loadSessions() {
  try {
    const r = await fetch(`${API_BASE}/api/sessions`);
    const d = await r.json();
    sessions = d.sessions || [];
    renderSessions();
  } catch (e) {
    console.error('Load sessions error', e);
  }
}

function renderSessions() {
  const existing = sessionsList.querySelector('.sessions-label');
  sessionsList.innerHTML = '';
  if (existing) sessionsList.appendChild(existing);
  const label = document.createElement('div');
  label.className = 'sessions-label';
  label.textContent = 'Recent';
  sessionsList.appendChild(label);

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text3);font-size:.82rem;padding:12px 10px;';
    empty.textContent = 'No conversations yet';
    sessionsList.appendChild(empty);
    return;
  }

  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = `session-item${s.id === currentSessionId ? ' active' : ''}`;
    item.dataset.id = s.id;

    const icon = document.createElement('div');
    icon.className = 'session-item-icon';
    icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

    const text = document.createElement('div');
    text.className = 'session-item-text';
    const title = document.createElement('div');
    title.className = 'session-item-title';
    title.textContent = s.title || 'New Conversation';
    const date = document.createElement('div');
    date.className = 'session-item-date';
    date.textContent = formatDate(s.updated_at);
    text.appendChild(title);
    text.appendChild(date);

    const del = document.createElement('button');
    del.className = 'session-delete-btn';
    del.title = 'Delete';
    del.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
    del.addEventListener('click', e => { e.stopPropagation(); confirmDelete(s.id); });

    item.appendChild(icon);
    item.appendChild(text);
    item.appendChild(del);
    item.addEventListener('click', () => switchSession(s.id));
    sessionsList.appendChild(item);
  });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return d.toLocaleDateString();
}

async function createNewSession() {
  try {
    const r = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Conversation' })
    });
    const d = await r.json();
    currentSessionId = d.session_id;
    messageHistory = [];
    await loadSessions();
    resetMessages();
    sessionTitle.textContent = 'New Conversation';
  } catch (e) {
    console.error(e);
  }
}

async function switchSession(id) {
  currentSessionId = id;
  messageHistory = [];
  await loadSessions();

  const session = sessions.find(s => s.id === id);
  sessionTitle.textContent = session?.title || 'Conversation';

  // Load messages
  try {
    const r = await fetch(`${API_BASE}/api/sessions/${id}/messages`);
    const d = await r.json();
    const msgs = d.messages || [];
    resetMessages();
    msgs.forEach(m => {
      addMessage(m.role, m.content, false);
      messageHistory.push({ role: m.role, content: m.content });
    });
    if (msgs.length > 0) scrollToBottom();
  } catch (e) {
    console.error(e);
  }
}

/* ─── Delete ─────────────────────────────────────────────────────── */
function confirmDelete(id) {
  pendingDeleteId = id;
  deleteModal.classList.remove('hidden');
}

$('modalCancel').addEventListener('click', () => {
  deleteModal.classList.add('hidden');
  pendingDeleteId = null;
});

$('modalConfirm').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  try {
    await fetch(`${API_BASE}/api/sessions/${pendingDeleteId}`, { method: 'DELETE' });
    if (pendingDeleteId === currentSessionId) {
      currentSessionId = null;
      messageHistory = [];
      resetMessages();
      sessionTitle.textContent = 'ARIA';
    }
    pendingDeleteId = null;
    deleteModal.classList.add('hidden');
    await loadSessions();
  } catch (e) {
    console.error(e);
  }
});

/* ─── Messages ───────────────────────────────────────────────────── */
function resetMessages() {
  messagesContainer.innerHTML = '';
  messagesContainer.appendChild(createWelcomeScreen());
}

function createWelcomeScreen() {
  const div = document.createElement('div');
  div.className = 'welcome-screen';
  div.id = 'welcomeScreen';
  div.innerHTML = `
    <div class="welcome-orb-wrap">
      <div class="welcome-orb">
        <div class="orb-ring r1"></div>
        <div class="orb-ring r2"></div>
        <div class="orb-ring r3"></div>
        <div class="orb-core"></div>
      </div>
    </div>
    <h1>Hello, I'm <span class="aria-name">ARIA</span></h1>
    <p>Your adaptive AI assistant. Ask me anything.</p>
    <div class="suggestions">
      <button class="suggest-chip" onclick="sendSuggestion('What can you help me with?')">What can you do?</button>
      <button class="suggest-chip" onclick="sendSuggestion('Tell me something interesting')">Tell me something interesting</button>
      <button class="suggest-chip" onclick="sendSuggestion('Help me write an email')">Help me write an email</button>
      <button class="suggest-chip" onclick="sendSuggestion('Explain quantum computing simply')">Explain quantum computing</button>
    </div>`;
  return div;
}

function hideWelcome() {
  const ws = messagesContainer.querySelector('.welcome-screen');
  if (ws) ws.remove();
}

function addMessage(role, content, animate = true) {
  hideWelcome();

  const msg = document.createElement('div');
  msg.className = `message ${role}${animate ? ' new' : ''}`;

  const initial = role === 'user' ? 'U' : 'A';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msg.innerHTML = `
    <div class="message-inner">
      <div class="message-avatar">${initial}</div>
      <div class="message-body">
        <div class="message-content">${escapeHtml(content)}</div>
        <div class="message-meta">${time}</div>
      </div>
    </div>`;

  messagesContainer.appendChild(msg);
  if (animate) scrollToBottom();
  return msg;
}

function addThinking() {
  hideWelcome();
  const msg = document.createElement('div');
  msg.className = 'message assistant';
  msg.id = 'thinkingMsg';
  msg.innerHTML = `
    <div class="message-inner">
      <div class="message-avatar">A</div>
      <div class="message-body">
        <div class="message-content">
          <div class="thinking-dots"><span></span><span></span><span></span></div>
        </div>
      </div>
    </div>`;
  messagesContainer.appendChild(msg);
  scrollToBottom();
}

function removeThinking() {
  const t = $('thinkingMsg');
  if (t) t.remove();
}

function scrollToBottom() {
  setTimeout(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, 50);
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

/* ─── Send Chat ──────────────────────────────────────────────────── */
async function sendMessage(text) {
  if (!text.trim()) return;

  // Ensure session
  if (!currentSessionId) await createNewSession();

  addMessage('user', text);
  messageHistory.push({ role: 'user', content: text });
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  addThinking();

  try {
    const r = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: currentSessionId,
        message: text,
        history: messageHistory.slice(-20)
      })
    });
    const d = await r.json();
    removeThinking();
    if (d.reply) {
      addMessage('assistant', d.reply);
      messageHistory.push({ role: 'assistant', content: d.reply });
      await loadSessions(); // refresh titles
    } else {
      addMessage('assistant', `Error: ${d.detail || 'Unknown error'}`);
    }
  } catch (e) {
    removeThinking();
    addMessage('assistant', 'Network error. Please check your connection.');
  }

  sendBtn.disabled = false;
}

window.sendSuggestion = async (text) => {
  if (!currentSessionId) await createNewSession();
  await sendMessage(text);
};

/* ─── Voice ──────────────────────────────────────────────────────── */
async function startRecording() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Audio visualizer
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    waveData = new Uint8Array(analyser.frequencyBinCount);
    const source = audioCtx.createMediaStreamSource(micStream);
    source.connect(analyser);
    drawWave();

    mediaRecorder = new MediaRecorder(micStream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = processAudio;
    mediaRecorder.start();
    isRecording = true;

    siriOrb.classList.add('listening');
    voiceMicBtn.classList.add('recording');
    voiceStopBtn.classList.remove('hidden');
    voiceStatus.textContent = 'Listening…';
    voiceTranscript.textContent = '';
    voiceResponse.classList.remove('show');
  } catch (e) {
    voiceStatus.textContent = 'Microphone access denied';
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    micStream.getTracks().forEach(t => t.stop());
    if (animFrame) cancelAnimationFrame(animFrame);
    isRecording = false;
    siriOrb.classList.remove('listening');
    siriOrb.classList.add('thinking');
    voiceMicBtn.classList.remove('recording');
    voiceStopBtn.classList.add('hidden');
    voiceStatus.textContent = 'Processing…';
  }
}

async function processAudio() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('audio', blob, 'recording.webm');

  try {
    const r = await fetch(`${API_BASE}/api/transcribe`, { method: 'POST', body: formData });
    const d = await r.json();
    const transcript = d.text?.trim();

    if (!transcript) {
      siriOrb.classList.remove('thinking');
      voiceStatus.textContent = "Didn't catch that. Try again.";
      clearWave();
      return;
    }

    voiceTranscript.textContent = `"${transcript}"`;
    voiceStatus.textContent = 'Thinking…';

    if (!currentSessionId) await createNewSession();
    messageHistory.push({ role: 'user', content: transcript });

    const cr = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: currentSessionId,
        message: transcript,
        history: messageHistory.slice(-20)
      })
    });
    const cd = await cr.json();
    siriOrb.classList.remove('thinking');

    if (cd.reply) {
      messageHistory.push({ role: 'assistant', content: cd.reply });
      voiceResponse.textContent = cd.reply;
      voiceResponse.classList.add('show');
      voiceStatus.textContent = 'Done';
      speakResponse(cd.reply);
      await loadSessions();
    } else {
      voiceStatus.textContent = 'Error — try again';
    }
  } catch (e) {
    siriOrb.classList.remove('thinking');
    voiceStatus.textContent = 'Error processing audio';
  }
  clearWave();
}

function speakResponse(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 1;
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name.includes('Samantha') || v.name.includes('Karen') || v.name.includes('Google US English'));
  if (preferred) u.voice = preferred;
  u.onend = () => { voiceStatus.textContent = 'Tap to speak'; };
  speechSynthesis.speak(u);
}

/* ─── Wave Canvas ────────────────────────────────────────────────── */
function setupWaveCanvas() {
  const canvas = waveCanvas;
  const size = 180;
  canvas.width = size;
  canvas.height = size;
  drawIdleWave();
}

function drawIdleWave() {
  const canvas = waveCanvas;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r = 80;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Idle: gentle shimmer rings
  const t = Date.now() / 1000;
  for (let i = 0; i < 3; i++) {
    const phase = t * 0.5 + i * (Math.PI * 2 / 3);
    const alpha = 0.15 + 0.08 * Math.sin(phase);
    ctx.beginPath();
    ctx.arc(cx, cy, r - i * 6 + Math.sin(phase) * 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (!isRecording) animFrame = requestAnimationFrame(drawIdleWave);
}

function drawWave() {
  if (!analyser) return;
  const canvas = waveCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;

  analyser.getByteFrequencyData(waveData);

  ctx.clearRect(0, 0, W, H);

  const bars = 48;
  const r = 68;
  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const value = waveData[Math.floor(i * waveData.length / bars)] / 255;
    const barH = 10 + value * 30;

    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(angle) * (r + barH);
    const y2 = cy + Math.sin(angle) * (r + barH);

    const hue = 200 + value * 100;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${0.5 + value * 0.5})`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  if (isRecording) animFrame = requestAnimationFrame(drawWave);
}

function clearWave() {
  if (animFrame) cancelAnimationFrame(animFrame);
  if (audioCtx) { audioCtx.close(); audioCtx = null; analyser = null; }
  drawIdleWave();
}

/* ─── Event Listeners ────────────────────────────────────────────── */
function setupEventListeners() {
  // New chat
  $('newChatBtn').addEventListener('click', createNewSession);

  // Send
  sendBtn.addEventListener('click', () => sendMessage(chatInput.value));
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(chatInput.value);
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  });

  // Mode switch
  $('chatModeBtn').addEventListener('click', () => switchMode('chat'));
  $('voiceModeBtn').addEventListener('click', () => switchMode('voice'));

  // Voice mic
  voiceMicBtn.addEventListener('click', () => {
    if (!isRecording) startRecording();
    else stopRecording();
  });
  voiceStopBtn.addEventListener('click', stopRecording);

  // Siri orb click
  siriOrb.addEventListener('click', () => {
    if (!isRecording) startRecording();
  });

  // Sidebar toggle
  $('sidebarToggle').addEventListener('click', () => {
    if (window.innerWidth <= 700) {
      sidebar.classList.toggle('open');
    } else {
      sidebar.classList.toggle('collapsed');
    }
  });

  // Close sidebar on mobile when clicking outside
  document.addEventListener('click', e => {
    if (window.innerWidth <= 700 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && e.target !== $('sidebarToggle')) {
        sidebar.classList.remove('open');
      }
    }
  });
}

function switchMode(mode) {
  currentMode = mode;
  $('chatModeBtn').classList.toggle('active', mode === 'chat');
  $('voiceModeBtn').classList.toggle('active', mode === 'voice');
  chatView.classList.toggle('hidden', mode !== 'chat');
  voiceView.classList.toggle('hidden', mode !== 'voice');

  if (mode === 'voice') {
    voiceStatus.textContent = 'Tap to speak';
    clearWave();
  }
}

/* ─── Start ──────────────────────────────────────────────────────── */
init();
