import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection,
  query, where, getDocs, onSnapshot, orderBy, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const DEFAULT_AVATAR = "https://api.dicebear.com/7.x/identicon/svg?seed=";

let me = null;           // { uid, displayName, tag, avatarUrl, theme }
let currentServerId = null;
let currentChannelId = null;
let currentDmId = null;
let unsubMessages = null;
let unsubChannels = null;
let unsubServerList = null;

const $ = (id) => document.getElementById(id);

/* ---------------- helpers ---------------- */
function usernameKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}
function randomTag() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
function randomCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function fmtTime(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function showToast(msg) {
  const t = $("invite-toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2500);
}
function closeNav() { $("app").classList.remove("nav-open"); }

/* ---------------- auth ---------------- */
$("nav-toggle").onclick = () => $("app").classList.toggle("nav-open");

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    $("login-form").classList.toggle("hidden", tab.dataset.tab !== "login");
    $("signup-form").classList.toggle("hidden", tab.dataset.tab !== "signup");
  };
});

$("signup-form").onsubmit = async (e) => {
  e.preventDefault();
  const errEl = $("signup-error");
  errEl.textContent = "";
  const displayName = $("signup-name").value.trim();
  const password = $("signup-password").value;
  const avatarUrl = $("signup-avatar").value.trim();
  const key = usernameKey(displayName);

  if (!key) { errEl.textContent = "Enter a display name."; return; }

  try {
    const takenSnap = await getDoc(doc(db, "usernames", key));
    if (takenSnap.exists()) { errEl.textContent = "That name is taken."; return; }

    const fakeEmail = `${key}@ilx.local`;
    const cred = await createUserWithEmailAndPassword(auth, fakeEmail, password);

    await setDoc(doc(db, "usernames", key), { email: fakeEmail, uid: cred.user.uid });
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName,
      tag: randomTag(),
      avatarUrl: avatarUrl || DEFAULT_AVATAR + encodeURIComponent(displayName),
      theme: { mode: "dark", accent: "#3AA6A0" },
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
  }
};

$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const errEl = $("login-error");
  errEl.textContent = "";
  const displayName = $("login-name").value.trim();
  const password = $("login-password").value;
  const key = usernameKey(displayName);

  try {
    const unameSnap = await getDoc(doc(db, "usernames", key));
    if (!unameSnap.exists()) { errEl.textContent = "No account with that name."; return; }
    await signInWithEmailAndPassword(auth, unameSnap.data().email, password);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
  }
};

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Wrong password.";
  if (code.includes("weak-password")) return "Password needs to be 6+ characters.";
  if (code.includes("email-already-in-use")) return "That name is taken.";
  return "Something went wrong. Try again.";
}

$("logout-btn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    me = null;
    $("auth-screen").classList.remove("hidden");
    $("app").classList.add("hidden");
    return;
  }
  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists()) return; // profile still being created
  me = { uid: user.uid, ...userSnap.data() };

  $("auth-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("me-avatar").src = me.avatarUrl;
  $("me-name").textContent = me.displayName;
  $("me-tag").textContent = "#" + me.tag;

  applyTheme(me.theme?.mode || "dark", me.theme?.accent || "#3AA6A0", false);
  loadServerList();
  showHome();
});

/* ---------------- server rail ---------------- */
function loadServerList() {
  if (unsubServerList) unsubServerList();
  const q = query(collection(db, "servers"), where("memberIds", "array-contains", me.uid));
  unsubServerList = onSnapshot(q, (snap) => {
    const list = $("server-list");
    list.innerHTML = "";
    snap.forEach((d) => {
      const server = d.data();
      const btn = document.createElement("button");
      btn.className = "server-icon" + (currentServerId === d.id ? " active" : "");
      btn.title = server.name;
      btn.textContent = server.name.slice(0, 2).toUpperCase();
      btn.onclick = () => openServer(d.id, server);
      list.appendChild(btn);
    });
  });
}

$("home-btn").onclick = showHome;
$("add-server-btn").onclick = () => { $("server-modal").classList.remove("hidden"); $("server-modal-error").textContent = ""; };
$("close-server-modal").onclick = () => $("server-modal").classList.add("hidden");

document.querySelectorAll(".modal-tab").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".modal-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    $("create-server-form").classList.toggle("hidden", tab.dataset.mtab !== "create");
    $("join-server-form").classList.toggle("hidden", tab.dataset.mtab !== "join");
  };
});

