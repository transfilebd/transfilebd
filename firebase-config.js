// ═══════════════════════════════════════════════════════════
//  firebase-config.js
//  ⚠️  এখানে তোমার Firebase project-এর config বসাও
//  Firebase Console → Project Settings → Your apps → Config
// ═══════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();

// ── Firestore Collection Names ──
const ROOMS_COLLECTION = "p2p_rooms";

// ══════════════════════════════════════════════════
//  Firebase Signaling Helpers
// ══════════════════════════════════════════════════

/**
 * Create a new room document in Firestore
 * @param {string} roomId  - 6-digit code
 * @param {string} pwdHash - SHA-256 hash of password (or '' if none)
 */
async function createRoomDoc(roomId, pwdHash) {
  const ref = db.collection(ROOMS_COLLECTION).doc(roomId);
  await ref.set({
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    passwordHash: pwdHash,
    offer: null,
    answer: null,
    senderCandidates: [],
    receiverCandidates: []
  });
  return ref;
}

/**
 * Check if room exists and return its data
 */
async function getRoomDoc(roomId) {
  const snap = await db.collection(ROOMS_COLLECTION).doc(roomId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Store SDP offer into room
 */
async function setOffer(roomId, offerSdp) {
  await db.collection(ROOMS_COLLECTION).doc(roomId).update({
    offer: offerSdp
  });
}

/**
 * Store SDP answer into room
 */
async function setAnswer(roomId, answerSdp) {
  await db.collection(ROOMS_COLLECTION).doc(roomId).update({
    answer: answerSdp
  });
}

/**
 * Add a sender ICE candidate
 */
async function addSenderCandidate(roomId, candidate) {
  await db.collection(ROOMS_COLLECTION).doc(roomId).update({
    senderCandidates: firebase.firestore.FieldValue.arrayUnion(candidate)
  });
}

/**
 * Add a receiver ICE candidate
 */
async function addReceiverCandidate(roomId, candidate) {
  await db.collection(ROOMS_COLLECTION).doc(roomId).update({
    receiverCandidates: firebase.firestore.FieldValue.arrayUnion(candidate)
  });
}

/**
 * Delete room after connection established (cleanup)
 */
async function deleteRoomDoc(roomId) {
  try {
    await db.collection(ROOMS_COLLECTION).doc(roomId).delete();
  } catch (e) {
    console.warn("Room cleanup skipped:", e.message);
  }
}

/**
 * Listen for answer on room (sender side)
 * @returns unsubscribe function
 */
function onAnswer(roomId, callback) {
  return db.collection(ROOMS_COLLECTION).doc(roomId)
    .onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data.answer) callback(data.answer);
    });
}

/**
 * Listen for offer on room (receiver side)
 * @returns unsubscribe function
 */
function onOffer(roomId, callback) {
  return db.collection(ROOMS_COLLECTION).doc(roomId)
    .onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data.offer) callback(data.offer);
    });
}

/**
 * Listen for receiver candidates (sender side)
 */
function onReceiverCandidates(roomId, callback) {
  let knownCount = 0;
  return db.collection(ROOMS_COLLECTION).doc(roomId)
    .onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      const all = data.receiverCandidates || [];
      const newOnes = all.slice(knownCount);
      knownCount = all.length;
      newOnes.forEach(c => callback(c));
    });
}

/**
 * Listen for sender candidates (receiver side)
 */
function onSenderCandidates(roomId, callback) {
  let knownCount = 0;
  return db.collection(ROOMS_COLLECTION).doc(roomId)
    .onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      const all = data.senderCandidates || [];
      const newOnes = all.slice(knownCount);
      knownCount = all.length;
      newOnes.forEach(c => callback(c));
    });
}

/**
 * Simple SHA-256 hash for room password
 */
async function hashPassword(pwd) {
  if (!pwd) return '';
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(pwd));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random 6-digit room code
 */
function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
