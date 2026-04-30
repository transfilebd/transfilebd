// ═══════════════════════════════════════════════════════════
//  transfer.js  —  File Transfer Engine
//  Chunk-based P2P file transfer with flow control
// ═══════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────

const CHUNK_SIZE        = 64 * 1024;   // 64 KB per chunk
const BUFFER_THRESHOLD  = 256 * 1024;  // 256 KB — pause when buffer exceeds this
const BUFFER_LOW_MARK   = 64 * 1024;   // resume when buffer drops below this

// ── Message Types (sent as JSON header) ──────────────────

const MSG = {
  FILE_META:   'FILE_META',    // {type, name, size, fileId}
  CHUNK:       'CHUNK',        // ArrayBuffer after header strip
  FILE_DONE:   'FILE_DONE',    // {type, fileId}
  ACK:         'ACK',          // {type, fileId} — receiver confirms
  PAUSE:       'PAUSE',        // sender requests pause
  RESUME:      'RESUME',       // sender resumes
  CANCEL:      'CANCEL',       // cancel current file
};

// ── Sender State ─────────────────────────────────────────

let senderState = {
  queue:       [],    // File[]
  currentIdx:  -1,
  paused:      false,
  cancelled:   false,
  resolve:     null,  // promise resolver for flow-control wait
};

// ── Receiver State ────────────────────────────────────────

let receiverState = {
  receiving:   false,
  fileName:    '',
  fileSize:    0,
  fileId:      '',
  chunks:      [],
  received:    0,
};

// ── Speed / ETA Tracking ─────────────────────────────────

let transferStats = {
  startTime:      0,
  lastTime:       0,
  lastBytes:      0,
  totalSent:      0,
  smoothSpeed:    0,  // exponential moving average
};

function initStats() {
  const now = performance.now();
  transferStats = {
    startTime:  now,
    lastTime:   now,
    lastBytes:  0,
    totalSent:  0,
    smoothSpeed: 0
  };
}

function updateStats(bytesSent, totalFileSize) {
  const now    = performance.now();
  const dt     = (now - transferStats.lastTime) / 1000; // seconds
  if (dt < 0.1) return; // don't update too frequently

  const deltaSent  = bytesSent - transferStats.lastBytes;
  const instSpeed  = deltaSent / dt;                     // bytes/sec
  const alpha      = 0.2; // EMA smoothing factor
  transferStats.smoothSpeed = alpha * instSpeed + (1 - alpha) * (transferStats.smoothSpeed || instSpeed);

  transferStats.lastTime  = now;
  transferStats.lastBytes = bytesSent;

  const speed    = transferStats.smoothSpeed;
  const remaining = totalFileSize - bytesSent;
  const eta      = speed > 0 ? remaining / speed : Infinity;
  const pct      = totalFileSize > 0 ? (bytesSent / totalFileSize) * 100 : 0;

  const speedStr = speed >= 1e6
    ? (speed / 1e6).toFixed(1) + ' MB/s'
    : speed >= 1e3
      ? (speed / 1e3).toFixed(0) + ' KB/s'
      : speed.toFixed(0) + ' B/s';

  updateProgress(pct, speedStr, formatETA(eta), formatBytes(bytesSent));
}

// ── Sender: Queue & Send ──────────────────────────────────

/**
 * Start sending queued files
 * @param {File[]} files
 */
async function sendFiles(files) {
  senderState.queue     = [...files];
  senderState.currentIdx = 0;
  senderState.paused    = false;
  senderState.cancelled = false;

  for (let i = 0; i < senderState.queue.length; i++) {
    if (senderState.cancelled) break;
    senderState.currentIdx = i;
    await sendSingleFile(senderState.queue[i]);

    // Add to history
    addHistoryEntry(senderState.queue[i].name, senderState.queue[i].size, 'sent');
  }

  if (!senderState.cancelled) {
    showToast('✅ All files sent!', 'success');
    document.getElementById('active-transfer').classList.add('hidden');
  }
}

async function sendSingleFile(file) {
  const fileId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);

  // Show active transfer UI
  const activeTransfer = document.getElementById('active-transfer');
  activeTransfer.classList.remove('hidden');
  document.getElementById('tf-filename').textContent = file.name;
  document.getElementById('tf-filesize').textContent = formatBytes(file.size);
  initStats();
  resetProgress();

  // Send metadata header
  sendData(JSON.stringify({
    type:   MSG.FILE_META,
    name:   file.name,
    size:   file.size,
    fileId: fileId
  }));

  // Set up flow control
  setBufferControl(BUFFER_LOW_MARK, () => {
    if (senderState.resolve) {
      senderState.resolve();
      senderState.resolve = null;
    }
  });

  // Read & send chunks
  let offset = 0;

  while (offset < file.size) {
    if (senderState.cancelled) return;

    // Pause logic
    while (senderState.paused) {
      await sleep(100);
      if (senderState.cancelled) return;
    }

    // Flow control — wait if buffer is full
    if (getBufferedAmount() > BUFFER_THRESHOLD) {
      await new Promise(resolve => { senderState.resolve = resolve; });
    }

    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await chunk.arrayBuffer();
    const sent = sendData(buffer);
    if (!sent) {
      showToast('❌ Send failed — connection issue', 'error');
      return;
    }

    offset += buffer.byteLength;
    updateStats(offset, file.size);
  }

  // Send completion signal
  sendData(JSON.stringify({ type: MSG.FILE_DONE, fileId }));

  // Wait for ACK from receiver (max 10s)
  await waitForAck(fileId, 10000);
}

