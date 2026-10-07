'use strict';
// Packages, clients, orders and membership periods.
const crypto = require('node:crypto');
const { db, tx, now } = require('../db');

const DAY_MS = 86400000;
const DUE_SOON_DAYS = 7;

// How a client stands with their payments. Every page in the dashboard uses these.
const PAYMENT_STATUS = {
  current: { label: 'Up to date', cls: 'good', help: 'Paid, and not due again for more than a week.' },
  due: { label: 'Due soon', cls: 'warn', help: `Paid period ends within ${DUE_SOON_DAYS} days.` },
  overdue: { label: 'Overdue', cls: 'bad', help: 'Monthly package has ended and the next month is not paid.' },
  unpaid: { label: 'Not paid yet', cls: 'bad', help: 'Signed up or added, but has never paid.' },
  finished: { label: 'Program finished', cls: 'neutral', help: 'A once-off program that has run its course.' },
};

function paymentStatus(paidUntil, billing, nowMs = Date.now()) {
  if (!paidUntil) return 'unpaid';
  const end = new Date(paidUntil).getTime();
  if (end > nowMs + DUE_SOON_DAYS * DAY_MS) return 'current';
  if (end > nowMs) return 'due';
  return billing === 'once' ? 'finished' : 'overdue';
}

// ------------------------------------------------------------------ dates

function addPeriod(date, count, unit) {
  const d = new Date(date);
  if (unit === 'week') {
    d.setUTCDate(d.getUTCDate() + 7 * count);
    return d;
  }
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + count);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

// ------------------------------------------------------------------ packages

function hydratePackage(row) {
  if (!row) return null;
  let features = [];
  try {
    features = JSON.parse(row.features);
  } catch {
    features = [];
  }
  const plural = row.period_count === 1 ? row.period_unit : `${row.period_unit}s`;
  return {
    ...row,
    features,
    fullName: row.name,
    billingLabel: row.billing === 'monthly' ? '/ month' : `once-off · ${row.period_count} ${plural}`,
    periodLabel: `${row.period_count} ${plural}`,
  };
}

function listPackages({ includeInactive = false } = {}) {
  return db
    .prepare(`SELECT * FROM packages ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort_order, price_cents`)
    .all()
    .map(hydratePackage);
}

function getPackageBySlug(slug, { includeInactive = false } = {}) {
  const pkg = hydratePackage(db.prepare('SELECT * FROM packages WHERE slug = ?').get(String(slug)));
  return pkg && (includeInactive || pkg.active) ? pkg : null;
}

function getPackageById(id) {
  return hydratePackage(db.prepare('SELECT * FROM packages WHERE id = ?').get(Number(id) || 0));
}

// ------------------------------------------------------------------ clients

/**
 * Find a client by email or create one. Details typed at checkout only fill in blanks on an
 * existing record, so nobody can overwrite another client's details by using their email.
 */
function upsertClient(details, source) {
  const existing = db.prepare('SELECT * FROM clients WHERE email = ?').get(details.email);
  if (existing) {
    db.prepare(
      `UPDATE clients SET
         phone = COALESCE(NULLIF(phone, ''), ?), goal = COALESCE(NULLIF(goal, ''), ?),
         guardian_name = COALESCE(NULLIF(guardian_name, ''), ?), guardian_phone = COALESCE(NULLIF(guardian_phone, ''), ?),
         consent_at = COALESCE(consent_at, ?), archived = 0, updated_at = ?
       WHERE id = ?`
    ).run(
      details.phone || null, details.goal || null, details.guardian_name || null, details.guardian_phone || null,
      details.consent ? now() : null, now(), existing.id
    );
    return existing.id;
  }
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO clients (first_name, last_name, email, phone, goal, guardian_name, guardian_phone, source, consent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      details.first_name, details.last_name, details.email, details.phone || null, details.goal || null,
      details.guardian_name || null, details.guardian_phone || null, source, details.consent ? now() : null, now(), now()
    );
  return Number(lastInsertRowid);
}

function getClient(id) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(id) || 0) || null;
}

// Each client with the package they last paid for, how long it covers, and any payment still outstanding.
const ROSTER_SQL = `
  SELECT c.*,
    lp.package_name AS paid_package, lp.package_id AS paid_package_id, lp.period_end AS paid_until,
    lp.paid_at AS last_paid_at, lp.amount_cents AS last_amount_cents, pk.billing AS paid_billing,
    pend.package_name AS pending_package, pend.package_id AS pending_package_id, pend.amount_cents AS pending_amount_cents,
    pend.pay_token AS pending_token, pend.created_at AS pending_created_at,
    (SELECT COUNT(*) FROM orders o WHERE o.client_id = c.id AND o.status = 'paid') AS paid_count,
    (SELECT COALESCE(SUM(amount_cents), 0) FROM orders o WHERE o.client_id = c.id AND o.status = 'paid') AS total_paid_cents
  FROM clients c
  LEFT JOIN orders lp ON lp.id = (
    SELECT id FROM orders o WHERE o.client_id = c.id AND o.status = 'paid' ORDER BY o.period_end DESC LIMIT 1)
  LEFT JOIN packages pk ON pk.id = lp.package_id
  LEFT JOIN orders pend ON pend.id = (
    SELECT id FROM orders o WHERE o.client_id = c.id AND o.status = 'pending' ORDER BY o.created_at DESC LIMIT 1)
  %WHERE%
  ORDER BY c.first_name COLLATE NOCASE, c.last_name COLLATE NOCASE`;

