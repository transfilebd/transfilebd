// ═══════════════════════════════════════════════════════════
//  webrtc.js  —  WebRTC Peer Connection + Signaling
// ═══════════════════════════════════════════════════════════

// ── ICE Config (STUN servers) ───────────────────────────

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

// ── State ────────────────────────────────────────────────

let peerConnection  = null;
let dataChannel     = null;
let currentRoomId   = null;
let isSender        = false;
let unsubscribeFns  = [];   // Firebase listener cleanup
let onChannelReady  = null; // callback when DataChannel opens
let onChannelData   = null; // callback when data arrives
let onChannelClose  = null; // callback on close

// ── Create PeerConnection ────────────────────────────────

function createPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  // Log state changes
  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    console.log('[WebRTC] ICE state:', state);

    if (state === 'connected' || state === 'completed') {
      setConnectionStatus('connected');
      showToast('🔗 Peer connected!', 'success');
    } else if (state === 'disconnected') {
      setConnectionStatus('failed');
      showToast('⚠️ Connection lost. Retrying…', 'warning');
    } else if (state === 'failed') {
      setConnectionStatus('failed');
      showToast('❌ Connection failed', 'error');
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', peerConnection.connectionState);
  };

  return peerConnection;
}

// ── Sender Flow ──────────────────────────────────────────

/**
 * Sender: Create offer and begin signaling
 * @param {string} roomId
 * @param {Function} onReady - called when DataChannel is open
 * @param {Function} onData  - called when data arrives (for ACK etc.)
 * @param {Function} onClose - called when channel closes
 */
async function startAsSender(roomId, onReady, onData, onClose) {
  currentRoomId   = roomId;
  isSender        = true;
  onChannelReady  = onReady;
  onChannelData   = onData;
  onChannelClose  = onClose;

  const pc = createPeerConnection();
  setConnectionStatus('connecting');

  // Create DataChannel (sender always creates it)
  dataChannel = pc.createDataChannel('fileTransfer', {
    ordered: true,
    // bufferedAmountLowThreshold set in transfer.js
  });

  setupDataChannelEvents(dataChannel);

  // Collect ICE candidates and push to Firestore
  pc.onicecandidate = async ({ candidate }) => {
    if (candidate) {
      await addSenderCandidate(roomId, candidate.toJSON());
    }
  };

  // Create and store offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setOffer(roomId, { type: offer.type, sdp: offer.sdp });

  // Listen for answer
  const unsubAnswer = onAnswer(roomId, async (answerSdp) => {
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
    }
  });

  // Listen for receiver candidates
  const unsubCandidates = onReceiverCandidates(roomId, async (c) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      console.warn('ICE candidate error:', e);
    }
  });

  unsubscribeFns.push(unsubAnswer, unsubCandidates);
}

// ── Receiver Flow ────────────────────────────────────────

/**
 * Receiver: Listen for offer and create answer
 */
async function startAsReceiver(roomId, onReady, onData, onClose) {
  currentRoomId  = roomId;
  isSender       = false;
  onChannelReady = onReady;
  onChannelData  = onData;
  onChannelClose = onClose;

  const pc = createPeerConnection();
  setConnectionStatus('connecting');

  // ICE candidates
  pc.onicecandidate = async ({ candidate }) => {
    if (candidate) {
      await addReceiverCandidate(roomId, candidate.toJSON());
    }
  };

  // DataChannel arrives from sender
  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannelEvents(dataChannel);
  };

  // Listen for sender candidates
  const unsubCandidates = onSenderCandidates(roomId, async (c) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      console.warn('ICE candidate error:', e);
    }
  });

  // Listen for offer, then create answer
  const unsubOffer = onOffer(roomId, async (offerSdp) => {
    if (pc.signalingState !== 'stable') return;
    await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await setAnswer(roomId, { type: answer.type, sdp: answer.sdp });
  });

  unsubscribeFns.push(unsubOffer, unsubCandidates);
}

// ── DataChannel Events ───────────────────────────────────

function setupDataChannelEvents(channel) {
  channel.binaryType = 'arraybuffer';

  channel.onopen = () => {
    console.log('[DataChannel] Open');
    // Clean up signaling data after connection
    setTimeout(() => deleteRoomDoc(currentRoomId), 2000);
    if (onChannelReady) onChannelReady();
  };

  channel.onmessage = (event) => {
    if (onChannelData) onChannelData(event.data);
  };

  channel.onerror = (err) => {
    console.error('[DataChannel] Error:', err);
    showToast('DataChannel error', 'error');
  };

  channel.onclose = () => {
    console.log('[DataChannel] Closed');
    setConnectionStatus('idle');
    if (onChannelClose) onChannelClose();
  };
}

// ── Send Data ────────────────────────────────────────────

/**
 * Send raw data through DataChannel
 * @param {ArrayBuffer|string} data
 * @returns {boolean} success
 */
function sendData(data) {
  if (!dataChannel || dataChannel.readyState !== 'open') return false;
  try {
    dataChannel.send(data);
    return true;
  } catch (e) {
    console.error('Send error:', e);
    return false;
  }
}

/**
 * Get DataChannel buffered amount (for flow control)
 */
function getBufferedAmount() {
  return dataChannel ? dataChannel.bufferedAmount : 0;
}

/**
 * Set bufferedAmountLowThreshold and callback for flow control
 */
function setBufferControl(threshold, callback) {
  if (!dataChannel) return;
  dataChannel.bufferedAmountLowThreshold = threshold;
  dataChannel.onbufferedamountlow = callback;
}

// ── Cleanup ──────────────────────────────────────────────

function closeConnection() {
  // Stop all Firebase listeners
  unsubscribeFns.forEach(fn => { try { fn(); } catch(e) {} });
  unsubscribeFns = [];

  if (dataChannel) {
    dataChannel.onopen    = null;
    dataChannel.onmessage = null;
    dataChannel.onerror   = null;
    dataChannel.onclose   = null;
    try { dataChannel.close(); } catch(e) {}
    dataChannel = null;
  }

  if (peerConnection) {
    peerConnection.onicecandidate           = null;
    peerConnection.ondatachannel            = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.onconnectionstatechange  = null;
    try { peerConnection.close(); } catch(e) {}
    peerConnection = null;
  }

  setConnectionStatus('idle');
  currentRoomId = null;
}
