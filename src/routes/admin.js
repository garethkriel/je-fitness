'use strict';
const express = require('express');
const config = require('../config');
const site = require('../site');
const { db, now, audit } = require('../db');
const { Validator } = require('../validate');
const { requireAdmin } = require('../middleware');
const billing = require('../services/billing');
const { hashPassword, verifyPassword, passwordProblem } = require('../security');

const router = express.Router();
router.use(requireAdmin);
router.use((req, res, next) => {
  res.locals.newEnquiryCount = db.prepare(`SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'`).get().n;
  res.locals.weakPassword = Boolean(req.session.weakPassword);
  next();
});

const METHODS = { payfast: 'PayFast', eft: 'EFT', cash: 'Cash', card: 'Card machine', other: 'Other' };
const MANUAL_METHODS = ['eft', 'cash', 'card', 'other'];

function idParam(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function notFound(res, what = 'Page') {
  res.status(404).render('error', { title: `${what} not found`, status: 404, message: `That ${what.toLowerCase()} does not exist.` });
}

function startOfMonthSast() {
  const sast = new Date(Date.now() + 2 * 3600 * 1000);
  return new Date(Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), 1) - 2 * 3600 * 1000).toISOString();
}

function payUrl(order) {
  return `${config.publicUrl}/pay/${order.pay_token}`;
}

function safeBack(req, fallback) {
  const back = String(req.body.back || '');
  return back.startsWith('/admin') && !back.startsWith('//') ? back : fallback;
}

// Spreadsheet-safe CSV (formula characters are neutralised so a cell can never run as a formula).
function toCsv(rows, columns) {
  const esc = (value) => {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columns.map(([h]) => esc(h)).join(','), ...rows.map((r) => columns.map(([, f]) => esc(f(r))).join(','))].join('\r\n');
}

function sendCsv(res, name, body) {
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}-${stamp}.csv"`);
  res.send(body);
}

// ---------------------------------------------------------------- client roster (shared by dashboard and clients page)

const STATUS_ORDER = ['overdue', 'unpaid', 'due', 'current', 'finished'];

function filterRoster(query, { archived = false } = {}) {
  const q = String(query.q || '').trim().toLowerCase().slice(0, 100);
  const pkg = String(query.package || '');
  const status = Object.hasOwn(billing.PAYMENT_STATUS, query.status) ? query.status : '';
  const roster = billing.clientRoster().filter((c) => Boolean(c.archived) === archived);
  const counts = Object.fromEntries(STATUS_ORDER.map((k) => [k, roster.filter((c) => c.status === k).length]));
  const clients = roster
    .filter((c) => !q || `${c.name} ${c.email} ${c.phone || ''}`.toLowerCase().includes(q))
    .filter((c) => !pkg || c.paid_package === pkg || c.pending_package === pkg)
    .filter((c) => !status || c.status === status);
  return { clients, counts, total: roster.length, filters: { q, package: pkg, status, archived } };
}

function queryString(query) {
  return new URLSearchParams(Object.entries(query).filter(([, v]) => typeof v === 'string' && v)).toString();
}

// ---------------------------------------------------------------- dashboard

router.get('/', (req, res) => {
  const { clients, counts, total, filters } = filterRoster(req.query);
  // People who owe money first, then those due soon, then everyone else.
  clients.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name));
  res.render('admin/dashboard', {
    title: 'Dashboard',
    section: 'dashboard',
    clients,
    counts,
    total,
    filters,
    queryString: queryString(req.query),
    STATUS: billing.PAYMENT_STATUS,
    STATUS_ORDER,
    packages: billing.listPackages({ includeInactive: true }),
    revenueMonth: db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM orders WHERE status = 'paid' AND paid_at >= ?`).get(startOfMonthSast()).s,
    paymentsMonth: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND paid_at >= ?`).get(startOfMonthSast()).n,
    payments: db
      .prepare(
        `SELECT o.*, c.first_name, c.last_name FROM orders o JOIN clients c ON c.id = o.client_id
         WHERE o.status = 'paid' ORDER BY o.paid_at DESC LIMIT 6`
      )
      .all(),
    enquiries: db.prepare(`SELECT * FROM enquiries WHERE status = 'new' ORDER BY created_at DESC LIMIT 5`).all(),
    activity: db
      .prepare(`SELECT a.*, u.username, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 10`)
      .all(),
    payUrl: (token) => `${config.publicUrl}/pay/${token}`,
    METHODS,
  });
});

