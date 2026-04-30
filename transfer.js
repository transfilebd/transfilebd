// ═══════════════════════════════════════════════════════════
//  transfer.js  —  File Transfer Engine  (High-Speed Edition)
//  Optimized for same-WiFi / hotspot P2P — target 5–50 MB/s
// ═══════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────
//
//  CHUNK_SIZE       : 256 KB — sweet spot for DataChannel throughput.
//                     Larger = fewer round-trips, less JS overhead.
//
//  BUFFER_HIGH      : 16 MB — keep the pipe full at all times.
//                     On same-WiFi the channel drains fast, so we
//                     pre-fill aggressively.
//
//  BUFFER_LOW_MARK  : 4 MB  — resume pumping only when there is
//                     enough headroom to queue several more chunks.
//
//  MAX_INFLIGHT     : 64 chunks pre-read into memory so disk/File
//                     API is never the bottleneck.

const CHUNK_SIZE      = 256 * 1024;       // 256 KB per chunk
const BUFFER_HIGH     = 16 * 1024 * 1024; // 16 MB  — pause threshold
const BUFFER_LOW_MARK = 4  * 1024 * 1024; // 4 MB   — resume mark
const MAX_INFLIGHT    = 64;               // chunks pre-buffered

// ── Message Types (sent as JSON header) ───────────────────

const MSG = {
  FILE_META:   'FILE_META',
  CHUNK:       'CHUNK',
  FILE_DONE:   'FILE_DONE',
  ACK:         'ACK',
  PAUSE:       'PAUSE',
  RESUME:      'RESUME',
  CANCEL:      'CANCEL',
};

// ── Sender State ──────────────────────────────────────────

