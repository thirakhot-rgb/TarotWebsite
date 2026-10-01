const express = require("express");
const fs = require("fs");
const path = require("path");
const { CARDS } = require("./cards");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "data.json");
const CATEGORIES = ["general", "love", "career", "money"];
const POSITIONS = ["อดีต", "ปัจจุบัน", "อนาคต"];

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
// เปิดไฟล์ ES module ของ ogl ให้เบราว์เซอร์ import ได้ (ใช้กับแกลเลอรีเลือกไพ่)
app.use("/vendor/ogl", express.static(path.join(__dirname, "..", "node_modules", "ogl", "src")));

// ---------- ที่เก็บข้อมูลแบบไฟล์ JSON ----------
const load = () => {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return []; }
};
const enrich = (r) => ({
  ...r,
  cards: r.cards.map((c) => {
    if (c.image) return c;
    const b = CARDS.find((x) => x.name === c.name);
    return b ? { ...c, id: b.id, image: `/cards/${b.id}.jpg`, keywords: b.kw, suit: b.suit, domain: b.domain } : c;
  })
});
const save = (list) => fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2));

// ---------- ฟังก์ชันช่วย ----------
function parseBirthDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

// สับไพ่ทั้งสำรับ 1 รอบ (Fisher-Yates)
function shuffleOnce(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

// สับไพ่ตามจำนวนครั้ง = วันที่เกิด แล้วได้ไพ่ 3 ใบ (ทั้งสำรับ 78 ใบ, มีโอกาสกลับหัว 35%)
// picks = ตำแหน่ง (0-77) ที่ผู้ใช้เลือกจากสำรับที่สับแล้ว ถ้าไม่ส่งมาจะใช้ 3 ใบบนสุด
function drawReading(shuffleCount, picks) {
  const deck = CARDS.map((_, i) => i);
  for (let n = 0; n < shuffleCount; n++) shuffleOnce(deck);
  const positions = picks || [0, 1, 2];
  return positions.map((pos, i) => {
    const c = CARDS[deck[pos]];
    const reversed = Math.random() < 0.35;
    return {
      position: POSITIONS[i], id: c.id, name: c.name, th: c.th,
      suit: c.suit, domain: c.domain, reversed,
      meaning: reversed ? c.rev : c.up,
      keywords: c.kw, image: `/cards/${c.id}.jpg`
    };
  });
}

// picks ต้องเป็นเลขจำนวนเต็ม 3 ตัวที่ไม่ซ้ำกัน อยู่ในช่วง 0 ถึง (จำนวนไพ่ - 1)
function validPicks(p) {
  return Array.isArray(p) && p.length === 3 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n < CARDS.length) &&
    new Set(p).size === 3;
}

const CAT_TH = { general: "ภาพรวม", love: "ความรัก", career: "การงาน", money: "การเงิน" };
function makeSummary(name, category, cards) {
  const kw = (c) => (c.reversed ? `${c.keywords[0]}ที่ต้องระวัง` : c.keywords[0]);
  const flipped = cards.filter((c) => c.reversed).length;
  const tail = [
    "ภาพรวมค่อนข้างราบรื่น จงเชื่อมั่นในตัวเองและก้าวต่อไปด้วยความมั่นใจ",
    "มีบางจุดที่ต้องระวังและปรับตัว แต่แก้ไขได้ถ้าตั้งสติและวางแผนดี ๆ",
    "ช่วงนี้ควรชะลอ ทบทวน และเตรียมใจ แล้วค่อยเดินหน้าอย่างรอบคอบ",
    "ช่วงนี้ควรชะลอ ทบทวน และเตรียมใจ แล้วค่อยเดินหน้าอย่างรอบคอบ"
  ][flipped];
  return `ในเรื่อง${CAT_TH[category]} อดีตของ ${name} สะท้อนเรื่อง${kw(cards[0])} ` +
    `ปัจจุบันอยู่ในช่วงของเรื่อง${kw(cards[1])} และกำลังนำไปสู่เรื่อง${kw(cards[2])} — ${tail}`;
}