// ---------------------------------------------------------------- clients

router.get('/clients', (req, res) => {
  const archived = req.query.archived === '1';
  const { clients, counts, total, filters } = filterRoster(req.query, { archived });
  res.render('admin/clients', {
    title: archived ? 'Archived clients' : 'Clients',
    section: 'clients',
    clients,
    counts,
    total,
    filters,
    STATUS: billing.PAYMENT_STATUS,
    STATUS_ORDER,
    packages: billing.listPackages({ includeInactive: true }),
    queryString: queryString(req.query),
    payUrl: (token) => `${config.publicUrl}/pay/${token}`,
  });
});

router.get('/clients.csv', (req, res) => {
  const { clients } = filterRoster(req.query, { archived: req.query.archived === '1' });
  audit(req, 'clients_exported', `${clients.length} clients`);
  sendCsv(
    res,
    'je-fitness-clients',
    toCsv(clients, [
      ['First name', (c) => c.first_name],
      ['Last name', (c) => c.last_name],
      ['Email', (c) => c.email],
      ['Cellphone', (c) => c.phone],
      ['Payment status', (c) => c.statusLabel],
      ['Package paid for', (c) => c.paid_package],
      ['Paid until', (c) => (c.paid_until ? c.paid_until.slice(0, 10) : '')],
      ['Last payment date', (c) => (c.last_paid_at ? c.last_paid_at.slice(0, 10) : '')],
      ['Last payment (R)', (c) => (c.last_amount_cents === null ? '' : (c.last_amount_cents / 100).toFixed(2))],
      ['Awaiting payment for', (c) => c.pending_package],
      ['Total paid (R)', (c) => (c.total_paid_cents / 100).toFixed(2)],
      ['Goal', (c) => c.goal],
      ['Guardian', (c) => c.guardian_name],
      ['Guardian cellphone', (c) => c.guardian_phone],
      ['Client since', (c) => c.created_at.slice(0, 10)],
    ])
  );
});

function clientValidator(body) {
  return new Validator(body)
    .text('first_name', { label: 'First name', required: true, max: 60 })
    .text('last_name', { label: 'Last name', required: true, max: 60 })
    .email('email')
    .phone('phone', { label: 'Cellphone number' })
    .text('goal', { label: 'Goal', max: 500, multiline: true })
    .text('guardian_name', { label: 'Guardian name', max: 120 })
    .phone('guardian_phone', { label: 'Guardian cellphone' });
}

router.get('/clients/new', (req, res) => {
  const enquiry = idParam(req.query.enquiry) && db.prepare('SELECT * FROM enquiries WHERE id = ?').get(idParam(req.query.enquiry));
  const values = {};
  if (enquiry) {
    const [first, ...rest] = enquiry.name.trim().split(/\s+/);
    Object.assign(values, { first_name: first, last_name: rest.join(' '), email: enquiry.email, phone: enquiry.phone, enquiry_id: enquiry.id });
  }
  res.render('admin/client-new', { title: 'Add client', section: 'clients', values, errors: {} });
});

