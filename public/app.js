import { createCircularGallery } from "/circular-gallery.js";


const $ = (id) => document.getElementById(id);
const CAT = { general: "ภาพรวม", love: "ความรัก", career: "การงาน", money: "การเงิน" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// สร้าง element แบบสั้น ๆ (ใช้ textContent เสมอ ป้องกัน XSS)
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => e.append(k));
  return e;
}

// ---------- เรียก REST API ของตัวเองเท่านั้น ----------
async function api(url, options = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error((data.details || [data.error]).join("\n"));
  return data;
}

// ---------- ประวัติ (GET พร้อมกรอง) ----------
async function loadHistory() {
  const cat = $("filter").value;
  const list = await api("/api/readings" + (cat ? `?category=${cat}` : ""));
  const ul = $("history");
  ul.innerHTML = "";
  if (!list.length) {
    ul.append(el("li", { className: "empty", textContent: "ยังไม่มีประวัติ ลองเปิดดวงครั้งแรกได้เลย" }));
    return;
  }
  list.slice().reverse().forEach((r) => ul.append(historyItem(r)));
}

function historyItem(r) {
  const li = el("li");
  const top = el("div", { className: "h-top" },
    el("strong", { textContent: `${r.name} (เกิด ${r.birthDate})` }),
    el("span", { className: "tag", textContent: CAT[r.category] }));
  const thumbs = el("div", { className: "thumbs" });
  r.cards.forEach((c) => {
    if (c.image) thumbs.append(el("img", { src: c.image, alt: c.name, title: `${c.position}: ${c.name}`, className: c.reversed ? "rev" : "", loading: "lazy" }));
  });
  const cards = el("p", { className: "h-cards", textContent: r.cards.map((c) => `${c.position}: ${c.th}${c.reversed ? " (กลับหัว)" : ""}`).join(" • ") });
  const note = el("p", { className: "h-note", textContent: r.note ? `บันทึก: ${r.note}` : "" });
  const view = el("button", { textContent: "ดูผลอีกครั้ง", onclick: () => showResult(r, false) });
  const edit = el("button", { textContent: "แก้ไข", onclick: () => showEdit(li, r) });
  const del = el("button", { className: "danger", textContent: "ลบ", onclick: async () => {
    if (!confirm(`ลบผลการดูดวงของ ${r.name}?`)) return;
    await api(`/api/readings/${r.id}`, { method: "DELETE" });
    loadHistory();
  }});
  li.append(top, thumbs, cards, note, el("div", { className: "actions" }, view, edit, del));
  return li;
}

// ---------- แก้ไข (PATCH) ----------
function showEdit(li, r) {
  const name = el("input", { value: r.name, maxLength: 50 });
  const sel = el("select");
  Object.entries(CAT).forEach(([v, t]) => sel.add(new Option(t, v, false, v === r.category)));
  const note = el("textarea", { value: r.note, maxLength: 300, rows: 2, placeholder: "บันทึกของคุณ" });
  const save = el("button", { textContent: "บันทึกการแก้ไข", onclick: async () => {
    try {
      await api(`/api/readings/${r.id}`, { method: "PATCH", body: JSON.stringify({ name: name.value, category: sel.value, note: note.value }) });
      loadHistory();
    } catch (e) { alert(e.message); }
  }});
  li.querySelector(".actions").replaceWith(el("div", { className: "edit-row" }, name, sel, note, save));
}

// ---------- แอนิเมชันสับไพ่ ----------
// สับกี่รอบขึ้นกับวันที่เกิด (เกิดวันที่ 4 = 4 รอบ) แต่ไม่แสดงตัวเลขให้ผู้ใช้เห็น
async function animateShuffle(times, isCurrent) {
  const deck = $("deck");
  $("shuffleText").textContent = "กำลังสับไพ่...";
  for (let i = 0; i < times; i++) {
    if (!isCurrent()) return false;
    deck.classList.remove("shuffling");
    void deck.offsetWidth; // รีสตาร์ท animation
    deck.classList.add("shuffling");
    await sleep(reduceMotion() ? 60 : 300);
  }
  deck.classList.remove("shuffling");
  return isCurrent();
}

// ---------- แสดงผลไพ่ ----------
function cardBlock(c) {
  const img = el("img", { src: c.image, alt: c.name, className: c.reversed ? "rev" : "" });
  const inner = el("div", { className: "flip-inner" },
    el("div", { className: "face back" }),
    el("div", { className: "face front" }, img));
  const flip = el("div", { className: "flip" }, inner);
  const info = el("div", { className: "info" },
    el("div", { className: "row" },
      el("span", { className: "pos", textContent: c.position }),
      el("span", { className: "badge " + (c.reversed ? "down" : "up"), textContent: c.reversed ? "ไพ่กลับหัว" : "ไพ่ตรง" })),
    el("h3", { textContent: c.th }),
    el("p", { className: "sub", textContent: `${c.name}${c.domain ? " • " + c.domain : ""}` }),
    el("p", { className: "desc", textContent: c.meaning }),
    el("div", { className: "kws" }, ...(c.keywords || []).map((k) => el("span", { textContent: k }))));
  return { block: el("div", { className: "tarot" }, flip, info), flip };
}

