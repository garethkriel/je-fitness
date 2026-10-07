'use strict';
// Owner sign-in. Clients don't have accounts on this site; they check out as guests.
const express = require('express');
const { db, now, audit } = require('../db');
const limits = require('../limits');
const { verifyPassword, burnPasswordCheck, passwordProblem } = require('../security');
const { safeNext } = require('../middleware');

const router = express.Router();

const SESSION_MS = 4 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

const regenerate = (req) => new Promise((ok, fail) => req.session.regenerate((e) => (e ? fail(e) : ok())));
const saveSession = (req) => new Promise((ok, fail) => req.session.save((e) => (e ? fail(e) : ok())));

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/admin');
  res.render('auth/login', { title: 'Owner sign in', returnTo: safeNext(req.query.next, ''), username: '', error: null, noindex: true });
});

router.post('/login', limits.login, async (req, res) => {
  // Owners can sign in with their username or their email address.
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 254);
  const password = String(req.body.password || '').slice(0, 200);
  const returnTo = safeNext(req.body.returnTo, '');
  const locked = 'Too many failed attempts. This account is locked for 15 minutes.';

  const fail = (error = 'Incorrect email or password.') => {
    audit(req, 'login_failed', username);
    res.status(401).render('auth/login', { title: 'Owner sign in', returnTo, username, error, noindex: true });
  };

  const user = username
    ? db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ?').get(username, username)
    : null;
  if (!user || !password) {
    await burnPasswordCheck(password || 'empty');
    return fail();
  }
  if (user.locked_until && user.locked_until > Date.now()) return fail(locked);
  if (!(await verifyPassword(password, user.password_hash))) {
    const failed = user.failed_logins + 1;
    const lockedUntil = failed >= MAX_FAILED_LOGINS ? Date.now() + LOCK_MS : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lockedUntil ? 0 : failed, lockedUntil, user.id);
    return fail(lockedUntil ? locked : undefined);
  }

  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now(), user.id);
  // A fresh session id on sign-in prevents session fixation.
  await regenerate(req);
  req.session.userId = user.id;
  req.session.cookie.maxAge = SESSION_MS;
  // Remind the owner to choose a stronger password until they do.
  req.session.weakPassword = Boolean(passwordProblem(password, { email: user.email, firstName: user.name }));
  req.user = user;
  await saveSession(req);
  audit(req, 'login', user.username || user.email);
  res.redirect(returnTo.startsWith('/admin') ? returnTo : '/admin');
});

router.post('/logout', (req, res, next) => {
  if (req.user) audit(req, 'logout', req.user.email);
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(req.app.get('sessionCookieName'), { path: '/' });
    res.redirect('/');
  });
});

module.exports = router;