let senderState = {
  queue:       [],
  currentIdx:  -1,
  paused:      false,
  cancelled:   false,
  resolve:     null,
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

// ── Speed / ETA Tracking ──────────────────────────────────

let transferStats = {
  startTime:   0,
  lastTime:    0,
  lastBytes:   0,
  totalSent:   0,
  smoothSpeed: 0,
};

function initStats() {
  const now = performance.now();
  transferStats = {
    startTime:   now,
    lastTime:    now,
    lastBytes:   0,
    totalSent:   0,
    smoothSpeed: 0,
  };
}

function updateStats(bytesSent, totalFileSize) {
  const now = performance.now();
  const dt  = (now - transferStats.lastTime) / 1000;
  if (dt < 0.05) return; // update at most every 50ms (fast enough for 50 MB/s display)

  const delta     = bytesSent - transferStats.lastBytes;
  const instSpeed = delta / dt;
  // Higher alpha (0.35) = more responsive to sudden speed changes
  const alpha     = 0.35;
  transferStats.smoothSpeed =
    transferStats.smoothSpeed === 0
      ? instSpeed
      : alpha * instSpeed + (1 - alpha) * transferStats.smoothSpeed;

  transferStats.lastTime  = now;
  transferStats.lastBytes = bytesSent;

  const speed     = transferStats.smoothSpeed;
  const remaining = totalFileSize - bytesSent;
  const eta       = speed > 0 ? remaining / speed : Infinity;
  const pct       = totalFileSize > 0 ? (bytesSent / totalFileSize) * 100 : 0;

  const speedStr =
    speed >= 1e6
      ? (speed / 1e6).toFixed(1) + ' MB/s'
      : speed >= 1e3
        ? (speed / 1e3).toFixed(0) + ' KB/s'
        : speed.toFixed(0) + ' B/s';

  updateProgress(pct, speedStr, formatETA(eta), formatBytes(bytesSent));
}

// ── Sender: Queue & Send ───────────────────────────────────

async function sendFiles(files) {
  senderState.queue      = [...files];
  senderState.currentIdx = 0;
  senderState.paused     = false;
  senderState.cancelled  = false;

  for (let i = 0; i < senderState.queue.length; i++) {
    if (senderState.cancelled) break;
    senderState.currentIdx = i;
    await sendSingleFile(senderState.queue[i]);
    addHistoryEntry(senderState.queue[i].name, senderState.queue[i].size, 'sent');
  }

  if (!senderState.cancelled) {
    showToast('✅ All files sent!', 'success');
    document.getElementById('active-transfer').classList.add('hidden');
  }
}

async function sendSingleFile(file) {
  const fileId = crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36);

  // UI setup
  document.getElementById('active-transfer').classList.remove('hidden');
  document.getElementById('tf-filename').textContent = file.name;
  document.getElementById('tf-filesize').textContent = formatBytes(file.size);
  initStats();
  resetProgress();

  // Send metadata
  sendData(JSON.stringify({
    type:   MSG.FILE_META,
    name:   file.name,
    size:   file.size,
    fileId,
  }));

  // Flow-control: resume pumping when buffer drains below BUFFER_LOW_MARK
  setBufferControl(BUFFER_LOW_MARK, () => {
    if (senderState.resolve) {
      senderState.resolve();
      senderState.resolve = null;
    }
  });

  // ── Pre-read pipeline ────────────────────────────────────
  //  We slice the file into ArrayBuffers ahead of time so the
  //  DataChannel is never waiting on File API reads.
  //  MAX_INFLIGHT chunks are kept in a ring buffer in memory.

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let   readIdx     = 0;   // next chunk index to read from disk
  let   sendIdx     = 0;   // next chunk index to send
  const prefetched  = [];  // ArrayBuffer[]

  // Prefetch first batch
  async function prefetchNext() {
    while (
      prefetched.length < MAX_INFLIGHT &&
      readIdx < totalChunks
    ) {
      const offset = readIdx * CHUNK_SIZE;
      const slice  = file.slice(offset, offset + CHUNK_SIZE);
      const buf    = await slice.arrayBuffer();
      prefetched.push(buf);
      readIdx++;
    }
  }

  await prefetchNext();

  let bytesSent = 0;

  while (sendIdx < totalChunks) {
    if (senderState.cancelled) return;

    // Pause
    while (senderState.paused) {
      await sleep(50);
      if (senderState.cancelled) return;
    }

    // Flow control — if buffer too full, wait
    if (getBufferedAmount() > BUFFER_HIGH) {
      await new Promise(resolve => { senderState.resolve = resolve; });
    }

    // Grab prefetched chunk
    if (prefetched.length === 0) {
      // Shouldn't happen often, but safeguard
      await prefetchNext();
      if (prefetched.length === 0) break;
    }

    const buffer = prefetched.shift();

    const sent = sendData(buffer);
    if (!sent) {
      showToast('❌ Send failed — connection issue', 'error');
      return;
    }

    bytesSent += buffer.byteLength;
    sendIdx++;

    // Keep prefetch pipeline full in background (non-blocking)
    prefetchNext();

    updateStats(bytesSent, file.size);
  }

  // Done signal
  sendData(JSON.stringify({ type: MSG.FILE_DONE, fileId }));

  // Wait for ACK (max 10s)
  await waitForAck(fileId, 10000);
}

// ── ACK Handling ──────────────────────────────────────────

let pendingAcks = {};

function waitForAck(fileId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      delete pendingAcks[fileId];
      resolve();
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

// ── Receiver: Handle Incoming Data ────────────────────────

function handleIncomingData(data) {
  if (typeof data === 'string') {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    handleControlMessage(msg);
    return;
  }
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
    received:  0,
  };

  document.getElementById('active-transfer').classList.remove('hidden');
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

  // Reconstruct file — use a single Blob() call instead of Uint8Array copy
  // for large files this is significantly faster (no extra memory copy)
  const blob    = new Blob(receiverState.chunks);
  const blobUrl = URL.createObjectURL(blob);

  updateProgress(100, '—', 'Done!', formatBytes(receiverState.fileSize));
  document.getElementById('active-transfer').classList.add('hidden');

  addReceivedFile(receiverState.fileName, receiverState.fileSize, blobUrl);
  addHistoryEntry(receiverState.fileName, receiverState.fileSize, 'recv');
  showToast(`✅ Received: ${receiverState.fileName}`, 'success');

  sendData(JSON.stringify({ type: MSG.ACK, fileId }));

  receiverState.chunks = [];
  resetProgress();
  setTimeout(resetProgress, 2000);
}

// ── Utility ───────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
