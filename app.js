// =======================
// GLOBAL ERROR LOG
// =======================
window.addEventListener("error", (e) => console.error("JS Error:", e.message, e.filename, e.lineno));
window.addEventListener("unhandledrejection", (e) => console.error("Promise Rejection:", e.reason));

// =======================
// ROLE
// =======================
const ROLE = window.__ROLE__ || "user";

// =======================
// TOAST (Fancy, colored)
// =======================
const toastWrap = document.getElementById("toastWrap");

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

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
  t.className="toast fancy";
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
  collection, addDoc, getDocs, query, where, orderBy, limit,
  doc, setDoc, getDoc, serverTimestamp, onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged,
  signInAnonymously, signInWithEmailAndPassword, signOut
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
// HELPERS
// =======================
function pad2(n){ return String(n).padStart(2,"0"); }
function isoDate(y,m,d){ return `${y}-${pad2(m)}-${pad2(d)}`; }
function uiDate(iso){
  if(!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y,m,d]=iso.split("-");
  return `${m}/${d}/${y}`;
}

function cleanPhone(p){ return (p||"").replace(/[^\d+]/g,""); }
function isValidPhone(p){
  const x=cleanPhone(p);
  return /^(\+?63|0)9\d{9}$/.test(x);
}
function isValidName(n){
  const s=(n||"").trim();
  return s.length>=2 && s.length<=60;
}

async function waitForAuthReady(){
  return new Promise((resolve)=>{
    const unsub = onAuthStateChanged(auth, (u)=>{ unsub(); resolve(u); });
  });
}

async function ensureCustomerAuth(){
  if(ROLE !== "user") return;
  await waitForAuthReady();
  if(auth.currentUser) return;

  try{
    await signInAnonymously(auth);
  }catch(e){
    console.error(e);
    toast("Chat unavailable", "error", "Enable Anonymous Sign-in in Firebase Auth.");
    throw e;
  }
}

// ===== Admin check via Firestore doc: admins/{uid} exists =====
async function isAdmin(uid){
  if(!uid) return false;
  try{
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  }catch(e){
    return false;
  }
}

// =======================
// BUSINESS RULES
// =======================
const OPEN_HOUR = 6;
const CLOSE_HOUR = 22;
const PRICE_PER_HOUR = 150;

function buildSlots(){
  const arr=[];
  for(let h=OPEN_HOUR; h<CLOSE_HOUR; h++) arr.push(`${pad2(h)}:00`);
  return arr;
}
const SLOTS = buildSlots();

// =======================
// DOM REFS (shared ids)
// =======================
const calDays = document.getElementById("calendarDays");
const calMonth = document.getElementById("calMonth");
const btnPrev = document.getElementById("calPrev");
const btnNext = document.getElementById("calNext");
const slotBox = document.getElementById("timeSlots");
const summaryDateEl = document.getElementById("summaryDate");

// user booking form
const startTimeEl = document.getElementById("startTime");
const durationEl  = document.getElementById("duration");
const partySizeEl = document.getElementById("partySize");
const nameEl      = document.getElementById("customerName");
const phoneEl     = document.getElementById("customerPhone");
const summaryTimeEl     = document.getElementById("summaryTime");
const summaryGuestsEl   = document.getElementById("summaryGuests");
const summaryTotalEl    = document.getElementById("summaryTotal");
const summaryDurationEl = document.getElementById("summaryDuration");
const confirmBtn        = document.getElementById("confirmBtn");

// user chat
const chatFab    = document.getElementById("chatFab");
const chatWidget = document.getElementById("chatWidget");
const chatClose  = document.getElementById("chatClose");
const chatBody   = document.getElementById("chatBody");
const chatInput  = document.getElementById("chatInput");
const chatSend   = document.getElementById("chatSend");

// admin lock + auth
const adminLockedScreen = document.getElementById("adminLockedScreen");
const adminApp = document.getElementById("adminApp");
const adminEmail = document.getElementById("adminEmail");
const adminPassword = document.getElementById("adminPassword");
const adminLoginBtn = document.getElementById("adminLoginBtn");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");

