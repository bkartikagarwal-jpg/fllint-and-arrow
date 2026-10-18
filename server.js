// server.js - Flint & Arrow website backend
// Serves the website pages and saves every form submission to messages.json.
//
// Environment variables (set them on Render under Environment):
//   ADMIN_KEY  a long secret word. Needed to open /admin/messages?key=YOUR_KEY
//   DATA_DIR   optional folder for messages.json (default: next to server.js)
//   PORT       set automatically by Render
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const FILE = path.join(DATA_DIR, 'messages.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

app.set('trust proxy', 1); // Render puts a proxy in front of the app
app.disable('x-powered-by');
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));

// ---- Website pages ---------------------------------------------------------
// Only these files are public. server.js, package.json and messages.json are NOT.
// To add a new page, add one line here.
const PAGES = {
  '/': 'index.html',
  '/index.html': 'index.html'
};
app.get(Object.keys(PAGES), (req, res, next) => {
  const file = PAGES[req.path.toLowerCase()];
  if (!file) return next();
  res.sendFile(path.join(__dirname, file));
});

// ---- Helpers ---------------------------------------------------------------
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clean = (v, max) =>
  String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function page(title, bodyHtml) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(title) + '</title>' +
    '<style>body{font:16px/1.6 system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 18px;color:#2a211b;background:#f6efe4}' +
    'a{color:#b5573a}table{border-collapse:collapse;width:100%;background:#fffaf1}' +
    'th,td{border:1px solid #e3d6c2;padding:8px 10px;text-align:left;vertical-align:top;font-size:.92rem}' +
    'th{background:#efe3d0}</style></head><body><h1>' + esc(title) + '</h1>' + bodyHtml + '</body></html>';
}

// ---- Storage (messages.json) ----------------------------------------------
let messages = [];
try {
  messages = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!Array.isArray(messages)) messages = [];
} catch (e) { messages = []; }

let writing = Promise.resolve();
function save() {
  const data = JSON.stringify(messages, null, 2);
  const job = writing.then(() => fs.promises.writeFile(FILE, data));
  writing = job.catch(() => {}); // keep the queue alive if one write fails
  return job;
}

// ---- Simple spam guard: 5 messages per 10 minutes per visitor ---------------
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) {
    if (!list.some(t => now - t < 10 * 60 * 1000)) hits.delete(ip);
  }
}, 10 * 60 * 1000).unref();

// ---- Form submission -------------------------------------------------------
// Saves the booking form on the portfolio (name, email, phone, service, date, message).
app.post('/submit-form', async (req, res) => {
  const wantsHtml = req.accepts(['json', 'html']) === 'html';
  const reply = (status, ok, text) => wantsHtml
    ? res.status(status).send(page(ok ? 'Thank you!' : 'Something went wrong',
        '<p>' + esc(text) + '</p><p><a href="/">Back to the website</a></p>'))
    : res.status(status).json(ok ? { ok: true } : { ok: false, error: text });

  const b = req.body || {};
  if (clean(b['bot-field'], 50)) return reply(200, true, 'Your message has been received.'); // hidden field filled: a bot
  if (tooMany(req.ip)) return reply(429, false, 'Too many messages. Please try again in a few minutes.');

  const entry = {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    name: clean(b.name, 100),
    email: clean(b.email, 200),
    phone: clean(b.phone, 40),
    service: clean(b.service, 60),
    preferred_date: clean(b.preferred_date, 20),
    message: clean(b.message, 5000)
  };
  if (!entry.name || !entry.message) return reply(400, false, 'Please enter your name and a message.');
  if (!EMAIL.test(entry.email)) return reply(400, false, 'Please enter a valid email address.');

  messages.push(entry);
  try {
    await save();
  } catch (err) {
    console.error('Could not save message:', err.message);
    messages = messages.filter(m => m !== entry);
    return reply(500, false, 'Could not save your message. Please email me instead.');
  }
  reply(200, true, 'Your message has been received.');
});

// ---- Private page for you to read the messages ------------------------------
function isAdmin(req) {
  if (!ADMIN_KEY) return false; // page is switched off until you set ADMIN_KEY
  const given = String(req.query.key || req.get('x-admin-key') || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ADMIN_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

app.get('/admin/messages', (req, res) => {
  if (!isAdmin(req)) return res.status(404).send('Not found');
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  const list = messages.slice().reverse(); // newest first
  if (req.query.format === 'json') return res.json(list);
  const rows = list.map(m =>
    '<tr><td>' + esc(new Date(m.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })) + '</td>' +
    '<td>' + esc(m.name) + '</td>' +
    '<td><a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a></td>' +
    '<td>' + esc(m.phone || '') + '</td>' +
    '<td>' + esc(m.service || '') + '</td>' +
    '<td>' + esc(m.preferred_date || '') + '</td>' +
    '<td style="white-space:pre-wrap">' + esc(m.message) + '</td></tr>').join('');
  res.send(page('Messages (' + list.length + ')',
    '<p>Newest first. Keep this link private. Add <code>&amp;format=json</code> to download the data.</p>' +
    '<div style="overflow-x:auto"><table><tr><th>Date (IST)</th><th>Name</th><th>Email</th><th>Phone</th>' +
    '<th>Needs</th><th>Call date</th><th>Message</th></tr>' + rows + '</table></div>'));
});

// ---- Everything else -------------------------------------------------------
app.use((req, res) =>
  res.status(404).send(page('Page not found', '<p><a href="/">Back to the website</a></p>')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 500).send('Something went wrong.');
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
