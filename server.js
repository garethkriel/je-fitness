'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');

const config = require('./src/config');
const { db } = require('./src/db');
const SqliteSessionStore = require('./src/session-store');
const { csrfProtection } = require('./src/security');
const { loadUser, locals } = require('./src/middleware');
const limits = require('./src/limits');
const checkout = require('./src/routes/checkout');
const { ensureOwnerFromEnv } = require('./src/owner');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const SESSION_COOKIE = config.secureCookies ? '__Host-je.sid' : 'je.sid';
app.set('sessionCookieName', SESSION_COOKIE);

// ------------------------------------------------------------------ security headers

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        // Live checkouts post to www.payfast.co.za, which redirects to payment.payfast.io; browsers apply
        // form-action to redirects too, so both must be allowed.
        formAction: ["'self'", 'https://www.payfast.co.za', 'https://sandbox.payfast.co.za', 'https://*.payfast.io'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        ...(config.secureCookies ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.secureCookies ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  if (config.preview) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// ------------------------------------------------------------------ static files

const cacheFor = (age) => ({ maxAge: config.isProd ? age : 0, index: false, dotfiles: 'ignore' });
const nodeModule = (p) => path.join(__dirname, 'node_modules', p);

app.use(express.static(path.join(__dirname, 'public'), cacheFor('7d')));
app.use('/vendor/three/build', express.static(nodeModule('three/build'), cacheFor('30d')));
app.use('/vendor/three/jsm', express.static(nodeModule('three/examples/jsm'), cacheFor('30d')));
app.use('/vendor/gsap', express.static(nodeModule('gsap/dist'), cacheFor('30d')));
app.use('/vendor/lenis', express.static(nodeModule('lenis/dist'), cacheFor('30d')));
app.use('/vendor/fonts/manrope', express.static(nodeModule('@fontsource-variable/manrope/files'), cacheFor('365d')));
app.use('/vendor/fonts/cormorant', express.static(nodeModule('@fontsource/cormorant-garamond/files'), cacheFor('365d')));

// ------------------------------------------------------------------ health check (used by the host)

// Also echoes the caller's IP, which shows whether TRUST_PROXY matches the host's proxy setup.
app.get('/healthz', (req, res) => {
  db.prepare('SELECT 1').get();
  res.set('Cache-Control', 'no-store').json({ status: 'ok', ip: req.ip });
});

// ------------------------------------------------------------------ PayFast ITN (raw body, no session, no CSRF)

app.post('/payfast/notify', checkout.itnBodyParser, checkout.itnHandler);

// ------------------------------------------------------------------ body parsing, sessions, CSRF

app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 1000 }));
app.use(express.json({ limit: '50kb' }));

app.use(
  session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store: new SqliteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: 12 * 60 * 60 * 1000 },
  })
);

app.use(loadUser);
app.use(locals);
app.use(limits.global);
app.use(csrfProtection);

// ------------------------------------------------------------------ routes

app.use('/', require('./src/routes/public'));
app.use('/', require('./src/routes/auth'));
app.use('/', checkout.router);
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page not found',
    status: 404,
    message: "The page you're looking for doesn't exist or has moved.",
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return;
  // Errors can happen before the locals middleware ran (e.g. an oversized body).
  res.locals.site ??= require('./src/site');
  res.locals.h ??= require('./src/middleware').helpers;
  res.locals.csrf ??= () => '';
  res.locals.getFlashes ??= () => [];
  res.locals.path ??= req.path;
  res.locals.year ??= new Date().getFullYear();
  res.status(status).render('error', {
    title: status >= 500 ? 'Something went wrong' : 'Request problem',
    status,
    message: status < 500 && err.expose ? err.message : 'Sorry, something went wrong on our side. Please try again.',
  });
});

let server;
ensureOwnerFromEnv()
  .then(() => {
    if (config.demoData) require('./src/demo').seedDemoData();
    server = app.listen(config.port, config.host, () => {
      console.log(`JE Fitness running at ${config.publicUrl} (listening on ${config.host}:${config.port})`);
      console.log(`PayFast mode: ${config.payfast.sandbox ? 'SANDBOX (test payments)' : 'LIVE'}`);
    });
  })
  .catch((err) => {
    console.error(`[setup] ${err.message}`);
    process.exit(1);
  });

function shutdown() {
  if (!server) process.exit(0);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
