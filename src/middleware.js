'use strict';
const { db } = require('./db');
const site = require('./site');
const config = require('./config');
const iconPaths = require('./icon-paths');
const { csrfToken } = require('./security');
const { listPackages } = require('./services/billing');

const TZ = 'Africa/Johannesburg';
const dateFmt = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat('en-ZA', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
});
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const helpers = {
  money(cents) {
    const rands = (Number(cents) || 0) / 100;
    return 'R' + rands.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  },
  date(iso) {
    return iso ? dateFmt.format(new Date(iso)) : '-';
  },
  dateTime(iso) {
    return iso ? dateTimeFmt.format(new Date(iso)) : '-';
  },
  ago(iso) {
    if (!iso) return 'never';
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
    return dateFmt.format(new Date(iso));
  },
  icon(name, { size = 20, cls = '', label = '' } = {}) {
    const paths = iconPaths[name] || iconPaths.info;
    const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
    return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${paths}</svg>`;
  },
  lines(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  },
};

function loadUser(req, res, next) {
  req.user = null;
  const id = req.session && req.session.userId;
  if (id) {
    const user = db.prepare('SELECT id, username, email, name FROM users WHERE id = ?').get(id);
    if (user) req.user = user;
    else delete req.session.userId;
  }
  next();
}

function locals(req, res, next) {
  res.locals.site = site;
  res.locals.h = helpers;
  res.locals.user = req.user;
  res.locals.path = req.path;
  res.locals.sandbox = config.payfast.sandbox;
  res.locals.year = new Date().getFullYear();
  res.locals.csrf = () => csrfToken(req);
  res.locals.packageOptions = () => listPackages();
  res.locals.getFlashes = () => {
    const flashes = (req.session && req.session.flash) || [];
    if (req.session) delete req.session.flash;
    return flashes;
  };
  // Values and errors from a rejected enquiry form, shown once in the contact section.
  res.locals.getEnquiry = () => {
    const state = (req.session && req.session.enquiry) || { values: {}, errors: {} };
    if (req.session) delete req.session.enquiry;
    return state;
  };
  req.flash = (type, message) => {
    req.session.flash = [...(req.session.flash || []), { type, message }];
  };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    const target = req.method === 'GET' ? req.originalUrl : '/admin';
    return res.redirect(`/login?next=${encodeURIComponent(target)}`);
  }
  res.set('Cache-Control', 'no-store');
  next();
}

// Only allow redirects to local paths, never to another site.
function safeNext(value, fallback) {
  const v = String(value || '');
  return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : fallback;
}

module.exports = { helpers, loadUser, locals, requireAdmin, safeNext };