// admin bookings
const adminBookingList = document.getElementById("adminBookingList");
const admDate = document.getElementById("admDate");
const admCount = document.getElementById("admCount");
const admHours = document.getElementById("admHours");
const admSales = document.getElementById("admSales");

// admin inbox
const threadList = document.getElementById("threadList");
const threadTitle = document.getElementById("threadTitle");
const adminChatBody = document.getElementById("adminChatBody");
const adminChatInput = document.getElementById("adminChatInput");
const adminChatSend = document.getElementById("adminChatSend");

// admin tabs
const tabBtns = document.querySelectorAll(".tab[data-tab]");
const tabBookings = document.getElementById("tab-bookings");
const tabInbox = document.getElementById("tab-inbox");

// gallery
const cfTrack = document.getElementById("cfTrack");
const cfPrev = document.getElementById("cfPrev");
const cfNext = document.getElementById("cfNext");
const cfDots = document.getElementById("cfDots");
// lightbox
const lb = document.getElementById("lightbox");
const lbImg = document.getElementById("lbImg");
const lbCap = document.getElementById("lbCap");
const lbClose = document.getElementById("lbClose");
const lbPrev = document.getElementById("lbPrev");
const lbNext = document.getElementById("lbNext");

// =======================
// ADMIN TABS
// =======================
if(tabBtns.length){
  tabBtns.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      tabBtns.forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");

      const which = btn.dataset.tab;
      if(which==="bookings"){
        tabBookings?.classList.add("show");
        tabInbox?.classList.remove("show");
      }else{
        tabInbox?.classList.add("show");
        tabBookings?.classList.remove("show");
      }
    });
  });
}

// =======================
// CALENDAR (starts current month always)
// =======================
let selectedDateISO = null;
let current = new Date();
current = new Date(current.getFullYear(), current.getMonth(), 1);
let didAutoSelectToday = false;

function clearActiveDay(){
  if(!calDays) return;
  calDays.querySelectorAll("span").forEach(x=>x.classList.remove("active","today"));
}

function renderCalendar(){
  if(!calDays || !calMonth) return;

  calDays.innerHTML="";
  const y=current.getFullYear();
  const m=current.getMonth();
  calMonth.textContent=current.toLocaleString("default",{month:"long"})+" "+y;

  const firstDow=new Date(y,m,1).getDay();
  const lastDay=new Date(y,m+1,0).getDate();

  for(let i=0;i<firstDow;i++) calDays.appendChild(document.createElement("span"));

  const today = new Date();
  const isThisMonth = today.getFullYear()===y && today.getMonth()===m;

  for(let d=1; d<=lastDay; d++){
    const s=document.createElement("span");
    s.textContent=d;

    if(isThisMonth && d===today.getDate()){
      s.classList.add("today");
      if(!didAutoSelectToday && ROLE==="user"){
        didAutoSelectToday = true;
        setTimeout(()=>s.click(), 0);
      }
    }

    s.onclick = async ()=>{
      clearActiveDay();
      s.classList.add("active");

      selectedDateISO = isoDate(y, m+1, d);
      if(summaryDateEl) summaryDateEl.textContent = uiDate(selectedDateISO);

      startSlotsLive(selectedDateISO);

      if(ROLE==="admin"){
        await loadAdminBookings(selectedDateISO);
      }
    };

    calDays.appendChild(s);
  }
}

btnPrev?.addEventListener("click",()=>{ current.setMonth(current.getMonth()-1); didAutoSelectToday=true; renderCalendar(); });
btnNext?.addEventListener("click",()=>{ current.setMonth(current.getMonth()+1); didAutoSelectToday=true; renderCalendar(); });

// =======================
// BOOKING FORM (USER)
// =======================
function maxDurationForStart(startTime){
  const startHour=Number((startTime||"06:00").split(":")[0]);
  return Math.max(1, CLOSE_HOUR-startHour);
}

