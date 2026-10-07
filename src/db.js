'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const defaultPackages = require('./packages.seed');

const dbDir = path.dirname(config.dbPath);
// On a host, the database must live on a persistent disk. If the disk isn't mounted, refuse to start rather than
// silently keeping clients and payments in a folder that is wiped on the next deploy.
if (config.dbRequireExistingDir && !fs.existsSync(dbDir)) {
  throw new Error(`Database folder ${dbDir} does not exist. Attach the persistent disk at ${dbDir} first.`);
}
fs.mkdirSync(dbDir, { recursive: true });
const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  -- Owner accounts (people who can sign in to the dashboard).
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    last_login_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT,
    goal TEXT,
    guardian_name TEXT,
    guardian_phone TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'checkout' CHECK (source IN ('checkout', 'coach', 'enquiry')),
    archived INTEGER NOT NULL DEFAULT 0,
    consent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL CHECK (category IN ('gym', 'online')),
    label TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    billing TEXT NOT NULL CHECK (billing IN ('monthly', 'once')),
    period_count INTEGER NOT NULL CHECK (period_count > 0),
    period_unit TEXT NOT NULL CHECK (period_unit IN ('week', 'month')),
    sessions_per_month INTEGER,
    price_note TEXT NOT NULL DEFAULT '',
    features TEXT NOT NULL DEFAULT '[]',
    badge TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'dumbbell',
    featured INTEGER NOT NULL DEFAULT 0,
    max_age INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    pay_token TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    package_id INTEGER NOT NULL REFERENCES packages(id),
    category TEXT NOT NULL,
    package_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    period_count INTEGER NOT NULL,
    period_unit TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'failed')),
    method TEXT,
    pf_payment_id TEXT,
    period_start TEXT,
    period_end TEXT,
    note TEXT,
    created_by TEXT NOT NULL DEFAULT 'client' CHECK (created_by IN ('client', 'coach')),
    created_at TEXT NOT NULL,
    paid_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id, status);

  CREATE TABLE IF NOT EXISTS payment_events (
    id INTEGER PRIMARY KEY,
    order_reference TEXT,
    pf_payment_id TEXT,
    payment_status TEXT,
    amount_gross TEXT,
    valid INTEGER NOT NULL,
    reason TEXT,
    ip TEXT,
    payload TEXT,
    received_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    interest TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
    client_id INTEGER REFERENCES clients(id),
    ip TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    user_id INTEGER,
    ip TEXT,
    action TEXT NOT NULL,
    detail TEXT
  );
`);

function now() {
  return new Date().toISOString();
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ------------------------------------------------------------------ upgrades for existing databases

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

// Owners sign in with a username (or their email).
if (!hasColumn('users', 'username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE)');

// In-person training is no longer offered: remove those packages, or hide any that already have payments.
db.exec(`
  DELETE FROM packages WHERE category = 'gym' AND id NOT IN (SELECT package_id FROM orders);
  UPDATE packages SET active = 0 WHERE category = 'gym';
`);

// Insert the default packages once. Later edits made in the dashboard are kept.
const insertPackage = db.prepare(`
  INSERT OR IGNORE INTO packages
    (slug, category, label, name, tagline, price_cents, billing, period_count, period_unit, sessions_per_month,
     price_note, features, badge, icon, featured, max_age, sort_order, active, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
`);
for (const [i, p] of defaultPackages.entries()) {
  insertPackage.run(
    p.slug, p.category, p.label, p.name, p.tagline, p.price * 100, p.billing, p.period[0], p.period[1],
    p.sessionsPerMonth ?? null, p.priceNote || '', JSON.stringify(p.features), p.badge || '', p.icon,
    p.featured ? 1 : 0, p.maxAge ?? null, i, now()
  );
}

function audit(req, action, detail) {
  db.prepare('INSERT INTO audit_log (at, user_id, ip, action, detail) VALUES (?, ?, ?, ?, ?)').run(
    now(),
    req?.user?.id ?? null,
    req?.ip ?? null,
    action,
    detail ? String(detail).slice(0, 500) : null
  );
}

module.exports = { db, tx, now, audit };
