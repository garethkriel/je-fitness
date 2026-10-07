'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const site = require('../src/site');

const ROOT = path.join(__dirname, '..');

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

// Jackie's original certificate PDF prints his ID number, so only the redacted images may be published.
test('no ID numbers or original certificate PDFs are published', () => {
  const idNumber = /\b\d{13}\b/;
  assert.doesNotMatch(JSON.stringify(site), idNumber);
  for (const file of [...filesUnder(path.join(ROOT, 'views')), ...filesUnder(path.join(ROOT, 'public', 'img'))]) {
    assert.notEqual(path.extname(file).toLowerCase(), '.pdf', `${path.relative(ROOT, file)} should not be published`);
    if (/\.(ejs|html|svg)$/.test(file)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), idNumber, path.relative(ROOT, file));
  }
});

test('the qualification shown on the site is complete', () => {
  const q = site.qualification;
  for (const key of ['title', 'awardedTo', 'institution', 'accreditation', 'completed', 'certificateNo']) assert.ok(q[key], key);
  for (const img of [q.image, q.preview]) assert.ok(fs.existsSync(path.join(ROOT, 'public', img)), img);
  assert.equal(q.subjects.length, 22);
  assert.ok(q.skills.length >= 4);
});
