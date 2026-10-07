'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const KEY_LEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

// Used when an email address is unknown so the response time matches a real check.
let dummyHash;
async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword(crypto.randomBytes(12).toString('hex'));
  await verifyPassword(password, dummyHash);
  return false;
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'iloveyou123',
  'letmein123', 'welcome123', 'admin12345', 'football12', 'qwerty1234', 'abc1234567', 'passw0rd123',
  'fitness123', 'gymlife123', 'bloemfontein', 'southafrica',
]);

function passwordProblem(password, { email, firstName } = {}) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 128) return 'Use 128 characters or fewer.';
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common. Choose something harder to guess.';
  if (/^(.)\1+$/.test(password)) return 'Avoid repeating a single character.';
  if (email && lower.includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length >= 4) {
    return 'Your password should not contain your email address.';
  }
  if (firstName && firstName.length >= 3 && lower.includes(firstName.toLowerCase())) {
    return 'Your password should not contain your name.';
  }
  return null;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ---- CSRF (synchroniser token stored in the session) ----

function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = randomToken(32);
  return req.session.csrf;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowedOrigin = new URL(config.publicUrl).origin;

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Defence in depth: browsers send Origin on cross-site POSTs.
  const origin = req.get('origin');
  if (origin && origin !== allowedOrigin && origin !== `${req.protocol}://${req.get('host')}`) {
    return rejectCsrf(req, res);
  }

  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  const expected = req.session && req.session.csrf;
  if (!sent || !expected || !safeEqual(sent, expected)) return rejectCsrf(req, res);
  next();
}

function rejectCsrf(req, res) {
  res.status(403);
  if (req.accepts(['html', 'json']) === 'json') return res.json({ error: 'Invalid security token' });
  res.render('error', {
    title: 'Session expired',
    status: 403,
    message: 'Your session expired or the form was opened in another tab. Please go back, refresh the page and try again.',
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  passwordProblem,
  randomToken,
  sha256,
  safeEqual,
  csrfToken,
  csrfProtection,
};
