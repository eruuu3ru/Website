// =======================
// TOAST
// =======================
const toastWrap = document.getElementById("toastWrap");
function escapeHtml(s){return (s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function toast(message, type="info", subtitle=""){
  if(!toastWrap) return alert(message);
  const palette = {
    info:   { dot:"#7f5cff", bg:"rgba(127,92,255,0.18)", bd:"rgba(127,92,255,0.35)" },
    success:{ dot:"#18b07a", bg:"rgba(24,176,122,0.18)", bd:"rgba(24,176,122,0.35)" },
    warn:   { dot:"#f0b429", bg:"rgba(240,180,41,0.18)", bd:"rgba(240,180,41,0.35)" },
    error:  { dot:"#ff4e5b", bg:"rgba(255,78,91,0.18)", bd:"rgba(255,78,91,0.35)" },
  };
  const p = palette[type] || palette.info;

  const t=document.createElement("div");
  t.className="toast";
  t.style.borderColor = p.bd;
  t.style.background = `linear-gradient(135deg, ${p.bg}, rgba(15,15,26,0.92))`;

  t.innerHTML=`
    <div class="dot" style="background:${p.dot}"></div>
    <div>
      <div class="msg">${escapeHtml(message)}</div>
      ${subtitle?`<div class="sub">${escapeHtml(subtitle)}</div>`:""}
    </div>
    <button class="close" aria-label="Close">✕</button>
  `;
  t.querySelector(".close").onclick=()=>t.remove();
  toastWrap.appendChild(t);
  setTimeout(()=>{ if(t.isConnected) t.remove(); }, 4200);
}

// =======================
// FIREBASE IMPORTS
// =======================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection, getDocs, query, where, orderBy, limit,
  doc, getDoc, serverTimestamp,
  onSnapshot, writeBatch, addDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// =======================
// FIREBASE CONFIG
// =======================
const firebaseConfig = {
  apiKey: "AIzaSyD_wQdJitGIbyTgNKsTQyGe-oKf3R81xgs",
  authDomain: "area-55-6fb38.firebaseapp.com",
  projectId: "area-55-6fb38"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// =======================
// DOM
// =======================
const adminLockedScreen = document.getElementById("adminLockedScreen");
const adminApp = document.getElementById("adminApp");

const adminEmail = document.getElementById("adminEmail");
const adminPassword = document.getElementById("adminPassword");
const adminLoginBtn = document.getElementById("adminLoginBtn");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");

const calDays = document.getElementById("calendarDays");
const calMonth = document.getElementById("calMonth");
const btnPrev = document.getElementById("calPrev");
const btnNext = document.getElementById("calNext");

const adminBookingList = document.getElementById("adminBookingList");
const admDate = document.getElementById("admDate");
const admCount = document.getElementById("admCount");
const admHours = document.getElementById("admHours");
const admSales = document.getElementById("admSales");

const adminSlots = document.getElementById("adminSlots");

// chat DOM
const threadList = document.getElementById("threadList");
const threadCount = document.getElementById("threadCount");
const adminChatBody = document.getElementById("adminChatBody");
const adminChatInput = document.getElementById("adminChatInput");
const adminChatSend  = document.getElementById("adminChatSend");
const activeThreadLabel = document.getElementById("activeThreadLabel");
const closeThreadBtn = document.getElementById("closeThreadBtn");
const threadDeleteBtn = document.getElementById("threadDeleteBtn");

// =======================
// HELPERS
// =======================
const OPEN_HOUR = 6;
const CLOSE_HOUR = 22;
const PRICE_PER_HOUR = 150;

const pad2 = (n)=>String(n).padStart(2,"0");
const SLOTS = Array.from({length: (CLOSE_HOUR-OPEN_HOUR)}, (_,i)=>`${pad2(OPEN_HOUR+i)}:00`);

function isoDate(y,m,d){ return `${y}-${pad2(m)}-${pad2(d)}`; }
function uiDate(iso){
  if(!iso) return "—";
  const [y,m,d]=iso.split("-");
  return `${m}/${d}/${y}`;
}

function lockUI(){
  if(adminLockedScreen) adminLockedScreen.style.display = "flex";
  if(adminApp) adminApp.style.display = "none";
}
function unlockUI(){
  if(adminLockedScreen) adminLockedScreen.style.display = "none";
  if(adminApp) adminApp.style.display = "block";
}

// =======================
// ADMIN AUTH (autofill-safe + Enter)
// =======================
async function doAdminLogin(){
  // ✅ Autofill fix: wait a tick so browser commits the selected suggestion
  await new Promise(r => setTimeout(r, 0));

  const email = (adminEmail?.value || "").trim();
  const pass  = (adminPassword?.value || "");

  if(!email || !pass){
    toast("Enter email and password", "warn");
    return;
  }

  if(adminLoginBtn){
    adminLoginBtn.disabled = true;
    adminLoginBtn.style.opacity = "0.8";
  }

  try{
    await signInWithEmailAndPassword(auth, email, pass);
    toast("Logged in", "success", email);
  }catch(e){
    console.error(e);
    toast("Login failed", "error", e?.message || "");
  }finally{
    if(adminLoginBtn){
      adminLoginBtn.disabled = false;
      adminLoginBtn.style.opacity = "1";
    }
  }
}

adminLoginBtn?.addEventListener("click", (e)=>{
  e.preventDefault();
  doAdminLogin();
});

function handleAdminEnter(e){
  if(e.key !== "Enter") return;
  e.preventDefault();
  const emailOk = (adminEmail?.value || "").trim().length > 0;
  const passOk  = (adminPassword?.value || "").length > 0;
  if(emailOk && passOk) doAdminLogin();
}
adminEmail?.addEventListener("keydown", handleAdminEnter);
adminPassword?.addEventListener("keydown", handleAdminEnter);

// (helps some browsers commit autofill)
adminEmail?.addEventListener("change", ()=>{});
adminPassword?.addEventListener("change", ()=>{});

adminLogoutBtn?.addEventListener("click", async ()=>{
  try{
    await signOut(auth);
    toast("Logged out", "info");
  }catch(e){
    console.error(e);
  }
});

// =======================
// SECURITY CHECK (admins/{uid})
// =======================
async function isAdmin(uid){
  const ref = doc(db, "admins", uid);
  const snap = await getDoc(ref);
  return snap.exists();
}

// =======================
// CALENDAR
// =======================
let selectedDateISO = null;
let current = new Date();
current = new Date(current.getFullYear(), current.getMonth(), 1);

function clearActiveDay(){
  calDays?.querySelectorAll("span").forEach(x=>x.classList.remove("active","today"));
}

function renderCalendar(){
  if(!calDays || !calMonth) return;

  calDays.innerHTML="";
  const y=current.getFullYear();
  const m=current.getMonth();
  calMonth.textContent = current.toLocaleString("default",{month:"long"})+" "+y;

  const firstDow=new Date(y,m,1).getDay();
  const lastDay=new Date(y,m+1,0).getDate();

  for(let i=0;i<firstDow;i++) calDays.appendChild(document.createElement("span"));

  const today = new Date();
  const isThisMonth = today.getFullYear()===y && today.getMonth()===m;

  for(let d=1; d<=lastDay; d++){
    const s=document.createElement("span");
    s.textContent=d;

    if(isThisMonth && d===today.getDate()) s.classList.add("today");

    s.onclick = async ()=>{
      clearActiveDay();
      s.classList.add("active");

      selectedDateISO = isoDate(y, m+1, d);
      if(admDate) admDate.textContent = uiDate(selectedDateISO);
      await loadAdminBookings(selectedDateISO);
    };

    calDays.appendChild(s);
  }

  // auto-select today
  if(isThisMonth){
    const dayEls=[...calDays.querySelectorAll("span")].filter(x=>x.textContent.trim()!=="");
    const todayEl = dayEls.find(x=>Number(x.textContent)===today.getDate());
    if(todayEl) todayEl.click();
  }
}

btnPrev?.addEventListener("click",()=>{ current.setMonth(current.getMonth()-1); renderCalendar(); });
btnNext?.addEventListener("click",()=>{ current.setMonth(current.getMonth()+1); renderCalendar(); });

// =======================
// BOOKINGS
// =======================
async function removeBookingAdmin({ privateId, publicId }){
  const batch = writeBatch(db);
  batch.delete(doc(db,"bookings_private", privateId));
  if(publicId) batch.delete(doc(db,"bookings_public", publicId));
  await batch.commit();
}

function buildBookedMap(items){
  const booked = new Map();
  for(const b of items){
    const startIdx = SLOTS.indexOf(b.startTime);
    const dur = Math.max(1, Number(b.duration||1));
    if(startIdx < 0) continue;
    for(let i=0;i<dur;i++){
      const t = SLOTS[startIdx+i];
      if(t) booked.set(t, b);
    }
  }
  return booked;
}

function renderAdminSlots(items){
  if(!adminSlots) return;

  const bookedMap = buildBookedMap(items);
  adminSlots.innerHTML = "";

  SLOTS.forEach(t=>{
    const isBooked = bookedMap.has(t);
    const el = document.createElement("div");
    el.className = `time-slot ${isBooked ? "booked" : "available"}`;
    el.textContent = t;

    el.onclick = ()=>{
      adminSlots.querySelectorAll(".time-slot").forEach(x=>x.classList.remove("selected"));
      el.classList.add("selected");

      if(isBooked){
        const b = bookedMap.get(t);
        const card = adminBookingList?.querySelector?.(`[data-booking-card="${b.docId}"]`);
        if(card) card.scrollIntoView({ behavior:"smooth", block:"center" });
      }
    };

    adminSlots.appendChild(el);
  });
}

async function loadAdminBookings(dateISO){
  if(!adminBookingList) return;

  const qy = query(collection(db,"bookings_private"), where("date","==",dateISO));
  const snap = await getDocs(qy);

  if(snap.empty){
    renderAdminSlots([]);

    adminBookingList.innerHTML = `<div class="empty">No bookings for this date.</div>`;
    if(admCount) admCount.textContent="0";
    if(admHours) admHours.textContent="0";
    if(admSales) admSales.textContent="₱0";
    return;
  }

  const items = snap.docs.map(d=>({ docId:d.id, ...d.data() }))
    .sort((a,b)=>SLOTS.indexOf(a.startTime)-SLOTS.indexOf(b.startTime));

  renderAdminSlots(items);

  let totalHours = 0;
  items.forEach(b=> totalHours += Number(b.duration||1));

  if(admCount) admCount.textContent = String(items.length);
  if(admHours) admHours.textContent = String(totalHours);
  if(admSales) admSales.textContent = "₱" + (totalHours * PRICE_PER_HOUR);

  adminBookingList.innerHTML = "";
  items.forEach(b=>{
    const card=document.createElement("div");
    card.className="admin-card";
    card.setAttribute("data-booking-card", b.docId);

    card.innerHTML=`
      <div class="row">
        <strong>${escapeHtml(b.startTime||"")}</strong>
        <span>${escapeHtml(String(b.duration||1))}h • ${escapeHtml(String(b.partySize||""))} pax</span>
      </div>
      <div class="row">
        <span>${escapeHtml(b.name||"")}</span>
        <span>${escapeHtml(b.phone||"")}</span>
      </div>
      <div class="admin-actions">
        <button class="btn-danger" data-private="${escapeHtml(b.docId)}" data-public="${escapeHtml(b.publicId||"")}">
          Remove / Unbook
        </button>
      </div>
    `;
    adminBookingList.appendChild(card);
  });

  adminBookingList.querySelectorAll(".btn-danger").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const privateId = btn.getAttribute("data-private");
      const publicId  = btn.getAttribute("data-public");
      if(!confirm("Remove this booking and make the slot available again?")) return;

      try{
        await removeBookingAdmin({ privateId, publicId });
        toast("Removed booking", "success", "Slot is available again.");
        await loadAdminBookings(dateISO);
      }catch(e){
        console.error(e);
        toast("Remove failed", "error", e?.message || "Missing permissions");
      }
    });
  });
}

