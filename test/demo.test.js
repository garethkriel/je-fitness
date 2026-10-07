'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'je-demo-'));
process.env.DB_PATH = path.join(tmp, 'test.sqlite');
process.env.PAYFAST_SANDBOX = 'true';

const { db } = require('../src/db');
const billing = require('../src/services/billing');
const { seedDemoData } = require('../src/demo');

test.after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('preview sample data shows every payment status, once', () => {
  assert.equal(seedDemoData(), true);
  const counts = {};
  for (const c of billing.clientRoster()) counts[c.status] = (counts[c.status] || 0) + 1;
  assert.deepEqual(counts, { overdue: 2, unpaid: 1, due: 1, current: 2, finished: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").get().n, 2);
  assert.equal(seedDemoData(), false, 'never adds sample data to a database that already has clients');
});