router.post('/clients', (req, res) => {
  const v = clientValidator(req.body);
  const d = v.data;
  if (d.email && !v.errors.email) {
    const existing = db.prepare('SELECT id FROM clients WHERE email = ?').get(d.email);
    if (existing) v.fail('email', 'A client with this email already exists.');
  }
  if (!v.ok) {
    return res.status(422).render('admin/client-new', { title: 'Add client', section: 'clients', values: { ...d, enquiry_id: req.body.enquiry_id }, errors: v.errors });
  }
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO clients (first_name, last_name, email, phone, goal, guardian_name, guardian_phone, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(d.first_name, d.last_name, d.email, d.phone || null, d.goal || null, d.guardian_name || null, d.guardian_phone || null,
      idParam(req.body.enquiry_id) ? 'enquiry' : 'coach', now(), now());
  const enquiryId = idParam(req.body.enquiry_id);
  if (enquiryId) db.prepare(`UPDATE enquiries SET status = 'handled', client_id = ? WHERE id = ?`).run(lastInsertRowid, enquiryId);
  audit(req, 'client_created', d.email);
  req.flash('success', `${d.first_name} ${d.last_name} added. Record a payment or send a payment link below.`);
  res.redirect(`/admin/clients/${lastInsertRowid}#payments`);
});

router.get('/clients/:id', (req, res) => {
  const client = billing.getClient(idParam(req.params.id));
  if (!client) return notFound(res, 'Client');
  const payLink = req.session.payLink && req.session.payLink.clientId === client.id ? req.session.payLink : null;
  delete req.session.payLink;
  const orders = db.prepare('SELECT * FROM orders WHERE client_id = ? ORDER BY created_at DESC').all(client.id);
  res.render('admin/client', {
    title: `${client.first_name} ${client.last_name}`,
    section: 'clients',
    client,
    membership: billing.clientStatus(client.id),
    orders: orders.map((o) => ({ ...o, url: payUrl(o) })),
    packages: billing.listPackages({ includeInactive: true }),
    enquiries: db.prepare('SELECT * FROM enquiries WHERE email = ? COLLATE NOCASE ORDER BY created_at DESC').all(client.email),
    payLink,
    values: {},
    errors: {},
    METHODS,
    MANUAL_METHODS,
  });
});

router.post('/clients/:id', (req, res) => {
  const client = billing.getClient(idParam(req.params.id));
  if (!client) return notFound(res, 'Client');
  const v = clientValidator(req.body);
  const d = v.data;
  if (d.email && !v.errors.email) {
    const clash = db.prepare('SELECT id FROM clients WHERE email = ? AND id != ?').get(d.email, client.id);
    if (clash) v.fail('email', 'Another client already uses this email.');
  }
  if (!v.ok) {
    req.flash('error', Object.values(v.errors)[0]);
    return res.redirect(`/admin/clients/${client.id}#details`);
  }
  db.prepare(
    `UPDATE clients SET first_name = ?, last_name = ?, email = ?, phone = ?, goal = ?, guardian_name = ?, guardian_phone = ?, updated_at = ?
     WHERE id = ?`
  ).run(d.first_name, d.last_name, d.email, d.phone || null, d.goal || null, d.guardian_name || null, d.guardian_phone || null, now(), client.id);
  audit(req, 'client_updated', d.email);
  req.flash('success', 'Client details saved.');
  res.redirect(`/admin/clients/${client.id}#details`);
});

router.post('/clients/:id/notes', (req, res) => {
  const client = billing.getClient(idParam(req.params.id));
  if (!client) return notFound(res, 'Client');
  const v = new Validator(req.body).text('notes', { max: 5000, multiline: true });
  db.prepare('UPDATE clients SET notes = ?, updated_at = ? WHERE id = ?').run(v.data.notes || null, now(), client.id);
  req.flash('success', 'Private notes saved.');
  res.redirect(`/admin/clients/${client.id}#details`);
});

router.post('/clients/:id/archive', (req, res) => {
  const client = billing.getClient(idParam(req.params.id));
  if (!client) return notFound(res, 'Client');
  const archived = client.archived ? 0 : 1;
  db.prepare('UPDATE clients SET archived = ?, updated_at = ? WHERE id = ?').run(archived, now(), client.id);
  audit(req, archived ? 'client_archived' : 'client_restored', client.email);
  req.flash('success', archived ? `${client.first_name} archived. Find them under Clients > Archived.` : `${client.first_name} restored.`);
  res.redirect(`/admin/clients/${client.id}`);
});

function paymentInput(req, client) {
  const pkg = billing.getPackageById(idParam(req.body.package_id) || 0);
  const v = new Validator(req.body)
    .number('amount', { label: 'Amount', min: 0, max: 100000 })
    .text('note', { label: 'Note', max: 300 });
  if (!pkg) v.fail('package_id', 'Choose a package.');
  const amountCents = v.data.amount === null ? (pkg ? pkg.price_cents : 0) : Math.round(v.data.amount * 100);
  return { pkg, v, amountCents, client };
}

router.post('/clients/:id/payment-link', (req, res) => {
  const client = billing.getClient(idParam(req.params.id));
  if (!client) return notFound(res, 'Client');
  const { pkg, v, amountCents } = paymentInput(req, client);
  if (!v.ok) {
    req.flash('error', Object.values(v.errors)[0]);
    return res.redirect(`/admin/clients/${client.id}#payments`);
  }
  const order = billing.createOrder({ clientId: client.id, pkg, createdBy: 'coach', amountCents, note: v.data.note });
  req.session.payLink = { clientId: client.id, url: payUrl(order), reference: order.reference, amount: order.amount_cents, packageName: order.package_name };
  audit(req, 'payment_link_created', `${order.reference} ${client.email}`);
  res.redirect(`/admin/clients/${client.id}#payments`);
});

router.post('/clients/:id/record-payment', (req, res) => {
  const client = billing.getClient(idParam(req.params.id));
  if (!client) return notFound(res, 'Client');
  const { pkg, v, amountCents } = paymentInput(req, client);
  v.oneOf('method', MANUAL_METHODS, { label: 'a payment method', required: true });
  if (!v.ok) {
    req.flash('error', Object.values(v.errors)[0]);
    return res.redirect(`/admin/clients/${client.id}#payments`);
  }
  const order = billing.recordManualPayment({ clientId: client.id, pkg, method: v.data.method, amountCents, note: v.data.note });
  audit(req, 'payment_recorded', `${order.reference} ${METHODS[v.data.method]} R${(amountCents / 100).toFixed(2)}`);
  req.flash('success', `Payment recorded. ${pkg.name} is active until ${new Date(order.period_end).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}.`);
  res.redirect(`/admin/clients/${client.id}#payments`);
});

// ---------------------------------------------------------------- orders

router.post('/orders/:id/mark-paid', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(idParam(req.params.id) || 0);
  if (!order) return notFound(res, 'Order');
  const method = MANUAL_METHODS.includes(req.body.method) ? req.body.method : 'eft';
  if (billing.markOrderPaid(order.id, { method })) {
    audit(req, 'order_marked_paid', `${order.reference} ${METHODS[method]}`);
    req.flash('success', `${order.reference} marked as paid (${METHODS[method]}).`);
  } else {
    req.flash('info', 'That order was already paid.');
  }
  res.redirect(safeBack(req, `/admin/clients/${order.client_id}#payments`));
});