// =======================
// CHAT (ADMIN INBOX)
// =======================
let activeCid = null;
let unsubMessages = null;
let unsubThreads = null;

function fmtTime(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : null;
    if(!d) return "";
    return d.toLocaleString();
  }catch{ return ""; }
}

function openThread(cid){
  activeCid = cid;
  if(activeThreadLabel) activeThreadLabel.textContent = cid;

  if(unsubMessages) { unsubMessages(); unsubMessages = null; }

  const msgsQ = query(
    collection(db, "conversations", cid, "messages"),
    orderBy("createdAt", "asc"),
    limit(200)
  );

  unsubMessages = onSnapshot(msgsQ, (snap)=>{
    if(!adminChatBody) return;
    adminChatBody.innerHTML = "";

    if(snap.empty){
      adminChatBody.innerHTML = `<div class="chat-empty">No messages yet.</div>`;
      return;
    }

    snap.forEach(docSnap=>{
      const m = docSnap.data();
      const who = (m.sender === "admin") ? "admin" : "user";
      const bubble = document.createElement("div");
      bubble.className = `bubble ${who}`;
      bubble.innerHTML = `
        <div>${escapeHtml(m.text || "")}</div>
        <div class="meta">${escapeHtml(who)} • ${escapeHtml(fmtTime(m.createdAt))}</div>
      `;
      adminChatBody.appendChild(bubble);
    });

    adminChatBody.scrollTop = adminChatBody.scrollHeight;
  });

  threadList?.querySelectorAll?.(".thread")?.forEach(x=>{
    x.classList.toggle("active", x.getAttribute("data-cid") === cid);
  });
}