// ── ACK Handling ─────────────────────────────────────────

let pendingAcks = {};

function waitForAck(fileId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      delete pendingAcks[fileId];
      resolve(); // proceed anyway after timeout
    }, timeoutMs);

    pendingAcks[fileId] = () => {
      clearTimeout(timer);
      delete pendingAcks[fileId];
      resolve();
    };
  });
}

// ── Sender Controls ───────────────────────────────────────

function pauseTransfer() {
  senderState.paused = true;
  sendData(JSON.stringify({ type: MSG.PAUSE }));
  document.getElementById('btn-pause').classList.add('hidden');
  document.getElementById('btn-resume').classList.remove('hidden');
  showToast('⏸ Transfer paused', 'info');
}

function resumeTransfer() {
  senderState.paused = false;
  sendData(JSON.stringify({ type: MSG.RESUME }));
  document.getElementById('btn-pause').classList.remove('hidden');
  document.getElementById('btn-resume').classList.add('hidden');
  showToast('▶ Transfer resumed', 'info');
}

function cancelTransfer() {
  senderState.cancelled = true;
  senderState.paused    = false;
  if (senderState.resolve) {
    senderState.resolve();
    senderState.resolve = null;
  }
  sendData(JSON.stringify({ type: MSG.CANCEL }));
  document.getElementById('active-transfer').classList.add('hidden');
  resetProgress();
  showToast('✖ Transfer cancelled', 'warning');
}

// ── Receiver: Handle Incoming Data ───────────────────────

/**
 * Called by webrtc.js onChannelData for every message
 * @param {ArrayBuffer|string} data
 */
function handleIncomingData(data) {
  // String messages = JSON control frames
  if (typeof data === 'string') {
    let msg;
    try { msg = JSON.parse(data); } catch(e) { return; }
    handleControlMessage(msg);
    return;
  }

  // Binary = chunk
  if (data instanceof ArrayBuffer) {
    handleChunk(data);
  }
}

function handleControlMessage(msg) {
  switch (msg.type) {
    case MSG.FILE_META:
      startReceiving(msg);
      break;

    case MSG.FILE_DONE:
      finishReceiving(msg.fileId);
      break;

    case MSG.ACK:
      // Sender received ACK - used on sender side via pendingAcks
      if (pendingAcks[msg.fileId]) pendingAcks[msg.fileId]();
      break;

    case MSG.PAUSE:
      showToast('⏸ Sender paused', 'info');
      break;

    case MSG.RESUME:
      showToast('▶ Sender resumed', 'info');
      break;

    case MSG.CANCEL:
      receiverState.receiving = false;
      receiverState.chunks    = [];
      resetProgress();
      document.getElementById('active-transfer').classList.add('hidden');
      showToast('✖ Transfer cancelled by sender', 'warning');
      break;
  }
}

function startReceiving(meta) {
  receiverState = {
    receiving: true,
    fileName:  meta.name,
    fileSize:  meta.size,
    fileId:    meta.fileId,
    chunks:    [],
    received:  0
  };

  // Show progress UI
  const activeTransfer = document.getElementById('active-transfer');
  activeTransfer.classList.remove('hidden');
  document.getElementById('tf-filename').textContent = meta.name;
  document.getElementById('tf-filesize').textContent = formatBytes(meta.size);
  initStats();
  resetProgress();
  showToast(`📥 Receiving: ${meta.name}`, 'info');
}

function handleChunk(buffer) {
  if (!receiverState.receiving) return;

  receiverState.chunks.push(buffer);
  receiverState.received += buffer.byteLength;
  updateStats(receiverState.received, receiverState.fileSize);
}

function finishReceiving(fileId) {
  if (!receiverState.receiving || receiverState.fileId !== fileId) return;

  receiverState.receiving = false;

  // Reconstruct the file from chunks
  const totalSize = receiverState.chunks.reduce((s, c) => s + c.byteLength, 0);
  const combined  = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of receiverState.chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  const blob    = new Blob([combined]);
  const blobUrl = URL.createObjectURL(blob);

  // Update UI
  updateProgress(100, '—', 'Done!', formatBytes(totalSize));
  document.getElementById('active-transfer').classList.add('hidden');

  addReceivedFile(receiverState.fileName, receiverState.fileSize, blobUrl);
  addHistoryEntry(receiverState.fileName, receiverState.fileSize, 'recv');
  showToast(`✅ Received: ${receiverState.fileName}`, 'success');

  // Send ACK to sender
  sendData(JSON.stringify({ type: MSG.ACK, fileId }));

  // Clean up chunks to free memory
  receiverState.chunks = [];
  resetProgress();
  setTimeout(resetProgress, 2000);
}

// ── Utility ──────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