router.post('/orders/:id/cancel', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(idParam(req.params.id) || 0);
  if (!order) return notFound(res, 'Order');
  if (billing.setOrderStatus(order.id, 'cancelled')) {
    audit(req, 'order_cancelled', order.reference);
    req.flash('success', `${order.reference} cancelled. Its payment link no longer works.`);
  }
  res.redirect(safeBack(req, `/admin/clients/${order.client_id}#payments`));
});

// ---------------------------------------------------------------- payments

function paymentRows(status) {
  return db
    .prepare(
      `SELECT o.*, c.first_name, c.last_name, c.email FROM orders o JOIN clients c ON c.id = o.client_id
       ${status ? 'WHERE o.status = ?' : ''} ORDER BY COALESCE(o.paid_at, o.created_at) DESC`
    )
    .all(...(status ? [status] : []));
}

function statusFilter(value) {
  return ['pending', 'paid', 'cancelled', 'failed'].includes(value) ? value : '';
}

router.get('/payments', (req, res) => {
  const status = statusFilter(req.query.status);
  res.render('admin/payments', {
    title: 'Payments',
    section: 'payments',
    status,
    orders: paymentRows(status).slice(0, 300).map((o) => ({ ...o, url: payUrl(o) })),
    events: db.prepare('SELECT * FROM payment_events ORDER BY id DESC LIMIT 25').all(),
    METHODS,
    MANUAL_METHODS,
  });
});