function closeThread(){
  activeCid = null;
  if(activeThreadLabel) activeThreadLabel.textContent = "—";
  if(adminChatBody) adminChatBody.innerHTML = `<div class="chat-empty">Select a conversation.</div>`;
  if(unsubMessages) { unsubMessages(); unsubMessages = null; }
  threadList?.querySelectorAll?.(".thread")?.forEach(x=>x.classList.remove("active"));
}

closeThreadBtn?.addEventListener("click", closeThread);

function startThreadsListener(){
  if(!threadList) return;

  const convQ = query(collection(db, "conversations"), orderBy("updatedAt", "desc"), limit(50));
  if(unsubThreads) { unsubThreads(); unsubThreads = null; }

  unsubThreads = onSnapshot(convQ, (snap)=>{
    if(!threadList) return;

    if(threadCount) threadCount.textContent = String(snap.size);

    if(snap.empty){
      threadList.innerHTML = `<div class="empty">No conversations yet.</div>`;
      closeThread();
      return;
    }

    threadList.innerHTML = "";
    snap.forEach((d)=>{
      const c = d.data() || {};
      const cid = d.id;

      const el = document.createElement("div");
      el.className = "thread";
      el.setAttribute("data-cid", cid);

      const title = c.title || cid;
      const sub = c.lastText || (c.ownerUid ? `owner: ${c.ownerUid}` : "—");

      el.innerHTML = `
        <div class="t1">${escapeHtml(title)}</div>
        <div class="t2">${escapeHtml(sub)}</div>
      `;

      el.addEventListener("click", ()=>openThread(cid));
      threadList.appendChild(el);
    });

    if(!activeCid){
      const first = threadList.querySelector(".thread");
      if(first) first.click();
    }
  }, (err)=>{
    console.error(err);
    toast("Inbox failed", "error", err?.message || "");
  });
}