function populateStartTimes(){
  if(!startTimeEl) return;
  startTimeEl.innerHTML="";
  for(const t of SLOTS){
    const opt=document.createElement("option");
    opt.value=t; opt.textContent=t;
    startTimeEl.appendChild(opt);
  }
}
function populatePartySize(){
  if(!partySizeEl) return;
  partySizeEl.innerHTML="";
  for(let i=1;i<=8;i++){
    const opt=document.createElement("option");
    opt.value=String(i); opt.textContent=String(i);
    partySizeEl.appendChild(opt);
  }
}
function populateDuration(){
  if(!durationEl || !startTimeEl) return;
  const maxDur=maxDurationForStart(startTimeEl.value);
  durationEl.innerHTML="";
  for(let d=1; d<=maxDur; d++){
    const opt=document.createElement("option");
    opt.value=String(d);
    opt.textContent=`${d} hour${d>1?"s":""}`;
    durationEl.appendChild(opt);
  }
  updateReceipt();
}
function updateReceipt(){
  if(summaryTimeEl && startTimeEl) summaryTimeEl.textContent = startTimeEl.value || "—";
  if(summaryGuestsEl && partySizeEl) summaryGuestsEl.textContent = partySizeEl.value || "1";
  const dur = Number(durationEl?.value || 1);
  if(summaryDurationEl) summaryDurationEl.textContent = `${dur} hour${dur>1?"s":""}`;
  if(summaryTotalEl) summaryTotalEl.textContent = "₱" + (dur * PRICE_PER_HOUR);
}

startTimeEl?.addEventListener("change", ()=>{ populateDuration(); updateReceipt(); paintSelection(); });
durationEl?.addEventListener("change", ()=>{ updateReceipt(); paintSelection(); });
partySizeEl?.addEventListener("change", updateReceipt);

// =======================
// LIVE SLOTS + RANGE HIGHLIGHT
// =======================
let unsubscribeSlots = null;
let bookedRanges = [];
let slotElsByTime = new Map();

function computeBookedRanges(docs){
  const ranges = [];
  for (const d of docs){
    const startIdx = SLOTS.indexOf(d.startTime);
    const dur = Number(d.duration || 1);
    if(startIdx >= 0) ranges.push({ startIndex: startIdx, endIndexExclusive: startIdx + dur });
  }
  return ranges;
}
function selectionRange(){
  if(!startTimeEl || !durationEl) return null;
  const start = SLOTS.indexOf(startTimeEl.value);
  const dur = Number(durationEl.value || 1);
  if(start < 0) return null;
  return { startIndex: start, endIndexExclusive: start + dur };
}
function overlapsBooked(sel){
  if(!sel) return false;
  return bookedRanges.some(b =>
    Math.max(sel.startIndex, b.startIndex) < Math.min(sel.endIndexExclusive, b.endIndexExclusive)
  );
}
function paintSelection(){
  for(const el of slotElsByTime.values()){
    el.classList.remove("selected","conflict");
  }
  const sel = selectionRange();
  if(!sel) return;

  for(let i=sel.startIndex; i<sel.endIndexExclusive; i++){
    const t = SLOTS[i];
    const el = slotElsByTime.get(t);
    if(el) el.classList.add("selected");
  }
  if(overlapsBooked(sel)){
    for(let i=sel.startIndex; i<sel.endIndexExclusive; i++){
      const t = SLOTS[i];
      const el = slotElsByTime.get(t);
      if(el) el.classList.add("conflict");
    }
  }
}

function renderSlotsUI(){
  if(!slotBox) return;
  slotBox.innerHTML = "";
  slotElsByTime = new Map();

  function isBookedIndex(idx){
    return bookedRanges.some(b => idx >= b.startIndex && idx < b.endIndexExclusive);
  }

  SLOTS.forEach((t, idx)=>{
    const div = document.createElement("div");
    div.className = "time-slot";
    div.dataset.time = t;

    if(isBookedIndex(idx)){
      div.classList.add("booked");
      div.textContent = `${t} (Booked)`;
      div.onclick = ()=>toast("Already booked.", "warn", "Choose another available hour.");
    }else{
      div.classList.add("available");
      div.textContent = t;

      // user can pick start time
      if(ROLE==="user"){
        div.onclick = ()=>{
          if(startTimeEl) startTimeEl.value = t;
          populateDuration();
          updateReceipt();
          paintSelection();
        };
      }
    }

    slotElsByTime.set(t, div);
    slotBox.appendChild(div);
  });

  paintSelection();
}