$("create-server-form").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("new-server-name").value.trim();
  const isCommunity = $("new-server-community").checked;
  const inviteCode = randomCode();
  try {
    const serverRef = await addDoc(collection(db, "servers"), {
      name, ownerId: me.uid, inviteCode, isCommunity,
      memberIds: [me.uid], createdAt: serverTimestamp(),
    });
    const defaultChannels = isCommunity ? ["announcements", "rules", "general"] : ["general"];
    for (const ch of defaultChannels) {
      await addDoc(collection(db, "servers", serverRef.id, "channels"), { name: ch, createdAt: serverTimestamp() });
    }
    $("server-modal").classList.add("hidden");
    $("new-server-name").value = "";
    showToast(`Server created. Invite code: ${inviteCode}`);
    openServer(serverRef.id, { name });
  } catch (err) {
    $("server-modal-error").textContent = "Couldn't create server.";
  }
};

$("join-server-form").onsubmit = async (e) => {
  e.preventDefault();
  const code = $("join-code").value.trim().toUpperCase();
  const errEl = $("server-modal-error");
  try {
    const q = query(collection(db, "servers"), where("inviteCode", "==", code));
    const snap = await getDocs(q);
    if (snap.empty) { errEl.textContent = "Invalid invite code."; return; }
    const serverDoc = snap.docs[0];
    await updateDoc(serverDoc.ref, { memberIds: arrayUnion(me.uid) });
    $("server-modal").classList.add("hidden");
    $("join-code").value = "";
    openServer(serverDoc.id, serverDoc.data());
  } catch (err) {
    errEl.textContent = "Couldn't join server.";
  }
};

/* ---------------- channels ---------------- */
function openServer(serverId, serverData) {
  currentServerId = serverId;
  currentDmId = null;
  $("home-btn").classList.remove("active");
  document.querySelectorAll(".server-icon").forEach(b => b.classList.remove("active"));
  $("sidebar-header").textContent = serverData.name || "Server";
  closeNav();
  loadChannelList(serverId);
  clearChat();
}

function loadChannelList(serverId) {
  if (unsubChannels) unsubChannels();
  const q = query(collection(db, "servers", serverId, "channels"), orderBy("createdAt"));
  unsubChannels = onSnapshot(q, (snap) => {
    const list = $("sidebar-list");
    list.innerHTML = "";
    const label = document.createElement("div");
    label.className = "sidebar-section-label";
    label.textContent = "Text Channels";
    list.appendChild(label);
    snap.forEach((d) => {
      const ch = d.data();
      const item = document.createElement("button");
      item.className = "sidebar-item" + (currentChannelId === d.id ? " active" : "");
      item.textContent = "# " + ch.name;
      item.onclick = () => openChannel(serverId, d.id, ch.name);
      list.appendChild(item);
    });
  });
}

function openChannel(serverId, channelId, name) {
  currentChannelId = channelId;
  $("chat-title").textContent = "# " + name;
  document.querySelectorAll(".sidebar-item").forEach(i => i.classList.remove("active"));
  loadChannelList(serverId); // refresh active state
  subscribeMessages(collection(db, "servers", serverId, "channels", channelId, "messages"));
  enableComposer(async (text) => {
    await addDoc(collection(db, "servers", serverId, "channels", channelId, "messages"), {
      text, senderId: me.uid, senderName: me.displayName, senderAvatar: me.avatarUrl,
      createdAt: serverTimestamp(),
    });
  });
  closeNav();
}

/* ---------------- direct messages ---------------- */
function showHome() {
  currentServerId = null;
  currentChannelId = null;
  currentDmId = null;
  $("home-btn").classList.add("active");
  document.querySelectorAll(".server-icon").forEach(b => b.classList.remove("active"));
  $("sidebar-header").textContent = "Direct Messages";
  loadDmList();
  clearChat();
  closeNav();
}

function loadDmList() {
  if (unsubChannels) unsubChannels();
  const q = query(collection(db, "dms"), where("participantIds", "array-contains", me.uid));
  unsubChannels = onSnapshot(q, async (snap) => {
    const list = $("sidebar-list");
    list.innerHTML = "";
    const newBtn = document.createElement("button");
    newBtn.className = "sidebar-item new-dm";
    newBtn.textContent = "+ New message";
    newBtn.onclick = () => { $("dm-modal").classList.remove("hidden"); $("dm-modal-error").textContent = ""; };
    list.appendChild(newBtn);

    for (const d of snap.docs) {
      const dm = d.data();
      const otherUid = dm.participantIds.find((u) => u !== me.uid);
      if (!otherUid) continue;
      const otherSnap = await getDoc(doc(db, "users", otherUid));
      const other = otherSnap.exists() ? otherSnap.data() : { displayName: "Unknown user", avatarUrl: DEFAULT_AVATAR };
      const item = document.createElement("button");
      item.className = "sidebar-item" + (currentDmId === d.id ? " active" : "");
      item.innerHTML = "";
      const img = document.createElement("img");
      img.className = "avatar"; img.src = other.avatarUrl;
      item.appendChild(img);
      item.appendChild(document.createTextNode(other.displayName));
      item.onclick = () => openDm(d.id, other.displayName);
      list.appendChild(item);
    }
  });
}