async function sendAdminMsg(){
  const text = (adminChatInput?.value || "").trim();
  if(!text) return;
  if(!activeCid){
    toast("Select a conversation first", "warn");
    return;
  }

  adminChatInput.value = ""; // clear immediately

  try{
    await addDoc(collection(db, "conversations", activeCid, "messages"), {
      text,
      sender: "admin",
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, "conversations", activeCid), {
      lastText: text,
      updatedAt: serverTimestamp()
    });

  }catch(e){
    console.error(e);
    toast("Send failed", "error", e?.message || "Missing permissions");
  }
}

adminChatSend?.addEventListener("click", sendAdminMsg);

adminChatInput?.addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){
    e.preventDefault();
    sendAdminMsg();
  }
});

// =======================
// DELETE CHAT (conversation + all messages)
// =======================
async function deleteActiveThread(){
  if(!activeCid){
    toast("Select a conversation first", "warn");
    return;
  }

  if(!confirm("Delete this chat? This will remove ALL messages.")) return;

  try{
    // stop listeners before delete
    if(unsubMessages) { unsubMessages(); unsubMessages = null; }

    // delete all messages
    const msgsSnap = await getDocs(collection(db, "conversations", activeCid, "messages"));

    const batch = writeBatch(db);
    msgsSnap.forEach(d => batch.delete(d.ref));

    // delete conversation doc
    batch.delete(doc(db, "conversations", activeCid));

    await batch.commit();

    toast("Chat deleted", "success");
    closeThread();
  }catch(e){
    console.error(e);
    toast("Delete failed", "error", e?.message || "Missing delete permission in Firestore rules.");
  }
}

threadDeleteBtn?.addEventListener("click", deleteActiveThread);

// =======================
// AUTH STATE
// =======================
lockUI();

onAuthStateChanged(auth, async (user)=>{
  if(!user){
    lockUI();
    return;
  }

  const ok = await isAdmin(user.uid).catch(()=>false);
  if(!ok){
    await signOut(auth);
    lockUI();
    toast("Alert: Not an admin", "error", "Go back to the User Site.");
    return;
  }

  unlockUI();
  renderCalendar();
  startThreadsListener();
});
