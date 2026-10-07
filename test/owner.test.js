'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'je-owner-'));
process.env.DB_PATH = path.join(tmp, 'test.sqlite');

const { db } = require('../src/db');
const { verifyPassword } = require('../src/security');
const { ensureOwnerFromEnv } = require('../src/owner');

test.after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const owner = () => db.prepare('SELECT username, email, password_hash FROM users').all();

test('no ADMIN_PASSWORD means no login is created', async () => {
  assert.equal(await ensureOwnerFromEnv({ ADMIN_USERNAME: 'jackie' }), null);
  assert.equal(owner().length, 0);
});

test('a new server creates the owner login from ADMIN_USERNAME / ADMIN_PASSWORD', async () => {
  assert.equal(await ensureOwnerFromEnv({ ADMIN_USERNAME: 'Jackie', ADMIN_PASSWORD: 'first-password-1' }), 'jackie');
  const [user] = owner();
  assert.equal(user.username, 'jackie');
  assert.ok(await verifyPassword('first-password-1', user.password_hash));
});

test('an existing login is never overwritten, even if ADMIN_PASSWORD changes', async () => {
  assert.equal(await ensureOwnerFromEnv({ ADMIN_USERNAME: 'jackie', ADMIN_PASSWORD: 'another-password-2' }), null);
  const users = owner();
  assert.equal(users.length, 1);
  assert.ok(await verifyPassword('first-password-1', users[0].password_hash));
});