function startSlotsLive(dateISO){
  if(!slotBox) return;
  if(unsubscribeSlots) unsubscribeSlots();

  const qy = query(collection(db,"bookings_public"), where("date","==",dateISO));
  unsubscribeSlots = onSnapshot(qy, (snap)=>{
    const docs = snap.docs.map(d=>d.data());
    bookedRanges = computeBookedRanges(docs);
    renderSlotsUI();
  }, (err)=>{
    console.error(err);
    toast("Slots unavailable", "error", err?.message || "Check rules.");
  });
}

// =======================
// CHAT (USER) + INBOX (ADMIN)
// =======================
const CHAT_KEY="area55_conversation_id";
let activeConversationId = localStorage.getItem(CHAT_KEY) || null;
let unsubscribeUserChat = null;

function showChatEmpty(text){
  if(!chatBody) return;
  chatBody.innerHTML=`<div class="chat-empty">${escapeHtml(text)}</div>`;
}

function renderBubble({sender,text,createdAt}, meUid){
  const isMe = sender===meUid;
  const div=document.createElement("div");
  div.className=`bubble ${isMe?"me":"them"}`;
  const timeStr = createdAt?.toDate ? createdAt.toDate().toLocaleString() : "";
  div.innerHTML=`
    <div>${escapeHtml(text||"")}</div>
    <div class="meta">${isMe?"You":"Admin"} • ${escapeHtml(timeStr)}</div>
  `;
  return div;
}

async function ensureConversationDoc(){
  await ensureCustomerAuth();
  const uid = auth.currentUser.uid;
  const convoId = `general_${uid}`;
  const ref = doc(db,"conversations", convoId);

  const snap = await getDoc(ref);

  if(!snap.exists()){
    const name=(nameEl?.value||"Customer").trim() || "Customer";
    const phone=cleanPhone(phoneEl?.value||"");

    await setDoc(ref,{
      ownerUid: uid,
      name,
      phone,
      type:"general",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp()
    });
  }else{
    await setDoc(ref,{ updatedAt: serverTimestamp() },{ merge:true });
  }

  activeConversationId = convoId;
  localStorage.setItem(CHAT_KEY, convoId);
  return convoId;
}

function startUserChatListener(convoId){
  if(ROLE!=="user" || !chatBody) return;
  if(unsubscribeUserChat) unsubscribeUserChat();

  const meUid=auth.currentUser?.uid;
  if(!meUid){ showChatEmpty("Signing in…"); return; }

  const msgsRef=collection(db,"conversations",convoId,"messages");
  const qy=query(msgsRef, orderBy("createdAt","asc"), limit(200));

  unsubscribeUserChat = onSnapshot(qy,(snap)=>{
    chatBody.innerHTML="";
    if(snap.empty){
      showChatEmpty("Say hi 👋 Ask anything about bookings, pricing, rules, etc.");
      return;
    }
    snap.docs.forEach(d=> chatBody.appendChild(renderBubble(d.data(), meUid)));
    chatBody.scrollTop = chatBody.scrollHeight;
  },(err)=>{
    console.error(err);
    showChatEmpty("Chat unavailable (check rules).");
    toast("Chat error", "error", err?.message || "");
  });
}

chatFab?.addEventListener("click", async ()=>{
  chatWidget?.classList.add("open");
  chatWidget?.setAttribute("aria-hidden","false");

  try{
    const convoId = await ensureConversationDoc();
    startUserChatListener(convoId);
  }catch(e){
    console.error("CHAT OPEN ERROR:", e);
    showChatEmpty("Chat not available. Check Firebase Auth + Rules.");
    toast("Could not open chat", "error", e?.message || "Missing permissions.");
  }
});

chatClose?.addEventListener("click",()=>{
  chatWidget?.classList.remove("open");
  chatWidget?.setAttribute("aria-hidden","true");
});