async function showResult(r, animate) {
  if (location.hash !== "#/play") { skipGuard = true; location.hash = "#/play"; }
  $("stage").hidden = false;
  $("shuffleArea").hidden = true;
  $("summary").hidden = true;
  const title = $("resultTitle");
  title.hidden = false;
  title.textContent = `การทำนายของ ${r.name}`;
  const spread = $("spread");
  spread.innerHTML = "";
  const items = r.cards.map(cardBlock);
  items.forEach((i) => spread.append(i.block));
  $("stage").scrollIntoView({ behavior: "smooth" });
  for (const i of items) {
    if (animate) await sleep(reduceMotion() ? 100 : 700);
    i.flip.classList.add("open");
  }
  if (r.summary) {
    $("summary").replaceChildren(el("strong", { textContent: "สรุปคำทำนาย" }), el("p", { textContent: r.summary }));
    $("summary").hidden = false;
  }
}

// ---------- เลือกไพ่เอง (แกลเลอรีวงกลม) ----------
const POSITIONS = ["อดีต", "ปัจจุบัน", "อนาคต"];
let run = 0;          // กันงานเก่าที่ค้างอยู่เมื่อกดเริ่มใหม่
let gallery = null;
let picks = [];       // ตำแหน่งไพ่ (0-77) ที่ผู้ใช้เลือกตามลำดับ
let pending = null;   // ข้อมูลฟอร์มที่รอส่ง

function closeGallery() {
  if (gallery) { gallery.destroy(); gallery = null; }
}

function renderPicks() {
  const slots = $("slots");
  slots.innerHTML = "";
  POSITIONS.forEach((pos, i) => {
    const filled = i < picks.length;
    const b = el("button", {
      type: "button",
      className: "slot" + (filled ? " filled" : ""),
      disabled: !filled,
      title: filled ? "กดเพื่อยกเลิกใบนี้" : "",
      textContent: filled ? `${pos} ✓` : pos
    });
    if (filled) b.onclick = () => { picks.splice(i, 1); renderPicks(); };
    slots.append(b);
  });
  $("resetPicks").hidden = picks.length === 0;
  $("pickHint").textContent = picks.length < 3
    ? `เลือกไพ่ใบที่ ${picks.length + 1} สำหรับ “${POSITIONS[picks.length]}” (ลากหรือเลื่อนแล้วคลิกที่ไพ่)`
    : "ได้ไพ่ครบ 3 ใบแล้ว กำลังเปิดไพ่...";
  gallery?.setPicked(new Set(picks));
}

async function startPicking(myRun) {
  picks = [];
  $("pickArea").hidden = false;
  closeGallery();
  gallery = createCircularGallery($("gallery"), {
    count: 78, bend: 3, borderRadius: 0.05, scrollEase: 0.05,
    onPick: (idx) => {
      if (picks.length >= 3 || picks.includes(idx)) return;
      picks.push(idx);
      renderPicks();
      if (picks.length === 3) finishReading(myRun);
    }
  });
  renderPicks();
}

async function finishReading(myRun) {
  await sleep(700); // ให้เห็นไพ่ใบสุดท้ายจางลงก่อน
  if (myRun !== run) return;
  try {
    const reading = await api("/api/readings", { method: "POST", body: JSON.stringify({ ...pending, picks }) });
    if (myRun !== run) return;
    closeGallery();
    $("pickArea").hidden = true;
    await showResult(reading, true);
    loadHistory();
  } catch (err) {
    $("error").textContent = err.message;
    picks = [];
    renderPicks();
  }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  const name = $("name").value.trim();
  const birthDate = $("birthDate").value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!name) { $("error").textContent = "กรุณากรอกชื่อ"; return; }
  if (!m) { $("error").textContent = "กรุณาเลือกวันเกิด"; return; }

  skipGuard = true; location.hash = "#/play";
  const myRun = ++run;
  closeGallery();
  pending = { name, birthDate, category: $("category").value };
  const day = Number(m[3]);

  $("drawBtn").disabled = true;
  $("stage").hidden = false;
  $("shuffleArea").hidden = false;
  $("pickArea").hidden = true;
  $("resultTitle").hidden = true;
  $("summary").hidden = true;
  $("spread").innerHTML = "";
  $("stage").scrollIntoView({ behavior: "smooth" });

  const ok = await animateShuffle(day, () => myRun === run);
  if (!ok) return;
  $("drawBtn").disabled = false;
  $("shuffleText").textContent = "สับไพ่เสร็จแล้ว";
  await startPicking(myRun);
});

