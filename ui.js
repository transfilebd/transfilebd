// ═══════════════════════════════════════════════════════════
//  ui.js  —  UI Helpers: toast, screen, theme, progress
// ═══════════════════════════════════════════════════════════

// ── Toast Notification ──────────────────────────────────

const TOAST_ICONS = {
  success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`,
  error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="#00e5ff"/></svg>`,
  warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="#f59e0b"/></svg>`
};

/**
 * Show a toast notification
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {number} duration ms
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${TOAST_ICONS[type] || ''}<span>${message}</span>`;
  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// ── Screen Navigation ────────────────────────────────────

const SCREENS = {
  home:     document.getElementById('screen-home'),
  waiting:  document.getElementById('screen-waiting'),
  transfer: document.getElementById('screen-transfer')
};

function showScreen(name) {
  Object.entries(SCREENS).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

// ── Connection Badge ─────────────────────────────────────

const connBadge  = document.getElementById('connection-badge');
const badgeLabel = connBadge.querySelector('.badge-label');

function setConnectionStatus(status) {
  // status: 'idle' | 'connecting' | 'connected' | 'failed'
  connBadge.className = `conn-badge badge-${status}`;
  const labels = {
    idle:       'Offline',
    connecting: 'Connecting…',
    connected:  'Connected',
    failed:     'Failed'
  };
  badgeLabel.textContent = labels[status] || status;
}

// ── Theme Toggle ─────────────────────────────────────────

const themeBtn  = document.getElementById('theme-toggle');
const iconSun   = document.getElementById('icon-sun');
const iconMoon  = document.getElementById('icon-moon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  iconSun.style.display  = theme === 'light' ? 'block' : 'none';
  iconMoon.style.display = theme === 'dark'  ? 'block' : 'none';
  localStorage.setItem('p2p_theme', theme);
}

// Load saved theme
applyTheme(localStorage.getItem('p2p_theme') || 'dark');

themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ── Progress Bar ─────────────────────────────────────────

const progressFill = document.getElementById('progress-fill');
const progressGlow = document.getElementById('progress-glow');
const tfPct        = document.getElementById('tf-pct');
const statSpeed    = document.getElementById('stat-speed');
const statEta      = document.getElementById('stat-eta');
const statTransf   = document.getElementById('stat-transferred');

function updateProgress(pct, speed, eta, transferred) {
  const p = Math.min(100, Math.max(0, pct));
  progressFill.style.width = p + '%';
  progressGlow.style.width = p + '%';
  tfPct.textContent = Math.round(p) + '%';
  statSpeed.textContent  = speed     || '— MB/s';
  statEta.textContent    = eta       || '—';
  statTransf.textContent = transferred || '0 B';
}

function resetProgress() {
  updateProgress(0, null, null, null);
}

// ── File Queue UI ────────────────────────────────────────

const fileQueueEl  = document.getElementById('file-queue');
const sendActionsEl = document.getElementById('send-actions');

/**
 * Render the queued files list
 * @param {File[]} files
 * @param {Function} onRemove - callback(index)
 */
function renderFileQueue(files, onRemove) {
  if (!files.length) {
    fileQueueEl.classList.add('hidden');
    sendActionsEl.classList.add('hidden');
    return;
  }

  fileQueueEl.classList.remove('hidden');
  sendActionsEl.classList.remove('hidden');
  fileQueueEl.innerHTML = '';

  files.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'file-queue-item';
    item.innerHTML = `
      <span class="fq-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
        </svg>
      </span>
      <span class="fq-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
      <span class="fq-size">${formatBytes(file.size)}</span>
      <button class="fq-remove" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    item.querySelector('.fq-remove').addEventListener('click', () => onRemove(i));
    fileQueueEl.appendChild(item);
  });
}

/**
 * Add a completed file to the "Received Files" section (receiver side)
 */
function addReceivedFile(fileName, fileSize, blobUrl) {
  const title = document.getElementById('received-title');
  const list  = document.getElementById('received-list');
  title.style.display = 'block';

  const item = document.createElement('div');
  item.className = 'received-item';
  item.innerHTML = `
    <span class="recv-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
    </span>
    <span class="recv-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
    <span class="recv-size">${formatBytes(fileSize)}</span>
    <a href="${blobUrl}" download="${escapeHtml(fileName)}" class="recv-download">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download
    </a>
  `;
  list.appendChild(item);
}

/**
 * Add entry to transfer history
 */
function addHistoryEntry(fileName, fileSize, direction) {
  const wrap = document.getElementById('transfer-history');
  const list = document.getElementById('history-list');
  wrap.classList.remove('hidden');

  const item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted)">
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
    </svg>
    <span class="hist-name" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</span>
    <span class="hist-size">${formatBytes(fileSize)}</span>
    <span class="hist-badge ${direction === 'sent' ? 'hist-sent' : 'hist-recv'}">${direction === 'sent' ? '↑ Sent' : '↓ Recv'}</span>
  `;
  list.insertBefore(item, list.firstChild);
}

// ── Utility ──────────────────────────────────────────────

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0) + ' ' + sizes[i];
}

/**
 * Format seconds to human-readable ETA
 */
function formatETA(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return Math.ceil(seconds) + 's';
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
