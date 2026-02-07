const ROLE = window.__ROLE__ || "user";

const toastWrap = document.getElementById("toastWrap");
function esc(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function toast(message, type = "info", subtitle = "") {
  if (!toastWrap) return alert(message);

  const palette = {
    info:    { dot:"#7f5cff", bg:"rgba(127,92,255,0.18)", bd:"rgba(127,92,255,0.35)" },
    success: { dot:"#18b07a", bg:"rgba(24,176,122,0.18)", bd:"rgba(24,176,122,0.35)" },
    warn:    { dot:"#f0b429", bg:"rgba(240,180,41,0.18)", bd:"rgba(240,180,41,0.35)" },
    error:   { dot:"#ff4e5b", bg:"rgba(255,78,91,0.18)", bd:"rgba(255,78,91,0.35)" },
  };
  const p = palette[type] || palette.info;

  const t = document.createElement("div");
  t.className = "toast fancy";
  t.style.borderColor = p.bd;
  t.style.background = `linear-gradient(135deg, ${p.bg}, rgba(15,15,26,0.92))`;

  t.innerHTML = `
    <div class="dot" style="background:${p.dot}"></div>
    <div>
      <div class="msg">${esc(message)}</div>
      ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}
    </div>
    <button class="close" aria-label="Close">✕</button>
  `;
  t.querySelector(".close").onclick = () => t.remove();
  toastWrap.appendChild(t);
  setTimeout(() => { if (t.isConnected) t.remove(); }, 4200);
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, setDoc, getDoc,
  getDocs, query, where, orderBy, limit, onSnapshot,
  serverTimestamp, writeBatch, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_wQdJitGIbyTgNKsTQyGe-oKf3R81xgs",
  authDomain: "area-55-6fb38.firebaseapp.com",
  projectId: "area-55-6fb38"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

const OPEN_HOUR = 6;
const CLOSE_HOUR = 22;

const FB_CHAT_URL = "https://www.facebook.com/profile.php?id=61585372936026";
const FB_CHAT_LABEL = "Chat on Facebook";

const pad2 = (n) => String(n).padStart(2, "0");
const SLOTS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => `${pad2(OPEN_HOUR + i)}:00`);

function isoDate(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function uiDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}
function cleanPhone(p) { return (p || "").replace(/[^\d+]/g, ""); }
function isValidPhone(p) { return /^(\+?63|0)9\d{9}$/.test(cleanPhone(p)); }
function isValidName(n) {
  const s = (n || "").trim();
  return s.length >= 2 && s.length <= 60;
}

function getPricePerHour(partySize) {
  const ps = Number(partySize || 1);
  if (ps >= 5 && ps <= 8) return 200;
  return 150;
}

function waitForAuthUser() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

async function ensureAnonUser() {
  if (ROLE !== "user") return;
  if (auth.currentUser) return auth.currentUser;

  try {
    await signInAnonymously(auth);
    const u = await waitForAuthUser();
    if (!u) throw new Error("Anonymous auth failed to initialize.");
    return u;
  } catch (e) {
    console.error(e);
    toast("Auth error", "error", "Enable Anonymous sign-in in Firebase Auth.");
    throw e;
  }
}

async function isApprovedAdmin(uid) {
  const snap = await getDoc(doc(db, "admins", uid));
  return snap.exists();
}

function fbOfflineCardHTML() {
  return `
    <div class="bubble them" style="max-width:100%;">
      <div style="display:flex; gap:10px; align-items:center;">
        <img src="logo.jpg" alt="Area 55" style="width:36px;height:36px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);object-fit:cover;">
        <div>
          <div style="font-weight:900;">Admin may be offline</div>
          <div class="meta" style="margin-top:4px;">
            <a href="${FB_CHAT_URL}" target="_blank" rel="noopener" style="text-decoration:underline;">
              Click here to chat: ${esc(FB_CHAT_LABEL)}
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function initUser() {
  const calDays  = document.getElementById("calendarDays");
  const calMonth = document.getElementById("calMonth");
  const calPrev  = document.getElementById("calPrev");
  const calNext  = document.getElementById("calNext");

  const nameEl      = document.getElementById("customerName");
  const phoneEl     = document.getElementById("customerPhone");
  const startTimeEl = document.getElementById("startTime");
  const durationEl  = document.getElementById("duration");
  const partySizeEl = document.getElementById("partySize");
  const slotBox     = document.getElementById("timeSlots");
  const confirmBtn  = document.getElementById("confirmBtn");

  const summaryDateEl     = document.getElementById("summaryDate");
  const summaryTimeEl     = document.getElementById("summaryTime");
  const summaryDurationEl = document.getElementById("summaryDuration");
  const summaryGuestsEl   = document.getElementById("summaryGuests");
  const summaryTotalEl    = document.getElementById("summaryTotal");

  const chatFab    = document.getElementById("chatFab");
  const chatWidget = document.getElementById("chatWidget");
  const chatClose  = document.getElementById("chatClose");
  const chatBody   = document.getElementById("chatBody");
  const chatInput  = document.getElementById("chatInput");
  const chatSend   = document.getElementById("chatSend");

  let selectedDateISO = null;
  let current = new Date();
  current = new Date(current.getFullYear(), current.getMonth(), 1);

  let unsubscribeSlots = null;
  let bookedRanges = [];
  let slotElsByTime = new Map();
  let unsubscribeUserChat = null;

  await ensureAnonUser();

  function populateStartTimes() {
    if (!startTimeEl) return;
    startTimeEl.innerHTML = "";
    for (const t of SLOTS) {
      const o = document.createElement("option");
      o.value = t; o.textContent = t;
      startTimeEl.appendChild(o);
    }
  }

  function maxDurationForStart(startTime) {
    const h = Number((startTime || "06:00").split(":")[0]);
    return Math.max(1, CLOSE_HOUR - h);
  }

  function populateDuration() {
    if (!durationEl || !startTimeEl) return;
    const maxDur = maxDurationForStart(startTimeEl.value);
    durationEl.innerHTML = "";
    for (let d = 1; d <= maxDur; d++) {
      const o = document.createElement("option");
      o.value = String(d);
      o.textContent = `${d} hour${d > 1 ? "s" : ""}`;
      durationEl.appendChild(o);
    }
  }

  function populateParty() {
    if (!partySizeEl) return;
    partySizeEl.innerHTML = "";
    for (let i = 1; i <= 8; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = String(i);
      partySizeEl.appendChild(o);
    }
  }

  function updateSummary() {
    const dur = Number(durationEl?.value || 1);
    const ps  = Number(partySizeEl?.value || 1);
    const pricePerHour = getPricePerHour(ps);

    if (summaryDateEl) summaryDateEl.textContent = selectedDateISO ? uiDate(selectedDateISO) : "—";
    if (summaryTimeEl) summaryTimeEl.textContent = startTimeEl?.value || "—";
    if (summaryDurationEl) summaryDurationEl.textContent = `${dur} hour${dur > 1 ? "s" : ""}`;
    if (summaryGuestsEl) summaryGuestsEl.textContent = partySizeEl?.value || "1";
    if (summaryTotalEl) summaryTotalEl.textContent = "₱" + (dur * pricePerHour);
  }

  startTimeEl?.addEventListener("change", () => { populateDuration(); updateSummary(); paintSelection(); });
  durationEl?.addEventListener("change", () => { updateSummary(); paintSelection(); });
  partySizeEl?.addEventListener("change", updateSummary);

  function computeBookedRanges(docs) {
    const ranges = [];
    for (const d of docs) {
      const startIdx = SLOTS.indexOf(d.startTime);
      const dur = Number(d.duration || 1);
      if (startIdx >= 0) ranges.push({ startIndex: startIdx, endIndexExclusive: startIdx + dur });
    }
    return ranges;
  }

  function selectionRange() {
    const start = SLOTS.indexOf(startTimeEl?.value);
    const dur = Number(durationEl?.value || 1);
    if (start < 0) return null;
    return { startIndex: start, endIndexExclusive: start + dur };
  }

  function overlapsBooked(sel) {
    if (!sel) return false;
    return bookedRanges.some(b =>
      Math.max(sel.startIndex, b.startIndex) < Math.min(sel.endIndexExclusive, b.endIndexExclusive)
    );
  }

  function paintSelection() {
    slotElsByTime.forEach(el => el.classList.remove("selected", "conflict"));
    const sel = selectionRange();
    if (!sel) return;

    for (let i = sel.startIndex; i < sel.endIndexExclusive; i++) {
      const t = SLOTS[i];
      const el = slotElsByTime.get(t);
      if (el) el.classList.add("selected");
    }

    if (overlapsBooked(sel)) {
      for (let i = sel.startIndex; i < sel.endIndexExclusive; i++) {
        const t = SLOTS[i];
        const el = slotElsByTime.get(t);
        if (el) el.classList.add("conflict");
      }
    }
  }

  function renderSlotsUI() {
    if (!slotBox) return;
    slotBox.innerHTML = "";
    slotElsByTime = new Map();

    const isBookedIndex = (idx) => bookedRanges.some(b => idx >= b.startIndex && idx < b.endIndexExclusive);

    SLOTS.forEach((t, idx) => {
      const div = document.createElement("div");
      div.className = "time-slot";
      div.dataset.time = t;

      if (isBookedIndex(idx)) {
        div.classList.add("booked");
        div.textContent = t;
        div.onclick = () => toast("This hour is already booked.", "warn");
      } else {
        div.classList.add("available");
        div.textContent = t;
        div.onclick = () => {
          if (!startTimeEl) return;
          startTimeEl.value = t;
          populateDuration();
          updateSummary();
          paintSelection();
        };
      }

      slotElsByTime.set(t, div);
      slotBox.appendChild(div);
    });

    paintSelection();
  }

  function startSlotsLive(dateISO) {
    if (unsubscribeSlots) unsubscribeSlots();

    const qy = query(collection(db, "bookings_public"), where("date", "==", dateISO));
    unsubscribeSlots = onSnapshot(qy, (snap) => {
      const docs = snap.docs.map(d => d.data());
      bookedRanges = computeBookedRanges(docs);
      renderSlotsUI();
    }, (err) => {
      console.error(err);
      toast("Slots unavailable", "error", err?.message || "Check Firestore rules.");
    });
  }

  function clearActive() {
    calDays?.querySelectorAll("span").forEach(s => s.classList.remove("active", "today"));
  }

  function renderCalendar() {
    if (!calDays || !calMonth) return;

    calDays.innerHTML = "";
    const y = current.getFullYear();
    const m = current.getMonth();
    calMonth.textContent = current.toLocaleString("default", { month: "long" }) + " " + y;

    const firstDow = new Date(y, m, 1).getDay();
    const lastDay  = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < firstDow; i++) calDays.appendChild(document.createElement("span"));

    const today = new Date();
    const isThisMonth = (today.getFullYear() === y && today.getMonth() === m);

    for (let d = 1; d <= lastDay; d++) {
      const s = document.createElement("span");
      s.textContent = d;

      if (isThisMonth && d === today.getDate()) s.classList.add("today");

      s.onclick = () => {
        clearActive();
        s.classList.add("active");
        selectedDateISO = isoDate(y, m + 1, d);
        updateSummary();
        startSlotsLive(selectedDateISO);
      };
      calDays.appendChild(s);
    }

    if (isThisMonth) {
      const el = [...calDays.querySelectorAll("span")].find(x => Number(x.textContent) === today.getDate());
      el?.click();
    } else {
      const el = [...calDays.querySelectorAll("span")].find(x => x.textContent === "1");
      el?.click();
    }
  }

  calPrev?.addEventListener("click", () => { current.setMonth(current.getMonth() - 1); renderCalendar(); });
  calNext?.addEventListener("click", () => { current.setMonth(current.getMonth() + 1); renderCalendar(); });

  async function createBooking() {
    await ensureAnonUser();

    if (!selectedDateISO) return toast("Select a date first.", "warn");

    const name = (nameEl?.value || "").trim();
    const phone = cleanPhone(phoneEl?.value || "");
    const startTime = startTimeEl?.value || "06:00";
    const duration = Number(durationEl?.value || 1);
    const partySize = Number(partySizeEl?.value || 1);

    if (!isValidName(name)) return toast("Enter your full name.", "error");
    if (!isValidPhone(phone)) return toast("Enter valid PH number.", "error", "Example: 09xxxxxxxxx");

    const sel = selectionRange();
    if (overlapsBooked(sel)) return toast("Selected range conflicts.", "warn", "Choose a different time.");

    try {
      const uid = auth.currentUser.uid;
      const batch = writeBatch(db);
      const pubRef  = doc(collection(db, "bookings_public"));
      const privRef = doc(collection(db, "bookings_private"));

      batch.set(pubRef, {
        date: selectedDateISO,
        startTime,
        duration,
        createdAt: serverTimestamp()
      });

      batch.set(privRef, {
        date: selectedDateISO,
        startTime,
        duration,
        partySize,
        name,
        phone,
        ownerUid: uid,
        publicId: pubRef.id,
        createdAt: serverTimestamp()
      });

      const convoId = `general_${uid}`;
      batch.set(doc(db, "conversations", convoId), {
        ownerUid: uid,
        name,
        phone,
        type: "general",
        updatedAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp()
      }, { merge: true });

      await batch.commit();
      toast("Booking confirmed!", "success", `${uiDate(selectedDateISO)} • ${startTime} • ${duration}h`);
    } catch (e) {
      console.error(e);
      toast("Booking failed.", "error", e?.message || "Missing Informations!.");
    }
  }

  confirmBtn?.addEventListener("click", createBooking);

  function showChatEmpty(text) {
    if (!chatBody) return;
    chatBody.innerHTML = `<div class="chat-empty">${esc(text)}</div>${fbOfflineCardHTML()}`;
  }

  function renderBubble(msg, meUid) {
    const isMe = msg.sender === meUid;
    const div = document.createElement("div");
    div.className = `bubble ${isMe ? "me" : "them"}`;
    const timeStr = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleString() : "";
    div.innerHTML = `
      <div>${esc(msg.text || "")}</div>
      <div class="meta">${isMe ? "You" : "Admin"} • ${esc(timeStr)}</div>
    `;
    return div;
  }

  async function ensureConversation() {
    await ensureAnonUser();
    const uid = auth.currentUser.uid;
    const convoId = `general_${uid}`;
    const ref = doc(db, "conversations", convoId);

    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerUid: uid,
        name: (nameEl?.value || "Customer").trim() || "Customer",
        phone: cleanPhone(phoneEl?.value || ""),
        type: "general",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessageAt: serverTimestamp()
      });
    }
    return convoId;
  }

  function startUserChatListener(convoId) {
    if (unsubscribeUserChat) unsubscribeUserChat();

    const meUid = auth.currentUser?.uid;
    const qy = query(
      collection(db, "conversations", convoId, "messages"),
      orderBy("createdAt", "asc"),
      limit(200)
    );

    unsubscribeUserChat = onSnapshot(qy, (snap) => {
      if (!chatBody) return;
      chatBody.innerHTML = "";

      if (snap.empty) {
        showChatEmpty("Say hi 👋 Ask anything about bookings.");
        return;
      }

      snap.docs.forEach(d => chatBody.appendChild(renderBubble(d.data(), meUid)));
      chatBody.insertAdjacentHTML("beforeend", fbOfflineCardHTML());
      chatBody.scrollTop = chatBody.scrollHeight;
    }, (err) => {
      console.error(err);
      showChatEmpty("Chat unavailable (rules/auth).");
      toast("Chat error", "error", err?.message || "");
    });
  }

  chatFab?.addEventListener("click", async () => {
    chatWidget?.classList.add("open");
    chatWidget?.setAttribute("aria-hidden", "false");

    try {
      const convoId = await ensureConversation();
      startUserChatListener(convoId);
    } catch (e) {
      console.error(e);
      if (chatBody) {
        chatBody.innerHTML = `
          <div class="chat-empty">
            Admin may be offline.
            <br><br>
            <a href="${FB_CHAT_URL}" target="_blank" style="text-decoration:underline;">
              Click here to chat on Facebook
            </a>
          </div>
        `;
      }
    }
  });

  chatClose?.addEventListener("click", () => {
    chatWidget?.classList.remove("open");
    chatWidget?.setAttribute("aria-hidden", "true");
  });

  function setSendEnabled() {
    if (!chatSend || !chatInput) return;
    chatSend.disabled = !(chatInput.value || "").trim();
    chatSend.style.opacity = chatSend.disabled ? "0.55" : "1";
    chatSend.style.cursor = chatSend.disabled ? "not-allowed" : "pointer";
  }

  chatInput?.addEventListener("input", setSendEnabled);

  async function sendUserChat() {
    if (!chatInput) return;

    const text = (chatInput.value || "").trim();
    if (!text) return;

    chatInput.value = "";
    setSendEnabled();

    try {
      const convoId = await ensureConversation();

      await addDoc(collection(db, "conversations", convoId, "messages"), {
        sender: auth.currentUser.uid,
        text,
        createdAt: serverTimestamp()
      });

      await setDoc(doc(db, "conversations", convoId), {
        updatedAt: serverTimestamp(),
        lastMessageAt: serverTimestamp()
      }, { merge: true });

    } catch (e) {
      console.error(e);

      if (chatBody) {
        chatBody.insertAdjacentHTML(
          "beforeend",
          `<div class="bubble them">
             <div>${esc(text)}</div>
             <div class="meta">Not sent • Click Facebook below</div>
           </div>${fbOfflineCardHTML()}`
        );
        chatBody.scrollTop = chatBody.scrollHeight;
      }

      toast("Admin offline", "warn", "Click the Facebook link in chat.");
    }
  }

  chatSend?.addEventListener("click", sendUserChat);

  chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendUserChat();
    }
  });

  setSendEnabled();

  populateStartTimes();
  populateDuration();
  populateParty();
  updateSummary();
  renderCalendar();
}

async function initAdmin() {
  const adminLockedScreen = document.getElementById("adminLockedScreen");
  const adminApp          = document.getElementById("adminApp");
  const adminLoginBox     = document.getElementById("adminLoginBox");
  const adminSummary      = document.getElementById("adminSummary");

  const adminEmail    = document.getElementById("adminEmail");
  const adminPassword = document.getElementById("adminPassword");
  const adminLoginBtn = document.getElementById("adminLoginBtn");
  const adminLogoutBtn= document.getElementById("adminLogoutBtn");

  const calDays  = document.getElementById("calendarDays");
  const calMonth = document.getElementById("calMonth");
  const calPrev  = document.getElementById("calPrev");
  const calNext  = document.getElementById("calNext");

  const adminBookingList = document.getElementById("adminBookingList");
  const admDate  = document.getElementById("admDate");
  const admCount = document.getElementById("admCount");
  const admHours = document.getElementById("admHours");
  const admSales = document.getElementById("admSales");

  const threadList      = document.getElementById("threadList");
  const threadTitle     = document.getElementById("threadTitle");
  const adminChatBody   = document.getElementById("adminChatBody");
  const adminChatInput  = document.getElementById("adminChatInput");
  const adminChatSend   = document.getElementById("adminChatSend");

  const adminUploadBtn    = document.getElementById("adminUploadBtn");
  const adminPhotoCaption = document.getElementById("adminPhotoCaption");
  const adminGalleryGrid  = document.getElementById("adminGalleryGrid");

  let selectedDateISO = null;
  let current = new Date();
  current = new Date(current.getFullYear(), current.getMonth(), 1);

  let unsubThreads = null;
  let unsubThread  = null;
  let selectedThreadId = null;

  function lockUI() {
    if (adminLockedScreen) adminLockedScreen.style.display = "flex";
    if (adminApp) adminApp.style.display = "none";
    if (adminLoginBox) adminLoginBox.style.display = "block";
    if (adminSummary) adminSummary.style.display = "none";
  }

  function unlockUI() {
    if (adminLockedScreen) adminLockedScreen.style.display = "none";
    if (adminApp) adminApp.style.display = "block";
    if (adminLoginBox) adminLoginBox.style.display = "none";
    if (adminSummary) adminSummary.style.display = "block";
  }

  adminLoginBtn?.addEventListener("click", async () => {
    const email = (adminEmail?.value || "").trim();
    const pass  = (adminPassword?.value || "");
    if (!email || !pass) return toast("Enter admin email/password.", "warn");

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      toast("Logged in", "success", email);
    } catch (e) {
      console.error(e);
      toast("Login failed", "error", e?.message || "");
    }
  });

  adminLogoutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    toast("Logged out", "info");
  });

  function clearActive() {
    calDays?.querySelectorAll("span").forEach(s => s.classList.remove("active", "today"));
  }

  function renderCalendar() {
    if (!calDays || !calMonth) return;

    calDays.innerHTML = "";
    const y = current.getFullYear();
    const m = current.getMonth();
    calMonth.textContent = current.toLocaleString("default", { month: "long" }) + " " + y;

    const firstDow = new Date(y, m, 1).getDay();
    const lastDay  = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < firstDow; i++) calDays.appendChild(document.createElement("span"));

    const today = new Date();
    const isThisMonth = (today.getFullYear() === y && today.getMonth() === m);

    for (let d = 1; d <= lastDay; d++) {
      const s = document.createElement("span");
      s.textContent = d;

      if (isThisMonth && d === today.getDate()) s.classList.add("today");

      s.onclick = async () => {
        clearActive();
        s.classList.add("active");
        selectedDateISO = isoDate(y, m + 1, d);
        if (admDate) admDate.textContent = uiDate(selectedDateISO);
        await loadBookingsForDate(selectedDateISO);
      };

      calDays.appendChild(s);
    }

    if (isThisMonth) {
      const el = [...calDays.querySelectorAll("span")].find(x => Number(x.textContent) === today.getDate());
      el?.click();
    }
  }

  calPrev?.addEventListener("click", () => { current.setMonth(current.getMonth() - 1); renderCalendar(); });
  calNext?.addEventListener("click", () => { current.setMonth(current.getMonth() + 1); renderCalendar(); });

  async function loadBookingsForDate(dateISO) {
    if (!adminBookingList) return;

    const qy = query(collection(db, "bookings_private"), where("date", "==", dateISO));
    const snap = await getDocs(qy);

    if (snap.empty) {
      adminBookingList.innerHTML = `<div class="admin-empty">No bookings for this date.</div>`;
      if (admCount) admCount.textContent = "0";
      if (admHours) admHours.textContent = "0";
      if (admSales) admSales.textContent = "₱0";
      return;
    }

    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => SLOTS.indexOf(a.startTime) - SLOTS.indexOf(b.startTime));

    let totalHours = 0;
    let totalSales = 0;

    items.forEach(b => {
      const dur = Number(b.duration || 1);
      const ps = Number(b.partySize || 1);
      totalHours += dur;
      totalSales += dur * getPricePerHour(ps);
    });

    if (admCount) admCount.textContent = String(items.length);
    if (admHours) admHours.textContent = String(totalHours);
    if (admSales) admSales.textContent = "₱" + totalSales;

    adminBookingList.innerHTML = "";
    items.forEach(b => {
      const card = document.createElement("div");
      card.className = "admin-card";
      card.innerHTML = `
        <div class="row">
          <strong>${esc(b.startTime || "")}</strong>
          <span>${esc(String(b.duration || 1))}h • ${esc(String(b.partySize || 1))} pax</span>
        </div>
        <div class="row">
          <span>${esc(b.name || "")}</span>
          <span>${esc(b.phone || "")}</span>
        </div>
        <div class="admin-actions">
          <button class="btn-danger" data-private="${esc(b.id)}" data-public="${esc(b.publicId || "")}">Remove</button>
        </div>
      `;
      adminBookingList.appendChild(card);
    });

    adminBookingList.querySelectorAll(".btn-danger").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this booking?")) return;
        try {
          const privId = btn.getAttribute("data-private");
          const pubId  = btn.getAttribute("data-public");

          await deleteDoc(doc(db, "bookings_private", privId));
          if (pubId) await deleteDoc(doc(db, "bookings_public", pubId));

          toast("Booking removed", "success", "Slot is free again.");
          await loadBookingsForDate(dateISO);
        } catch (e) {
          console.error(e);
          toast("Remove failed", "error", e?.message || "");
        }
      });
    });
  }

  function renderThread(id, convo) {
    const div = document.createElement("div");
    div.className = "thread" + (id === selectedThreadId ? " active" : "");
    div.innerHTML = `
      <div class="t1">${esc(convo.name || "Customer")} • ${esc(convo.phone || "")}</div>
      <div class="t2">${convo.type ? esc(convo.type) : "general"}</div>
    `;
    div.onclick = () => selectThread(id, convo);
    return div;
  }

  function renderBubble(msg, adminUid) {
    const isMe = msg.sender === adminUid;
    const div = document.createElement("div");
    div.className = `bubble ${isMe ? "me" : "them"}`;
    const timeStr = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleString() : "";
    div.innerHTML = `
      <div>${esc(msg.text || "")}</div>
      <div class="meta">${isMe ? "Admin" : "Customer"} • ${esc(timeStr)}</div>
    `;
    return div;
  }

  function selectThread(id, convo) {
    selectedThreadId = id;
    if (threadTitle) threadTitle.textContent = `${convo.name || "Customer"} • ${convo.phone || ""}`;

    threadList?.querySelectorAll(".thread").forEach(x => x.classList.remove("active"));

    unsubThread?.();
    const qy = query(
      collection(db, "conversations", id, "messages"),
      orderBy("createdAt", "asc"),
      limit(300)
    );
    const adminUid = auth.currentUser.uid;

    unsubThread = onSnapshot(qy, (snap) => {
      if (!adminChatBody) return;
      adminChatBody.innerHTML = "";

      if (snap.empty) {
        adminChatBody.innerHTML = `<div class="admin-empty">No messages yet.</div>`;
        return;
      }

      snap.docs.forEach(d => adminChatBody.appendChild(renderBubble(d.data(), adminUid)));
      adminChatBody.scrollTop = adminChatBody.scrollHeight;
    }, (err) => {
      console.error(err);
      toast("Chat load failed", "error", err?.message || "");
    });
  }

  function loadThreads() {
    if (!threadList) return;
    unsubThreads?.();

    const qy = query(collection(db, "conversations"), orderBy("lastMessageAt", "desc"), limit(80));
    unsubThreads = onSnapshot(qy, (snap) => {
      threadList.innerHTML = "";
      if (snap.empty) {
        threadList.innerHTML = `<div class="admin-empty">No chats yet.</div>`;
        return;
      }
      snap.docs.forEach(d => threadList.appendChild(renderThread(d.id, d.data())));
    }, (err) => {
      console.error(err);
      toast("Inbox failed", "error", err?.message || "");
    });
  }

  adminChatSend?.addEventListener("click", async () => {
    const text = (adminChatInput?.value || "").trim();
    if (!text) return;
    if (!selectedThreadId) return toast("Select a thread first.", "warn");

    try {
      await addDoc(collection(db, "conversations", selectedThreadId, "messages"), {
        sender: auth.currentUser.uid,
        text,
        createdAt: serverTimestamp()
      });

      await setDoc(doc(db, "conversations", selectedThreadId), {
        updatedAt: serverTimestamp(),
        lastMessageAt: serverTimestamp()
      }, { merge: true });

      if (adminChatInput) adminChatInput.value = "";
    } catch (e) {
      console.error(e);
      toast("Send failed", "error", e?.message || "");
    }
  });

  async function loadGallery() {
    if (!adminGalleryGrid) return;
    const qy = query(collection(db, "gallery_images"), orderBy("createdAt", "desc"), limit(40));
    const snap = await getDocs(qy);

    adminGalleryGrid.innerHTML = "";
    if (snap.empty) {
      adminGalleryGrid.innerHTML = `<div class="admin-empty">No images yet.</div>`;
      return;
    }

    snap.docs.forEach(d => {
      const g = d.data();
      const item = document.createElement("div");
      item.className = "admin-thumb";
      item.innerHTML = `<img src="${esc(g.url)}" alt="photo"><div class="cap">${esc(g.caption || "")}</div>`;
      adminGalleryGrid.appendChild(item);
    });
  }

  adminUploadBtn?.addEventListener("click", async () => {
    if (!window.cloudinary) {
      return toast("Cloudinary widget missing", "error", "Include widget script in admin.html.");
    }

    const cloudName = "YOUR_CLOUD_NAME";
    const uploadPreset = "YOUR_UPLOAD_PRESET";

    if (cloudName === "YOUR_CLOUD_NAME" || uploadPreset === "YOUR_UPLOAD_PRESET") {
      return toast("Set Cloudinary keys", "warn", "Edit cloudName/uploadPreset in script.js.");
    }

    const caption = (adminPhotoCaption?.value || "").trim();

    const widget = window.cloudinary.createUploadWidget({
      cloudName,
      uploadPreset,
      sources: ["local", "camera", "url"],
      multiple: false
    }, async (error, result) => {
      if (error) {
        console.error(error);
        toast("Upload error", "error", error.message || "");
        return;
      }
      if (result && result.event === "success") {
        try {
          await addDoc(collection(db, "gallery_images"), {
            url: result.info.secure_url,
            caption,
            createdAt: serverTimestamp()
          });
          toast("Uploaded!", "success", "Photo added to gallery.");
          if (adminPhotoCaption) adminPhotoCaption.value = "";
          loadGallery();
        } catch (e) {
          console.error(e);
          toast("Save failed", "error", e?.message || "");
        }
      }
    });

    widget.open();
  });

  lockUI();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      lockUI();
      return;
    }

    const ok = await isApprovedAdmin(user.uid).catch(() => false);
    if (!ok) {
      toast("Not approved admin", "error", "Add your UID to Firestore /admins then login again.");
      await signOut(auth);
      lockUI();
      return;
    }

    unlockUI();
    renderCalendar();
    loadThreads();
    loadGallery();
  });
}

function initCoverflow() {
  const track =
    document.getElementById("cfTrack") ||
    document.querySelector(".cf-track");

  const prevBtn =
    document.getElementById("cfPrev") ||
    document.querySelector(".cf-arrow.prev") ||
    document.querySelector("#cfPrev");

  const nextBtn =
    document.getElementById("cfNext") ||
    document.querySelector(".cf-arrow.next") ||
    document.querySelector("#cfNext");

  const dotsWrap =
    document.getElementById("cfDots") ||
    document.querySelector(".cf-dots");

  if (!track || !prevBtn || !nextBtn || !dotsWrap) return;

  const cards = [...track.querySelectorAll(".cf-card")];
  if (!cards.length) return;

  let idx = 0;

  dotsWrap.innerHTML = "";
  cards.forEach((_, i) => {
    const d = document.createElement("span");
    d.addEventListener("click", () => { idx = i; render(); });
    dotsWrap.appendChild(d);
  });

  function render() {
    cards.forEach((card, i) => {
      const offset = i - idx;
      const abs = Math.abs(offset);

      const x = offset * 240;
      const z = abs * -170;
      const rot = offset * -18;

      const opacity =
        abs === 0 ? 1 :
        abs === 1 ? 0.45 :
        abs === 2 ? 0.25 : 0.12;

      const blur =
        abs === 0 ? 0 :
        abs === 1 ? 0.8 :
        abs === 2 ? 1.4 : 2.2;

      const scale =
        abs === 0 ? 1 :
        abs === 1 ? 0.93 :
        abs === 2 ? 0.86 : 0.78;

      card.style.transform =
        `translate(-50%, -50%) translateX(${x}px) translateZ(${z}px) rotateY(${rot}deg) scale(${scale})`;

      card.style.opacity = String(opacity);
      card.style.filter = `blur(${blur}px)`;
      card.style.pointerEvents = abs > 2 ? "none" : "auto";
      card.style.zIndex = String(100 - abs);

      card.classList.toggle("is-center", abs === 0);
    });

    [...dotsWrap.children].forEach((d, i) => d.classList.toggle("active", i === idx));
  }

  function goPrev() { idx = (idx - 1 + cards.length) % cards.length; render(); }
  function goNext() { idx = (idx + 1) % cards.length; render(); }

  prevBtn.addEventListener("click", goPrev);
  nextBtn.addEventListener("click", goNext);

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") goPrev();
    if (e.key === "ArrowRight") goNext();
  });

  let dragging = false;
  let startX = 0;

  const dragTarget = track;

  dragTarget.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    e.preventDefault();
  });
  window.addEventListener("mouseup", () => dragging = false);
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const diff = e.clientX - startX;
    if (diff > 80) { goPrev(); startX = e.clientX; }
    if (diff < -80) { goNext(); startX = e.clientX; }
  });

  dragTarget.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
  }, { passive: true });

  dragTarget.addEventListener("touchmove", (e) => {
    const diff = e.touches[0].clientX - startX;
    if (diff > 80) { goPrev(); startX = e.touches[0].clientX; }
    if (diff < -80) { goNext(); startX = e.touches[0].clientX; }
  }, { passive: true });

  const lb      = document.getElementById("lightbox");
  const lbImg   = document.getElementById("lbImg");
  const lbCap   = document.getElementById("lbCap");
  const lbClose = document.getElementById("lbClose");
  const lbPrev  = document.getElementById("lbPrev");
  const lbNext  = document.getElementById("lbNext");

  function openLB(i) {
    if (!lb || !lbImg) return;
    idx = i;
    const img = cards[idx].querySelector("img");
    const cap = cards[idx].querySelector(".cf-cap");
    lbImg.src = img?.src || "";
    if (lbCap) lbCap.textContent = cap?.textContent || "";
    lb.classList.add("open");
    lb.setAttribute("aria-hidden", "false");
  }
  function closeLB() {
    if (!lb) return;
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
  }

  cards.forEach((c, i) => c.addEventListener("click", () => openLB(i)));
  lbClose?.addEventListener("click", closeLB);
  lbPrev?.addEventListener("click", () => openLB((idx - 1 + cards.length) % cards.length));
  lbNext?.addEventListener("click", () => openLB((idx + 1) % cards.length));
  lb?.addEventListener("click", (e) => { if (e.target === lb) closeLB(); });

  render();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (ROLE === "admin") await initAdmin();
    else await initUser();
  } catch (e) {
    console.error(e);
  }

  try { initCoverflow(); } catch (e) { console.error(e); }
});

const reveals = document.querySelectorAll('.reveal');

const revealObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

reveals.forEach(el => revealObserver.observe(el));

function smoothJumpToHash(hash){
  const el = document.querySelector(hash);
  if(!el) return;

  el.scrollIntoView({ behavior: "smooth", block: "start" });

  el.classList.remove("section-focus");
  void el.offsetWidth;
  el.classList.add("section-focus");

  setTimeout(() => el.classList.remove("section-focus"), 900);
}

document.querySelectorAll('a.nav-link[href^="#"]').forEach(a => {
  a.addEventListener("click", (e) => {
    const href = a.getAttribute("href");
    if(!href || href === "#") return;
    e.preventDefault();
    history.pushState(null, "", href);
    smoothJumpToHash(href);
  });
});

function markActiveNav(){
  const links = [...document.querySelectorAll('a.nav-link[href^="#"]')];
  const sections = links
    .map(l => document.querySelector(l.getAttribute("href")))
    .filter(Boolean);

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      const id = "#" + entry.target.id;
      links.forEach(l => l.classList.toggle("active", l.getAttribute("href") === id));
    });
  }, { rootMargin: "-30% 0px -60% 0px", threshold: 0.01 });

  sections.forEach(s => obs.observe(s));
}

markActiveNav();

window.addEventListener("load", () => {
  if(location.hash) smoothJumpToHash(location.hash);
});
