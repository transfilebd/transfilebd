// ═══════════════════════════════════════════════════════════
//  app.js  —  Main Application Controller
//  Wires together UI, Firebase signaling, and WebRTC
// ═══════════════════════════════════════════════════════════

// ── App State ────────────────────────────────────────────

const app = {
  role:      null,    // 'sender' | 'receiver'
  roomId:    null,
  files:     [],      // queued File objects
  connected: false,
};

// ── DOM References ────────────────────────────────────────

const btnCreate          = document.getElementById('btn-create');
const btnJoin            = document.getElementById('btn-join');
const btnCopyCode        = document.getElementById('btn-copy-code');
const btnCancelWait      = document.getElementById('btn-cancel-wait');
const btnSend            = document.getElementById('btn-send');
const btnPause           = document.getElementById('btn-pause');
const btnResume          = document.getElementById('btn-resume');
const btnCancelTransfer  = document.getElementById('btn-cancel-transfer');
const btnDisconnect      = document.getElementById('btn-disconnect');
const dropZone           = document.getElementById('drop-zone');
const fileInput          = document.getElementById('file-input');
const joinCodeInput      = document.getElementById('join-code');
const createPasswordInput= document.getElementById('create-password');
const joinPasswordInput  = document.getElementById('join-password');
const displayRoomCode    = document.getElementById('display-room-code');
const footerRoomCode     = document.getElementById('footer-room-code');

// ══════════════════════════════════════════════════════════
//  SCREEN 1 — Home Actions
// ══════════════════════════════════════════════════════════

// ── Create Room ──────────────────────────────────────────

btnCreate.addEventListener('click', async () => {
  btnCreate.disabled = true;
  btnCreate.innerHTML = '<span class="spinner"></span> Creating…';

  try {
    const roomId  = generateRoomCode();
    const pwd     = createPasswordInput.value.trim();
    const pwdHash = await hashPassword(pwd);

    await createRoomDoc(roomId, pwdHash);

    app.role   = 'sender';
    app.roomId = roomId;

    // Show waiting screen
    displayRoomCode.textContent = roomId;
    showScreen('waiting');

    // Begin WebRTC as sender; waits for receiver to answer
    await startAsSender(
      roomId,
      onChannelOpen,        // called when DataChannel opens
      handleIncomingData,   // called when data arrives
      onChannelClosed       // called when channel closes
    );

  } catch (err) {
    console.error('Create room error:', err);
    showToast('Failed to create room: ' + err.message, 'error');
    btnCreate.disabled = false;
    btnCreate.innerHTML = '<span>Create Room</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
});

// ── Join Room ─────────────────────────────────────────────

btnJoin.addEventListener('click', async () => {
  const code = joinCodeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showToast('Please enter a valid 6-digit room code', 'warning');
    joinCodeInput.focus();
    return;
  }

  btnJoin.disabled = true;
  btnJoin.innerHTML = '<span class="spinner"></span> Joining…';

  try {
    const room = await getRoomDoc(code);
    if (!room) {
      showToast('Room not found. Check the code and try again.', 'error');
      btnJoin.disabled = false;
      btnJoin.innerHTML = '<span>Join Room</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      return;
    }

    // Password check
    if (room.passwordHash) {
      const enteredHash = await hashPassword(joinPasswordInput.value.trim());
      if (enteredHash !== room.passwordHash) {
        showToast('Incorrect password', 'error');
        btnJoin.disabled = false;
        btnJoin.innerHTML = '<span>Join Room</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
        return;
      }
    }

    app.role   = 'receiver';
    app.roomId = code;

    // Receiver mode: hide drop zone
    document.body.classList.add('receiver-mode');

    // Go straight to transfer screen (receiver doesn't have a waiting screen)
    footerRoomCode.textContent = code;
    document.getElementById('my-label').textContent   = 'You (Receiver)';
    document.getElementById('peer-label').textContent = 'Peer (Sender)';
    document.getElementById('my-avatar').textContent  = 'ME';
    document.getElementById('peer-avatar').textContent = 'SND';
    showScreen('transfer');

    await startAsReceiver(
      code,
      onChannelOpen,
      handleIncomingData,
      onChannelClosed
    );

  } catch (err) {
    console.error('Join room error:', err);
    showToast('Failed to join: ' + err.message, 'error');
    btnJoin.disabled = false;
    btnJoin.innerHTML = '<span>Join Room</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
});

// ── Enter key on join code field ──────────────────────────

joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

// ── Only allow digits in room code input ──────────────────

joinCodeInput.addEventListener('input', () => {
  joinCodeInput.value = joinCodeInput.value.replace(/\D/g, '').slice(0, 6);
});

// ══════════════════════════════════════════════════════════
//  SCREEN 2 — Waiting Screen
// ══════════════════════════════════════════════════════════

btnCopyCode.addEventListener('click', async () => {
  if (!app.roomId) return;
  try {
    await navigator.clipboard.writeText(app.roomId);
    showToast('Code copied to clipboard!', 'success', 2000);
  } catch {
    showToast('Code: ' + app.roomId, 'info', 5000);
  }
});

btnCancelWait.addEventListener('click', () => {
  closeConnection();
  deleteRoomDoc(app.roomId).catch(() => {});
  app.roomId = null;
  app.role   = null;
  showScreen('home');
  setConnectionStatus('idle');
  btnCreate.disabled = false;
  btnCreate.innerHTML = '<span>Create Room</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
});

// ══════════════════════════════════════════════════════════
//  SCREEN 3 — Transfer Screen
// ══════════════════════════════════════════════════════════

// ── Drop Zone ─────────────────────────────────────────────

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) {
    dropZone.classList.remove('drag-over');
  }
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  addFilesToQueue(files);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    addFilesToQueue(Array.from(fileInput.files));
    fileInput.value = '';
  }
});