router.get('/payments.csv', (req, res) => {
  const rows = paymentRows(statusFilter(req.query.status));
  audit(req, 'payments_exported', `${rows.length} orders`);
  sendCsv(
    res,
    'je-fitness-payments',
    toCsv(rows, [
      ['Date paid', (o) => (o.paid_at ? o.paid_at.slice(0, 10) : '')],
      ['Created', (o) => o.created_at.slice(0, 10)],
      ['Reference', (o) => o.reference],
      ['Client', (o) => `${o.first_name} ${o.last_name}`],
      ['Email', (o) => o.email],
      ['Package', (o) => o.package_name],
      ['Amount (R)', (o) => (o.amount_cents / 100).toFixed(2)],
      ['Status', (o) => o.status],
      ['Method', (o) => (o.method ? METHODS[o.method] || o.method : '')],
      ['PayFast ID', (o) => o.pf_payment_id],
      ['Period start', (o) => (o.period_start ? o.period_start.slice(0, 10) : '')],
      ['Period end', (o) => (o.period_end ? o.period_end.slice(0, 10) : '')],
      ['Note', (o) => o.note],
    ])
  );
});

// ---------------------------------------------------------------- packages

router.get('/packages', (req, res) => {
  res.render('admin/packages', { title: 'Packages', section: 'packages', packages: billing.listPackages({ includeInactive: true }) });
});

router.post('/packages/:id', (req, res) => {
  const pkg = billing.getPackageById(idParam(req.params.id) || 0);
  if (!pkg) return notFound(res, 'Package');
  const v = new Validator(req.body)
    .text('name', { label: 'Name', required: true, max: 60 })
    .text('label', { label: 'Label', max: 40 })
    .text('tagline', { label: 'Tagline', max: 160 })
    .text('badge', { label: 'Badge', max: 30 })
    .text('price_note', { label: 'Price note', max: 60 })
    .number('price', { label: 'Price', min: 0, max: 100000, required: true })
    .text('features', { label: 'Features', max: 3000, multiline: true })
    .number('sort_order', { label: 'Order', min: 0, max: 99, integer: true })
    .checked('featured')
    .checked('active');
  if (!v.ok) {
    req.flash('error', `${pkg.name}: ${Object.values(v.errors)[0]}`);
    return res.redirect(`/admin/packages#pkg-${pkg.id}`);
  }
  const d = v.data;
  const features = d.features.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  db.prepare(
    `UPDATE packages SET name = ?, label = ?, tagline = ?, badge = ?, price_note = ?, price_cents = ?, features = ?,
       sort_order = ?, featured = ?, active = ?, updated_at = ? WHERE id = ?`
  ).run(
    d.name, d.label, d.tagline, d.badge, d.price_note, Math.round(d.price * 100), JSON.stringify(features),
    d.sort_order ?? pkg.sort_order, d.featured ? 1 : 0, d.active ? 1 : 0, now(), pkg.id
  );
  audit(req, 'package_updated', `${d.name} R${d.price}`);
  req.flash('success', `${d.name} updated.`);
  res.redirect(`/admin/packages#pkg-${pkg.id}`);
});