function withPaymentStatus(row) {
  const key = paymentStatus(row.paid_until, row.paid_billing);
  const meta = PAYMENT_STATUS[key];
  const label = key === 'due' && row.paid_billing === 'once' ? 'Ending soon' : meta.label;
  const daysLeft = row.paid_until ? Math.ceil((new Date(row.paid_until).getTime() - Date.now()) / DAY_MS) : null;
  return { ...row, name: `${row.first_name} ${row.last_name}`, status: key, statusLabel: label, statusClass: meta.cls, daysLeft };
}

/** Every client (or one) with their payment status. */
function clientRoster({ clientId = null } = {}) {
  const sql = ROSTER_SQL.replace('%WHERE%', clientId ? 'WHERE c.id = ?' : '');
  return db.prepare(sql).all(...(clientId ? [clientId] : [])).map(withPaymentStatus);
}

function clientStatus(clientId) {
  return clientRoster({ clientId })[0] || null;
}

// ------------------------------------------------------------------ orders

function newReference() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `JE${date}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function insertOrder({ clientId, pkg, createdBy, amountCents, note }) {
  const reference = newReference();
  db.prepare(
    `INSERT INTO orders (reference, pay_token, client_id, package_id, category, package_name, amount_cents, period_count, period_unit,
       status, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(
    reference, crypto.randomBytes(24).toString('base64url'), clientId, pkg.id, pkg.category, pkg.fullName,
    amountCents ?? pkg.price_cents, pkg.period_count, pkg.period_unit, note || null, createdBy, now()
  );
  return db.prepare('SELECT * FROM orders WHERE reference = ?').get(reference);
}

/** Create a pending order (or reuse a recent unpaid one for the same package and price). */
function createOrder({ clientId, pkg, createdBy = 'client', amountCents = null, note = null }) {
  return tx(() => {
    const amount = amountCents ?? pkg.price_cents;
    const existing = db
      .prepare(
        `SELECT * FROM orders WHERE client_id = ? AND package_id = ? AND status = 'pending' AND amount_cents = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(clientId, pkg.id, amount, new Date(Date.now() - 3 * 86400000).toISOString());
    if (existing) return existing;
    return insertOrder({ clientId, pkg, createdBy, amountCents: amount, note });
  });
}

/**
 * Mark an order paid and work out the period it covers. A new period starts when the client's current
 * period in the same category ends, so paying early never loses days.
 * Returns false if it was already paid (PayFast can send the same notification more than once).
 */
function markOrderPaid(orderId, { method, pfPaymentId = null }) {
  return tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || order.status === 'paid') return false;
    const { latest } = db
      .prepare(`SELECT MAX(period_end) AS latest FROM orders WHERE client_id = ? AND category = ? AND status = 'paid'`)
      .get(order.client_id, order.category);
    const start = latest && new Date(latest) > new Date() ? new Date(latest) : new Date();
    const end = addPeriod(start, order.period_count, order.period_unit);
    db.prepare(
      `UPDATE orders SET status = 'paid', method = ?, pf_payment_id = ?, paid_at = ?, period_start = ?, period_end = ? WHERE id = ?`
    ).run(method, pfPaymentId, now(), start.toISOString(), end.toISOString(), order.id);
    return true;
  });
}

/** Record a payment received outside PayFast (EFT, cash, card machine). */
function recordManualPayment({ clientId, pkg, method, amountCents, note }) {
  const order = insertOrder({ clientId, pkg, createdBy: 'coach', amountCents, note });
  markOrderPaid(order.id, { method });
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
}

function setOrderStatus(orderId, status) {
  return db.prepare(`UPDATE orders SET status = ? WHERE id = ? AND status = 'pending'`).run(status, orderId).changes > 0;
}

function getOrderByReference(reference) {
  return db.prepare('SELECT * FROM orders WHERE reference = ?').get(String(reference || '')) || null;
}

function getOrderByToken(token) {
  const t = String(token || '');
  if (t.length < 20 || t.length > 64) return null;
  return db.prepare('SELECT * FROM orders WHERE pay_token = ?').get(t) || null;
}

module.exports = {
  PAYMENT_STATUS,
  DUE_SOON_DAYS,
  paymentStatus,
  clientRoster,
  addPeriod,
  hydratePackage,
  listPackages,
  getPackageBySlug,
  getPackageById,
  upsertClient,
  getClient,
  clientStatus,
  createOrder,
  markOrderPaid,
  recordManualPayment,
  setOrderStatus,
  getOrderByReference,
  getOrderByToken,
};