// Also support global drag-drop anywhere on the transfer screen
document.getElementById('screen-transfer').addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

document.getElementById('screen-transfer').addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  addFilesToQueue(files);
});

// ── File Queue Management ─────────────────────────────────

function addFilesToQueue(files) {
  if (!app.connected) {
    showToast('Wait for peer to connect first', 'warning');
    return;
  }

  // 1 GB limit warning (soft limit — we still allow it)
  const huge = files.filter(f => f.size > 1024 * 1024 * 1024);
  if (huge.length) {
    showToast(`⚠️ ${huge.length} file(s) over 1 GB — may be slow`, 'warning');
  }

  app.files = [...app.files, ...files];
  renderFileQueue(app.files, (idx) => {
    app.files.splice(idx, 1);
    renderFileQueue(app.files, arguments.callee);
  });
}

// ── Send Button ───────────────────────────────────────────

btnSend.addEventListener('click', () => {
  if (!app.files.length) return;
  if (!app.connected) {
    showToast('Not connected to peer', 'error');
    return;
  }

  const filesToSend = [...app.files];
  app.files = [];
  renderFileQueue([], () => {});
  showToast(`📤 Sending ${filesToSend.length} file(s)…`, 'info');
  sendFiles(filesToSend);
});

// ── Pause / Resume / Cancel ───────────────────────────────

btnPause.addEventListener('click', pauseTransfer);
btnResume.addEventListener('click', resumeTransfer);
btnCancelTransfer.addEventListener('click', () => {
  if (confirm('Cancel current transfer?')) cancelTransfer();
});

// ── Disconnect ────────────────────────────────────────────

btnDisconnect.addEventListener('click', () => {
  if (confirm('Disconnect from peer?')) {
    handleDisconnect();
  }
});

function handleDisconnect() {
  closeConnection();
  app.connected = false;
  app.roomId    = null;
  app.role      = null;
  app.files     = [];

  document.body.classList.remove('receiver-mode');
  showScreen('home');
  setConnectionStatus('idle');

  // Reset create button
  btnCreate.disabled = false;
  btnCreate.innerHTML = '<span>Create Room</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';

  showToast('Disconnected', 'info');
}

// ══════════════════════════════════════════════════════════
//  WebRTC Callbacks
// ══════════════════════════════════════════════════════════

function onChannelOpen() {
  app.connected = true;
  setConnectionStatus('connected');
  showToast('🔗 Connected to peer!', 'success');

  if (app.role === 'sender') {
    // Transition from waiting → transfer screen
    footerRoomCode.textContent = app.roomId;
    document.getElementById('my-label').textContent   = 'You (Sender)';
    document.getElementById('peer-label').textContent = 'Peer (Receiver)';
    document.getElementById('my-avatar').textContent  = 'ME';
    document.getElementById('peer-avatar').textContent = 'RCV';
    showScreen('transfer');
  }
}

function onChannelClosed() {
  app.connected = false;

  if (document.getElementById('screen-transfer').classList.contains('active')) {
    showToast('⚠️ Peer disconnected', 'warning');
    setConnectionStatus('failed');
  }
}