chatSend?.addEventListener("click", async ()=>{
  if(ROLE!=="user") return;

  const text=(chatInput?.value||"").trim();
  if(!text) return;

  try{
    const convoId = await ensureConversationDoc();

    await addDoc(collection(db,"conversations",convoId,"messages"),{
      sender: auth.currentUser.uid,
      text,
      createdAt: serverTimestamp()
    });

    await setDoc(doc(db,"conversations", convoId),{
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp()
    }, { merge:true });

    chatInput.value="";
  }catch(e){
    console.error(e);
    toast("Failed to send", "error", e?.message || "");
  }
});

// =======================
// CREATE BOOKING (USER)
// =======================
async function createBooking(){
  if(ROLE!=="user") return;

  await ensureCustomerAuth();

  if(!selectedDateISO) return toast("Select a date first.", "warn");
  if(!startTimeEl?.value) return toast("Select a start time.", "warn");

  const name = (nameEl?.value || "").trim();
  const phone = cleanPhone(phoneEl?.value || "");
  const startTime = startTimeEl.value;
  const duration = Number(durationEl?.value || 1);
  const partySize = Number(partySizeEl?.value || 1);

  if(!isValidName(name)) return toast("Please enter your full name.", "error");
  if(!isValidPhone(phone)) return toast("Please enter a valid PH phone number.", "error", "Example: 09xxxxxxxxx");

  const sel = selectionRange();
  if(overlapsBooked(sel)){
    return toast("Some selected hours are booked.", "warn", "Change start time or reduce duration.");
  }

  try{
    const convoId = await ensureConversationDoc();

    const batch = writeBatch(db);
    const pubRef = doc(collection(db,"bookings_public"));
    const privRef = doc(collection(db,"bookings_private"));

    batch.set(pubRef,{
      date: selectedDateISO,
      startTime,
      duration,
      createdAt: serverTimestamp()
    });

    batch.set(privRef,{
      date: selectedDateISO,
      startTime,
      duration,
      partySize,
      name,
      phone,
      ownerUid: auth.currentUser.uid,
      publicId: pubRef.id,
      createdAt: serverTimestamp()
    });

    batch.set(doc(db,"conversations", convoId),{
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastBooking: {
        bookingId: privRef.id,
        publicId: pubRef.id,
        date: selectedDateISO,
        startTime,
        duration,
        partySize
      }
    }, { merge:true });

    await batch.commit();
    toast("Booking confirmed!", "success", `${uiDate(selectedDateISO)} • ${startTime} • ${duration}h`);
  }catch(e){
    console.error(e);
    toast("Booking failed.", "error", e?.message || "");
  }
}
confirmBtn?.addEventListener("click", createBooking);

// =======================
// ADMIN LOGIN + LOCK SYSTEM (must login first)
// =======================
adminLoginBtn?.addEventListener("click", async ()=>{
  try{
    const email = (adminEmail?.value||"").trim();
    const pass  = adminPassword?.value||"";
    if(!email || !pass) return toast("Enter email + password.", "warn");
    await signInWithEmailAndPassword(auth, email, pass);
    toast("Logged in", "success", email);
  }catch(e){
    console.error(e);
    toast("Login failed", "error", e?.message || "");
  }
});

adminLogoutBtn?.addEventListener("click", async ()=>{
  try{
    await signOut(auth);
    toast("Logged out", "info");
  }catch(e){
    console.error(e);
  }
});

// =======================
// ADMIN BOOKINGS
// =======================
async function removeBookingAdmin({ privateId, publicId }){
  const batch = writeBatch(db);
  batch.delete(doc(db,"bookings_private", privateId));
  if(publicId) batch.delete(doc(db,"bookings_public", publicId));
  await batch.commit();
}

