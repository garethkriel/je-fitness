'use strict';
// Creates the owner (dashboard) login on a brand-new server from ADMIN_USERNAME / ADMIN_PASSWORD
// (and optionally ADMIN_EMAIL / ADMIN_NAME). Does nothing once any login exists, so it can never
// reset a password that was changed in the dashboard. `npm run create-admin` does the same by hand.

const { db, now } = require('./db');
const { hashPassword, passwordProblem } = require('./security');
const site = require('./site');

async function ensureOwnerFromEnv(env = process.env) {
  const password = env.ADMIN_PASSWORD || '';
  if (!password) return null;
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) return null;

  const username = (env.ADMIN_USERNAME || site.coach).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    throw new Error('ADMIN_USERNAME must be 3-30 letters, numbers, dots, dashes or underscores.');
  }
  const email = (env.ADMIN_EMAIL || site.email).trim().toLowerCase();
  const name = (env.ADMIN_NAME || site.coach).trim();

  db.prepare('INSERT INTO users (username, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)').run(
    username,
    email,
    await hashPassword(password),
    name,
    now()
  );
  console.log(`[setup] Created the owner login "${username}". You can now remove ADMIN_PASSWORD from the host's settings.`);
  const problem = passwordProblem(password, { email, firstName: name });
  if (problem) console.warn(`[setup] The owner password is weak (${problem}) The dashboard will remind ${name} to change it.`);
  return username;
}

module.exports = { ensureOwnerFromEnv };
