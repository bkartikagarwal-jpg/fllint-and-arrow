// server.js - Flint & Arrow website backend
// Serves the website pages, saves every form submission to messages.json,
// and emails each new message to you through Brevo.
//
// Environment variables (set them on Render under Environment):
//   ADMIN_KEY         a long secret word. Needed to open /admin/messages?key=YOUR_KEY
//   BREVO_SMTP_USER   SMTP login from Brevo (SMTP & API page)
//   BREVO_SMTP_KEY    SMTP key from Brevo
//   NOTIFY_EMAIL      where new messages are sent (flintarrow.web@gmail.com)
//   DATA_DIR          optional folder for messages.json (default: next to server.js)
//   PORT              set automatically by Render
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const FILE = path.join(DATA_DIR, 'messages.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// ---- Email notifications (Brevo SMTP) --------------------------------------
const EMAIL_ENABLED = !!(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_KEY && process.env.NOTIFY_EMAIL);
const transporter = EMAIL_ENABLED
  ? nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_SMTP_KEY
      }
    })
  : null;
if (!EMAIL_ENABLED) console.log('Email notifications are OFF (set BREVO_SMTP_USER, BREVO_SMTP_KEY and NOTIFY_EMAIL).');

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

// Sends the new message to your inbox. Never throws: if the email fails,
// the message is still safely saved in messages.json.
function notifyByEmail(entry) {
  if (!EMAIL_ENABLED) return;
  const subjectName = entry.name.replace(/[\r\n]+/g, ' ');
  transporter.sendMail({
    from: '"Flint & Arrow Website" <bkartikagarwal@gmail.com>', // must be your verified Brevo sender
    to: process.env.NOTIFY_EMAIL,
    replyTo: entry.email,
    subject: 'New enquiry from ' + subjectName,
    text:
      'Name: ' + entry.name + '\n' +
      'Email: ' + entry.email + '\n' +
      'Phone: ' + (entry.phone || '-') + '\n' +
      'Needs: ' + (entry.service || '-') + '\n' +
      'Call date: ' + (entry.preferred_date || '-') + '\n\n' +
      entry.message
  }).catch(err => console.error('Email failed:', err.message));
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
    phone: