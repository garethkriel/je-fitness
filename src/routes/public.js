'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { db, now } = require('../db');
const limits = require('../limits');
const { Validator } = require('../validate');
const { listPackages } = require('../services/billing');

const router = express.Router();
const coachPhoto = ['jackie.webp', 'jackie.jpg', 'jackie.png'].find((f) => fs.existsSync(path.join(config.ROOT, 'public', 'img', f)));

function catalogue() {
  const packages = listPackages();
  return { packages, fromPrice: packages.length ? Math.min(...packages.map((p) => p.price_cents)) : null };
}

router.get('/', (req, res) => {
  res.render('home', { title: null, page: 'home', ...catalogue() });
});

router.get('/packages', (req, res) => {
  res.render('packages', { title: 'Packages & prices', page: 'packages', ...catalogue() });
});

router.get(['/online', '/online-training'], (req, res) => res.redirect(301, '/packages#online'));

router.get('/about', (req, res) => {
  res.render('about', { title: 'About Jackie', page: 'about', coachPhoto: coachPhoto ? `/img/${coachPhoto}` : null });
});

router.post('/enquiry', limits.enquiry, (req, res) => {
  const back = '/#contact';
  // Bots fill in every field, including this hidden one.
  if (String(req.body.website || '').trim()) return res.redirect(303, back);

  const slugs = listPackages().map((p) => p.slug);
  const v = new Validator(req.body)
    .text('name', { label: 'Your name', required: true, max: 100 })
    .email('email')
    .phone('phone')
    .oneOf('interest', ['unsure', ...slugs], { label: 'what you are interested in' })
    .text('message', { label: 'Message', required: true, max: 2000, multiline: true });

  if (!v.ok) {
    req.session.enquiry = { values: v.data, errors: v.errors };
    return res.redirect(303, back);
  }
  const d = v.data;
  db.prepare('INSERT INTO enquiries (name, email, phone, interest, message, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    d.name, d.email, d.phone || null, d.interest || 'unsure', d.message, req.ip, now()
  );
  req.flash('success', "Thanks! Your message has been sent. Jackie will reply by email, usually within 24 hours.");
  res.redirect(303, back);
});

router.get('/terms', (req, res) => res.render('legal/terms', { title: 'Terms of Service', page: 'legal' }));
router.get('/privacy', (req, res) => res.render('legal/privacy', { title: 'Privacy Policy', page: 'legal' }));

module.exports = router;