async function loadAdminBookings(dateISO){
  if(ROLE!=="admin" || !adminBookingList) return;

  if(summaryDateEl) summaryDateEl.textContent = uiDate(dateISO);
  if(admDate) admDate.textContent = uiDate(dateISO);

  const qy = query(collection(db,"bookings_private"), where("date","==",dateISO));
  const snap = await getDocs(qy);

  if(snap.empty){
    adminBookingList.innerHTML = `<div class="admin-empty">No bookings for this date.</div>`;
    if(admCount) admCount.textContent="0";
    if(admHours) admHours.textContent="0";
    if(admSales) admSales.textContent="₱0";
    return;
  }

  const items = snap.docs.map(d=>({ docId:d.id, ...d.data() }))
    .sort((a,b)=>SLOTS.indexOf(a.startTime)-SLOTS.indexOf(b.startTime));

  let totalHours=0;
  items.forEach(b=> totalHours += Number(b.duration||1));

  if(admCount) admCount.textContent = String(items.length);
  if(admHours) admHours.textContent = String(totalHours);
  if(admSales) admSales.textContent = "₱" + (totalHours * PRICE_PER_HOUR);

  adminBookingList.innerHTML = "";
  items.forEach(b=>{
    const card=document.createElement("div");
    card.className="admin-card";
    card.innerHTML=`
      <div class="row">
        <strong>${escapeHtml(b.startTime)}</strong>
        <span>${escapeHtml(String(b.duration||1))}h • ${escapeHtml(String(b.partySize||""))} pax</span>
      </div>
      <div class="row">
        <span>${escapeHtml(b.name||"")}</span>
        <span>${escapeHtml(b.phone||"")}</span>
      </div>
      <div class="admin-actions">
        <button class="btn-danger"
          data-private="${escapeHtml(b.docId)}"
          data-public="${escapeHtml(b.publicId||"")}">
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
      const ok = confirm("Remove this booking and make the slot available again?");
      if(!ok) return;

      try{
        await removeBookingAdmin({ privateId, publicId });
        toast("Removed booking", "success", "Slot is available again.");
        await loadAdminBookings(dateISO);
      }catch(e){
        console.error(e);
        toast("Remove failed", "error", e?.message || "");
      }
    });
  });
}

// =======================
// ADMIN INBOX (Threads + Messages)
// =======================
let selectedThreadId=null;
let unsubscribeAdminThread=null;
let unsubscribeThreads=null;

function renderAdminBubble(msg, adminUid){
  const isMe = msg.sender === adminUid;
  const div=document.createElement("div");
  div.className=`bubble ${isMe?"me":"them"}`;
  const timeStr = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleString() : "";
  div.innerHTML=`
    <div>${escapeHtml(msg.text||"")}</div>
    <div class="meta">${isMe?"Admin":"Customer"} • ${escapeHtml(timeStr)}</div>
  `;
  return div;
}

function selectThread(id, convo){
  selectedThreadId=id;

  if(threadTitle){
    const extra = convo.lastBooking?.date
      ? ` • ${uiDate(convo.lastBooking.date)} ${convo.lastBooking.startTime} (${convo.lastBooking.duration||1}h)`
      : "";
    threadTitle.textContent = `${convo.name||"Customer"} • ${convo.phone||""}${extra}`;
  }

  document.querySelectorAll(".thread").forEach(x=>x.classList.remove("active"));
  const el = document.querySelector(`[data-thread="${id}"]`);
  if(el) el.classList.add("active");

  if(unsubscribeAdminThread) unsubscribeAdminThread();
  if(!adminChatBody) return;

  const msgsRef = collection(db,"conversations", id, "messages");
  const qy = query(msgsRef, orderBy("createdAt","asc"), limit(300));
  const adminUid = auth.currentUser?.uid;

  unsubscribeAdminThread = onSnapshot(qy, (snap)=>{
    adminChatBody.innerHTML="";
    if(snap.empty){
      adminChatBody.innerHTML = `<div class="admin-empty">No messages yet.</div>`;
      return;
    }
    snap.docs.forEach(d=> adminChatBody.appendChild(renderAdminBubble(d.data(), adminUid)));
    adminChatBody.scrollTop = adminChatBody.scrollHeight;
  }, (err)=>{
    console.error(err);
    adminChatBody.innerHTML = `<div class="admin-empty">Inbox error: ${escapeHtml(err?.message||"")}</div>`;
  });
}

function loadThreads(){
  if(ROLE!=="admin" || !threadList) return;

  if(unsubscribeThreads) unsubscribeThreads();

  const qy=query(collection(db,"conversations"), orderBy("lastMessageAt","desc"), limit(60));

  unsubscribeThreads = onSnapshot(qy,(snap)=>{
    threadList.innerHTML="";
    if(snap.empty){
      threadList.innerHTML = `<div class="thread"><div class="t1">No chats yet</div><div class="t2">Customers appear when they chat.</div></div>`;
      return;
    }

    snap.docs.forEach(docu=>{
      const c=docu.data();
      const div=document.createElement("div");
      div.className="thread" + (docu.id===selectedThreadId ? " active":"");
      div.dataset.thread = docu.id;

      const last = c.lastBooking?.date
        ? `${uiDate(c.lastBooking.date)} • ${c.lastBooking.startTime} (${c.lastBooking.duration||1}h)`
        : "No booking yet";

      div.innerHTML=`
        <div class="t1">${escapeHtml(c.name||"Customer")} • ${escapeHtml(c.phone||"")}</div>
        <div class="t2">${escapeHtml(last)}</div>
      `;
      div.onclick=()=>selectThread(docu.id, c);
      threadList.appendChild(div);
    });
  }, (err)=>{
    console.error(err);
    threadList.innerHTML = `<div class="thread"><div class="t1">Inbox error</div><div class="t2">${escapeHtml(err?.message||"")}</div></div>`;
  });
}

adminChatSend?.addEventListener("click", async ()=>{
  if(ROLE!=="admin") return;
  if(!auth.currentUser) return toast("Login first.", "warn");
  if(!selectedThreadId) return toast("Select a chat thread.", "warn");

  const text=(adminChatInput?.value||"").trim();
  if(!text) return;

  try{
    await addDoc(collection(db,"conversations", selectedThreadId, "messages"),{
      sender: auth.currentUser.uid,
      text,
      createdAt: serverTimestamp()
    });

    await setDoc(doc(db,"conversations", selectedThreadId),{
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp()
    }, { merge:true });

    adminChatInput.value="";
  }catch(e){
    console.error(e);
    toast("Failed to send", "error", e?.message || "");
  }
});

// =======================
// 3D COVERFLOW GALLERY (smooth + dark neighbors)
// =======================
let galleryItems = [];
let cfIndex = 0;

function clampIndex(i){
  if(galleryItems.length === 0) return 0;
  const n = galleryItems.length;
  return ((i % n) + n) % n;
}

function renderDots(){
  if(!cfDots) return;
  cfDots.innerHTML = "";
  galleryItems.forEach((_, i)=>{
    const s=document.createElement("span");
    if(i===cfIndex) s.classList.add("active");
    s.onclick=()=>{ cfIndex=i; layoutCoverflow(true); };
    cfDots.appendChild(s);
  });
}

function layoutCoverflow(animate=true){
  if(!cfTrack) return;
  cfIndex = clampIndex(cfIndex);

  const spread = 190;
  const depth  = 260;
  const rot    = 52;

  [...cfTrack.children].forEach((el, i)=>{
    const offset = i - cfIndex;

    const x = offset * spread;
    const z = -Math.abs(offset) * depth;
    const r = offset * -rot;

    const isCenter = offset === 0;
    const fade = Math.min(1, Math.abs(offset) / 4);
    const opacity = isCenter ? 1 : (0.75 - fade * 0.25);
    const brightness = isCenter ? 1 : (0.78 - fade * 0.20);
    const scale = isCenter ? 1 : 0.92;

    el.style.transition = animate ? "" : "none";
    el.style.transform = `translateX(${x}px) translateZ(${z}px) rotateY(${r}deg) scale(${scale})`;
    el.style.opacity = String(opacity);
    el.style.filter = `brightness(${brightness}) saturate(${isCenter ? 1 : 0.9})`;

    const far = Math.abs(offset) > 4;
    el.style.pointerEvents = far ? "none" : "auto";
  });

  renderDots();
}

function buildCoverflowCards(items){
  if(!cfTrack) return;

  cfTrack.innerHTML = "";
  items.forEach((g, i)=>{
    const card=document.createElement("div");
    card.className="cf-card";
    card.innerHTML = `
      <img src="${g.url}" alt="${escapeHtml(g.caption||"Photo")}" />
      <div class="cf-cap">${escapeHtml(g.caption||"Area 55")}</div>
    `;
    card.onclick=()=>openLB(i);
    cfTrack.appendChild(card);
  });

  cfIndex = 0;
  layoutCoverflow(true);
}

function openLB(i){
  if(!lb || !lbImg) return;
  cfIndex = clampIndex(i);
  const g = galleryItems[cfIndex];
  lbImg.src = g.url;
  if(lbCap) lbCap.textContent = g.caption || "";
  lb.classList.add("open");
  lb.setAttribute("aria-hidden","false");
}
function closeLB(){
  if(!lb) return;
  lb.classList.remove("open");
  lb.setAttribute("aria-hidden","true");
}
function prevLB(){ openLB(cfIndex-1); }
function nextLB(){ openLB(cfIndex+1); }

lbClose?.addEventListener("click", closeLB);
lbPrev?.addEventListener("click", prevLB);
lbNext?.addEventListener("click", nextLB);
lb?.addEventListener("click",(e)=>{ if(e.target===lb) closeLB(); });

cfPrev?.addEventListener("click", ()=>{ cfIndex--; layoutCoverflow(true); });
cfNext?.addEventListener("click", ()=>{ cfIndex++; layoutCoverflow(true); });

// drag / touch
(function enableDrag(){
  if(!cfTrack) return;
  let isDown=false, startX=0;

  cfTrack.addEventListener("mousedown",(e)=>{
    isDown=true; startX=e.clientX;
  });
  window.addEventListener("mouseup",()=>{ isDown=false; });
  window.addEventListener("mousemove",(e)=>{
    if(!isDown) return;
    const dx = e.clientX - startX;
    if(Math.abs(dx) > 50){
      cfIndex += dx > 0 ? -1 : 1;
      startX = e.clientX;
      layoutCoverflow(true);
    }
  });

  let tx=0;
  cfTrack.addEventListener("touchstart",(e)=>{ tx = e.touches[0].clientX; }, {passive:true});
  cfTrack.addEventListener("touchmove",(e)=>{
    const cx = e.touches[0].clientX;
    const dx = cx - tx;
    if(Math.abs(dx) > 50){
      cfIndex += dx > 0 ? -1 : 1;
      tx = cx;
      layoutCoverflow(true);
    }
  }, {passive:true});
})();

async function loadUserGallery(){
  if(!cfTrack || ROLE!=="user") return;

  // Local fallback (replace with your images)
  galleryItems = [
    { url:"photo1.jpg", caption:"Room Setup" },
    { url:"photo2.jpg", caption:"Lights" },
    { url:"photo3.jpg", caption:"Party Night" },
    { url:"photo4.jpg", caption:"Stage" },
  ];

  buildCoverflowCards(galleryItems);
}

// =======================
// AUTH STATE (Admin lock + init)
// =======================
onAuthStateChanged(auth, async (user)=>{
  if(ROLE==="user"){
    if(!user) await ensureCustomerAuth().catch(()=>{});
    return;
  }

  // ADMIN page: must be logged in AND must exist in admins/{uid}
  const loggedIn = !!user;
  let allowed = false;

  if(loggedIn){
    allowed = await isAdmin(user.uid);
  }

  if(adminLockedScreen) adminLockedScreen.style.display = allowed ? "none" : "flex";
  if(adminApp) adminApp.style.display = allowed ? "block" : "none";

  if(!allowed){
    if(loggedIn){
      toast("Not an admin", "error", "Add your UID into Firestore admins/{uid}.");
    }
    return;
  }

  // Allowed admin
  loadThreads();
  renderCalendar();

  // auto select today
  const today = new Date();
  const y=current.getFullYear();
  const m=current.getMonth();
  if(today.getFullYear()===y && today.getMonth()===m){
    const dayEls=[...calDays.querySelectorAll("span")].filter(x=>x.textContent.trim()!=="");
    const todayEl = dayEls.find(x=>Number(x.textContent)===today.getDate());
    if(todayEl) todayEl.click();
  }
});

// =======================
// INIT
// =======================
(function init(){
  renderCalendar();

  if(ROLE==="user"){
    populateStartTimes();
    populatePartySize();
    populateDuration();
    updateReceipt();
    loadUserGallery();
  }
})();