function validateText(v, max) {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
}

// GET /api/cards  -> ไพ่ทั้ง 78 ใบ พร้อมความหมายตรง/กลับหัว (ใช้ในหน้า "ไพ่ทั้งหมด")
app.get("/api/cards", (req, res) => res.json(CARDS.map((c) => ({ ...c, image: `/cards/${c.id}.jpg` }))));

// ---------- REST API: /api/readings ----------

// GET /api/readings?category=love&name=สม  (กรองด้วย query string)
app.get("/api/readings", (req, res) => {
  let list = load().map(enrich);
  const { category, name } = req.query;
  if (category) list = list.filter((r) => r.category === category);
  if (name) list = list.filter((r) => r.name.toLowerCase().includes(String(name).toLowerCase()));
  res.json(list);
});

// GET /api/readings/:id
app.get("/api/readings/:id", (req, res) => {
  const item = load().find((r) => r.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "ไม่พบผลการดูดวงนี้" });
  res.json(enrich(item));
});

// POST /api/readings  -> 400 ถ้าข้อมูลไม่ครบ, 201 เมื่อสำเร็จ
app.post("/api/readings", (req, res) => {
  const { name, birthDate, category = "general", note = "", picks } = req.body || {};
  const errors = [];
  if (!validateText(name, 50)) errors.push("name: ต้องระบุชื่อ (ไม่เกิน 50 ตัวอักษร)");
  const bd = parseBirthDate(birthDate);
  if (!bd) errors.push("birthDate: ต้องเป็นวันที่จริงในรูปแบบ YYYY-MM-DD");
  if (!CATEGORIES.includes(category)) errors.push(`category: ต้องเป็นหนึ่งใน ${CATEGORIES.join(", ")}`);
  if (typeof note !== "string" || note.length > 300) errors.push("note: ต้องเป็นข้อความไม่เกิน 300 ตัวอักษร");
  if (picks !== undefined && !validPicks(picks)) errors.push(`picks: ต้องเป็นตำแหน่งไพ่ 3 ใบที่ไม่ซ้ำกัน (0-${CARDS.length - 1})`);
  if (errors.length) return res.status(400).json({ error: "ข้อมูลไม่ถูกต้อง", details: errors });

  const list = load();
  const cards = drawReading(bd.d, picks);
  const reading = {
    id: list.reduce((m, r) => Math.max(m, r.id), 0) + 1,
    name: name.trim(),
    birthDate,
    category,
    note: note.trim(),
    shuffleCount: bd.d,               // เกิดวันที่ 4 = สับ 4 ครั้ง (เก็บไว้ที่ API แต่ไม่แสดงให้ผู้ใช้เห็น)
    cards,
    summary: makeSummary(name.trim(), category, cards),
    createdAt: new Date().toISOString()
  };
  list.push(reading);
  save(list);
  res.status(201).json(reading);
});

// PATCH /api/readings/:id  -> แก้ name / category / note
app.patch("/api/readings/:id", (req, res) => {
  const list = load();
  const item = list.find((r) => r.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "ไม่พบผลการดูดวงนี้" });

  const { name, category, note } = req.body || {};
  if (name !== undefined) {
    if (!validateText(name, 50)) return res.status(400).json({ error: "name ไม่ถูกต้อง" });
    item.name = name.trim();
  }
  if (category !== undefined) {
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "category ไม่ถูกต้อง" });
    item.category = category;
  }
  if (note !== undefined) {
    if (typeof note !== "string" || note.length > 300) return res.status(400).json({ error: "note ไม่ถูกต้อง" });
    item.note = note.trim();
  }
  save(list);
  res.json(item);
});

// DELETE /api/readings/:id  -> 204
app.delete("/api/readings/:id", (req, res) => {
  const list = load();
  const idx = list.findIndex((r) => r.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "ไม่พบผลการดูดวงนี้" });
  list.splice(idx, 1);
  save(list);
  res.status(204).end();
});

app.listen(PORT, () => console.log(`Tarot API running at http://localhost:${PORT}`));
