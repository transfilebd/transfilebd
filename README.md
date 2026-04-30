# P2P Share — Direct File Transfer

> **WebRTC + Firebase** দিয়ে তৈরি peer-to-peer file sharing app। কোনো server-এ file upload হয় না — সরাসরি device-to-device transfer।

---

## ✨ Features

- 🔗 **Peer-to-Peer transfer** — WebRTC DataChannel দিয়ে direct connection
- 🔥 **Firebase Signaling** — Firestore দিয়ে offer/answer/ICE exchange
- 🚀 **High Speed** — Same network-এ WiFi speed-এ transfer (10–50 MB/s+)
- 📁 **Large File Support** — 1 GB+ file পাঠানো যায়
- ⏸ **Pause / Resume** — Transfer control
- 📱 **Mobile Friendly** — Responsive UI
- 🌙 **Dark / Light Mode**
- 🔐 **Optional Password** — Room password protection

---

## 🚀 Quick Start (5 minutes)

### Step 1 — Firebase Project তৈরি করো

1. **https://console.firebase.google.com** এ যাও
2. **"Add project"** click করো → project name দাও (e.g. `p2p-share`)
3. Google Analytics **disable** করো (optional) → **Create project**

### Step 2 — Firestore Database এ যাও

1. Left menu → **"Firestore Database"** click করো
2. **"Create database"** → **"Start in test mode"** select করো → Next
3. Location select করো (e.g. `asia-south1` for Bangladesh) → **Enable**

### Step 3 — Firebase Config নাও

1. Project Settings (⚙️ gear icon) → **"Your apps"** section
2. **Web app** (`</>`) icon click করো → App nickname দাও → **Register app**
3. `firebaseConfig` object টা **copy** করো — এরকম দেখাবে:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### Step 4 — Config বসাও

`js/firebase-config.js` file খোলো এবং `FIREBASE_CONFIG` এর values replace করো:

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "তোমার apiKey",
  authDomain:        "তোমার authDomain",
  projectId:         "তোমার projectId",
  storageBucket:     "তোমার storageBucket",
  messagingSenderId: "তোমার messagingSenderId",
  appId:             "তোমার appId"
};
```

### Step 5 — Firestore Security Rules

Firebase Console → Firestore → **Rules** tab → এটা paste করো:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /p2p_rooms/{roomId} {
      // যেকেউ room তৈরি করতে পারবে
      allow create: if true;
      // শুধু room-এর data read/update করতে পারবে
      allow read, update: if true;
      // Room auto-delete হয়
      allow delete: if true;
    }
  }
}
```

> ⚠️ **Production-এ** আরো strict rules দাও। এটা basic demo rules।

---

## 🌐 GitHub Pages Deploy

### Method 1 — GitHub.com (Easy)

1. GitHub-এ নতুন **public repository** তৈরি করো (e.g. `p2p-share`)
2. সব files upload করো:
   - `index.html`
   - `css/style.css`
   - `js/firebase-config.js` (config বসানো)
   - `js/ui.js`
   - `js/webrtc.js`
   - `js/transfer.js`
   - `js/app.js`
3. Repository → **Settings** → **Pages**
4. Source: **"Deploy from a branch"** → Branch: `main` → `/root` → **Save**
5. কয়েক মিনিট পর `https://yourusername.github.io/p2p-share/` এ live!

### Method 2 — Git CLI

```bash
git init
git add .
git commit -m "Initial P2P Share"
git branch -M main
git remote add origin https://github.com/yourusername/p2p-share.git
git push -u origin main
```

---

## 📁 Project Structure

```
p2p-share/
├── index.html              # Main HTML (all screens)
├── css/
│   └── style.css           # Styles (dark/light theme)
├── js/
│   ├── firebase-config.js  # ⚠️ Firebase config এখানে বসাও
│   ├── ui.js               # Toast, screen, progress UI helpers
│   ├── webrtc.js           # WebRTC peer connection + signaling
│   ├── transfer.js         # File chunking + flow control engine
│   └── app.js              # Main controller (wires everything)
└── README.md
```

---

## 🔧 How It Works

```
Sender                    Firebase                  Receiver
  |                           |                         |
  |── createRoom(roomId) ────>|                         |
  |── setOffer(SDP) ─────────>|                         |
  |                           |<── joinRoom(roomId) ────|
  |                           |<── setAnswer(SDP) ──────|
  |<── onAnswer ──────────────|                         |
  |── addICE ────────────────>|── onSenderICE ─────────>|
  |<── onReceiverICE ─────────|<── addICE ──────────────|
  |                           |                         |
  |════════ WebRTC DataChannel OPEN ════════════════════|
  |                                                     |
  |── FILE_META ──────────────────────────────────────>|
  |── [chunk] [chunk] [chunk]... ─────────────────────>|
  |── FILE_DONE ──────────────────────────────────────>|
  |<── ACK ─────────────────────────────────────────── |
```

---

## 📱 Usage Guide

### Sender (ফাইল পাঠাবে):
1. **"Create Room"** click করো
2. Password দাও (optional)
3. **6-digit code** copy করো এবং receiver-কে share করো
4. Receiver connect হলে Transfer screen আসবে
5. Files drag করো বা click করে select করো
6. **"Send Files"** click করো

### Receiver (ফাইল নেবে):
1. **"Join Room"** click করো
2. 6-digit **code** দাও
3. Password দাও (যদি থাকে)
4. **"Join Room"** click করো
5. Files আসলে **Download** button দিয়ে save করো

---

## ⚡ Performance Tips

- **Same WiFi/hotspot**: সবচেয়ে fast (10–100 MB/s)
- **Different networks**: STUN server দিয়ে connect হবে (2–10 MB/s)
- **Mobile hotspot**: Phone দিয়ে hotspot create করে দুই device connect করো

---

## 🐛 Troubleshooting

| সমস্যা | সমাধান |
|--------|--------|
| Room not found | Code ঠিক আছে কিনা চেক করো |
| Connection failed | Same network-এ আছো কিনা দেখো। VPN off করো |
| Firebase error | `firebase-config.js` তে config ঠিকমতো বসানো কিনা দেখো |
| Slow transfer | Same WiFi-তে connect হও |
| File না আসা | Browser refresh করো |

---

## 🔐 Security Notes

- Files কখনো Firebase-এ store হয় না — শুধু signaling data
- Room data connection establish হলে auto-delete হয়
- Password SHA-256 hash হয়ে store হয়
- Production-এ Firebase Rules আরো restrict করো

---

## 📜 License

MIT — Free to use and modify.

---

Made with ❤️ using WebRTC + Firebase