$("close-dm-modal").onclick = () => $("dm-modal").classList.add("hidden");
$("new-dm-form").onsubmit = async (e) => {
  e.preventDefault();
  const targetName = $("dm-target-name").value.trim();
  const errEl = $("dm-modal-error");
  const key = usernameKey(targetName);
  try {
    const unameSnap = await getDoc(doc(db, "usernames", key));
    if (!unameSnap.exists()) { errEl.textContent = "No user with that name."; return; }
    const otherUid = unameSnap.data().uid;
    if (otherUid === me.uid) { errEl.textContent = "That's you!"; return; }
    const dmId = [me.uid, otherUid].sort().join("_");
    const dmRef = doc(db, "dms", dmId);
    const dmSnap = await getDoc(dmRef);
    if (!dmSnap.exists()) {
      await setDoc(dmRef, { participantIds: [me.uid, otherUid].sort(), updatedAt: serverTimestamp() });
    }
    $("dm-modal").classList.add("hidden");
    $("dm-target-name").value = "";
    openDm(dmId, targetName);
  } catch (err) {
    errEl.textContent = "Couldn't start conversation.";
  }
};

function openDm(dmId, otherName) {
  currentDmId = dmId;
  $("chat-title").textContent = otherName;
  subscribeMessages(collection(db, "dms", dmId, "messages"));
  enableComposer(async (text) => {
    await addDoc(collection(db, "dms", dmId, "messages"), {
      text, senderId: me.uid, senderName: me.displayName, senderAvatar: me.avatarUrl,
      createdAt: serverTimestamp(),
    });
  });
  closeNav();
}

/* ---------------- messages ---------------- */
function subscribeMessages(colRef) {
  if (unsubMessages) unsubMessages();
  const q = query(colRef, orderBy("createdAt"));
  unsubMessages = onSnapshot(q, (snap) => {
    const box = $("messages");
    box.innerHTML = "";
    if (snap.empty) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No messages yet — say hi!";
      box.appendChild(empty);
    }
    snap.forEach((d) => {
      const m = d.data();
      const row = document.createElement("div");
      row.className = "message-row";
      row.innerHTML = `
        <img class="avatar" src="${m.senderAvatar || DEFAULT_AVATAR}" alt="">
        <div class="message-body">
          <div class="message-meta">
            <span class="message-author">${escapeHtml(m.senderName || "Unknown")}</span>
            <span class="message-time">${fmtTime(m.createdAt)}</span>
          </div>
          <div class="message-text">${escapeHtml(m.text)}</div>
        </div>`;
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  });
}

function escapeHtml(str = "") {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function enableComposer(onSend) {
  const input = $("message-input");
  const form = $("message-form");
  input.disabled = false;
  form.querySelector("button").disabled = false;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await onSend(text);
  };
}

function clearChat() {
  if (unsubMessages) unsubMessages();
  $("messages").innerHTML = "";
  $("chat-title").textContent = "# select a channel";
  $("message-input").disabled = true;
  $("message-form").querySelector("button").disabled = true;
  $("message-form").onsubmit = (e) => e.preventDefault();
}

/* ---------------- theme editor ---------------- */
function applyTheme(mode, accent, persist = true) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.setProperty("--accent", accent);
  document.querySelectorAll(".theme-option").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("accent-picker").value = accent;
  localStorage.setItem("ilx-theme", JSON.stringify({ mode, accent }));
  if (persist && me) {
    updateDoc(doc(db, "users", me.uid), { theme: { mode, accent } }).catch(() => {});
  }
}
// instant paint from last-used theme before login resolves
try {
  const saved = JSON.parse(localStorage.getItem("ilx-theme") || "null");
  if (saved) applyTheme(saved.mode, saved.accent, false);
} catch { /* ignore */ }

$("theme-btn").onclick = () => $("theme-modal").classList.remove("hidden");
$("close-theme-modal").onclick = () => $("theme-modal").classList.add("hidden");
document.querySelectorAll(".theme-option").forEach((b) => {
  b.onclick = () => applyTheme(b.dataset.mode, $("accent-picker").value);
});
$("accent-picker").oninput = (e) => applyTheme(document.documentElement.dataset.theme, e.target.value);