$("resetPicks").addEventListener("click", () => { picks = []; renderPicks(); });
$("galleryPrev").addEventListener("click", () => gallery?.prev());
$("galleryNext").addEventListener("click", () => gallery?.next());

$("filter").addEventListener("change", loadHistory);
loadHistory();

// ---------- หน้าต่าง ๆ (hash router) + ปุ่มกลับหน้าแรก ----------
let skipGuard = false;
function route() {
  let v = (location.hash.replace("#/", "") || "home");
  if (!["home", "play", "cards"].includes(v)) v = "home";
  if (v === "play" && !skipGuard && $("stage").hidden) { location.hash = "#/"; return; }
  skipGuard = false;
  if (v !== "play") { run++; closeGallery(); $("drawBtn").disabled = false; }  // ออกจากหน้าดูดวง = ยกเลิกงานค้าง
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== (v === "cards" ? "library" : v)));
  $("historySec").hidden = v === "cards";
  if (v === "cards") loadLibrary();
  window.scrollTo({ top: 0 });
}
addEventListener("hashchange", route);

$("chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  $("category").value = b.dataset.v;
  document.querySelectorAll("#chips .chip").forEach((c) => c.classList.toggle("on", c === b));
});

// ---------- ดาวพื้นหลัง ----------
for (let i = 0; i < 80; i++) {
  const s = el("i"), z = Math.random() * 2 + 1;
  s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${z}px;height:${z}px;--d:${2 + Math.random() * 4}s;animation-delay:-${Math.random() * 5}s`;
  $("stars").append(s);
}

// ---------- หน้าไพ่ทั้ง 78 ใบ ----------
const SUITS = { all: "ทั้งหมด", major: "Major Arcana", cups: "ถ้วย (Cups)", wands: "ไม้เท้า (Wands)", swords: "ดาบ (Swords)", pentacles: "เหรียญ (Pentacles)" };
let allCards = null, suit = "all";

function renderLibrary() {
  const q = $("search").value.trim().toLowerCase();
  const list = allCards.filter((c) => (suit === "all" || c.suit === suit) &&
    (!q || [c.th, c.name, c.up, c.rev, ...c.kw].join(" ").toLowerCase().includes(q)));
  $("cardGrid").replaceChildren(...list.map((c) => {
    const b = el("button", { className: "gcard", type: "button", onclick: () => openCard(c) },
      el("img", { src: c.image, alt: c.name, loading: "lazy" }), el("b", { textContent: c.th }), el("span", { textContent: c.name }));
    return b;
  }));
  if (!list.length) $("cardGrid").append(el("p", { className: "empty", textContent: "ไม่พบไพ่ที่ค้นหา" }));
  document.querySelectorAll("#suitChips .chip").forEach((c) => c.classList.toggle("on", c.dataset.v === suit));
}

async function loadLibrary() {
  if (!allCards) {
    $("suitChips").replaceChildren(...Object.entries(SUITS).map(([v, t]) =>
      el("button", { className: "chip", type: "button", textContent: t, onclick: () => { suit = v; renderLibrary(); } }, )));
    $("suitChips").querySelectorAll(".chip").forEach((b, i) => (b.dataset.v = Object.keys(SUITS)[i]));
    allCards = await api("/api/cards");
    $("search").addEventListener("input", renderLibrary);
  }
  renderLibrary();
}

function openCard(c) {
  const m = $("modal");
  m.replaceChildren(el("div", { className: "mbox" },
    el("button", { className: "close", textContent: "✕", ariaLabel: "ปิด", onclick: () => (m.hidden = true) }),
    el("img", { src: c.image, alt: c.name }),
    el("div", {},
      el("p", { className: "eyebrow", textContent: c.suit === "major" ? "MAJOR ARCANA" : `MINOR ARCANA · ${c.domain}` }),
      el("h2", { textContent: c.th }), el("p", { className: "sub", textContent: c.name }),
      el("div", { className: "mean up" }, el("b", { textContent: "ไพ่ตรง · ความหมายเชิงบวก" }), el("p", { textContent: c.up })),
      el("div", { className: "mean rv" }, el("b", { textContent: "ไพ่กลับหัว · ความหมายเชิงเตือน" }), el("p", { textContent: c.rev })),
      el("div", { className: "kws" }, ...c.kw.map((k) => el("span", { textContent: k }))))));
  m.hidden = false;
}
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("modal").hidden = true; });
addEventListener("keydown", (e) => { if (e.key === "Escape") $("modal").hidden = true; });

route();