// ---------------------------------------------------------------- enquiries

router.get('/enquiries', (req, res) => {
  const status = ['new', 'handled'].includes(req.query.status) ? req.query.status : '';
  const names = Object.fromEntries(billing.listPackages({ includeInactive: true }).map((p) => [p.slug, p.fullName]));
  const enquiries = db
    .prepare(
      `SELECT e.*, c.id AS existing_client FROM enquiries e LEFT JOIN clients c ON c.email = e.email COLLATE NOCASE
       ${status ? 'WHERE e.status = ?' : ''} ORDER BY e.created_at DESC LIMIT 300`
    )
    .all(...(status ? [status] : []))
    .map((e) => ({ ...e, interestLabel: e.interest === 'unsure' || !e.interest ? 'Not sure yet' : names[e.interest] || e.interest }));
  res.render('admin/enquiries', { title: 'Enquiries', section: 'enquiries', enquiries, status, brand: site.brand });
});

router.post('/enquiries/:id/toggle', (req, res) => {
  const enquiry = db.prepare('SELECT * FROM enquiries WHERE id = ?').get(idParam(req.params.id) || 0);
  if (!enquiry) return notFound(res, 'Enquiry');
  db.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(enquiry.status === 'new' ? 'handled' : 'new', enquiry.id);
  res.redirect(safeBack(req, '/admin/enquiries'));
});

// ---------------------------------------------------------------- owner account

router.get('/account', (req, res) => {
  const owner = db.prepare('SELECT id, username, email, name, last_login_at FROM users WHERE id = ?').get(req.user.id);
  res.render('admin/account', { title: 'My account', section: 'account', owner, weak: Boolean(req.session.weakPassword) });
});

router.post('/account/details', (req, res) => {
  const v = new Validator(req.body)
    .text('name', { label: 'Name', required: true, max: 60 })
    .text('username', { label: 'Username', required: true, min: 3, max: 30 })
    .email('email');
  const d = v.data;
  if (d.username && !/^[a-z0-9._-]+$/i.test(d.username)) v.fail('username', 'Use only letters, numbers, dots, dashes and underscores in the username.');
  if (!v.ok) {
    req.flash('error', Object.values(v.errors)[0]);
    return res.redirect('/admin/account');
  }
  const clash = db
    .prepare('SELECT id FROM users WHERE (username = ? COLLATE NOCASE OR email = ?) AND id != ?')
    .get(d.username, d.email, req.user.id);
  if (clash) {
    req.flash('error', 'That username or email is already used by another login.');
    return res.redirect('/admin/account');
  }
  db.prepare('UPDATE users SET name = ?, username = ?, email = ? WHERE id = ?').run(d.name, d.username.toLowerCase(), d.email, req.user.id);
  audit(req, 'account_updated', d.username);
  req.flash('success', 'Your details have been saved.');
  res.redirect('/admin/account');
});

router.post('/account/password', async (req, res) => {
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  let error = null;
  if (!(await verifyPassword(current, owner.password_hash))) error = 'Your current password is incorrect.';
  else error = passwordProblem(next, { email: owner.email, firstName: owner.name });
  if (!error && owner.username && next.toLowerCase().includes(owner.username.toLowerCase())) error = 'Your password should not contain your username.';
  if (!error && next !== String(req.body.new_password_confirm || '')) error = 'The new passwords do not match.';
  if (error) {
    req.flash('error', error);
    return res.redirect('/admin/account');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), owner.id);
  // Sign out every other device that was using the old password.
  db.prepare(`DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ? AND sid != ?`).run(owner.id, req.sessionID);
  req.session.weakPassword = false;
  audit(req, 'password_changed', owner.username || owner.email);
  req.flash('success', 'Password changed. Any other devices have been signed out.');
  res.redirect('/admin/account');
});

module.exports = router;
