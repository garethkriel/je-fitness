'use strict';
// Create the owner (dashboard) login, or reset its password.
//   npm run create-admin
// Non-interactive (e.g. on a server): set ADMIN_USERNAME, ADMIN_PASSWORD and optionally ADMIN_EMAIL / ADMIN_NAME.
// A password that fails the strength check is only accepted with ADMIN_ALLOW_WEAK_PASSWORD=1 (or by confirming
// interactively); the dashboard then keeps reminding the owner to change it.

const readline = require('node:readline');
const { db, now } = require('../src/db');
const { hashPassword, passwordProblem } = require('../src/security');
const site = require('../src/site');

const env = process.env;
const interactive = !env.ADMIN_PASSWORD;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else if (!/[\r\n]/.test(s)) rl.output.write('*');
        else rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

(async () => {
  const defaultUsername = site.coach.toLowerCase();
  const username = (env.ADMIN_USERNAME || (interactive && (await ask(`Username [${defaultUsername}]: `))) || defaultUsername).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    console.error('The username must be 3-30 letters, numbers, dots, dashes or underscores.');
    process.exit(1);
  }
  const existing = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  const email = (existing?.email || env.ADMIN_EMAIL || (interactive && (await ask(`Email [${site.email}]: `))) || site.email).toLowerCase();
  const name = existing?.name || env.ADMIN_NAME || (interactive && (await ask(`Your name [${site.coach}]: `))) || site.coach;

  const emailClash = db.prepare('SELECT id FROM users WHERE email = ? AND username IS NOT ? ').get(email, username);
  if (!existing && emailClash) {
    // An older login with this email but no username: give it the username instead of creating a duplicate.
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, emailClash.id);
  }
  const user = existing || (emailClash && db.prepare('SELECT * FROM users WHERE id = ?').get(emailClash.id));

  let password = env.ADMIN_PASSWORD || '';
  if (interactive) {
    for (;;) {
      password = await ask('New password: ', { hidden: true });
      const again = await ask('Repeat password: ', { hidden: true });
      if (again !== password) {
        console.log('  Passwords do not match.');
        continue;
      }
      const problem = passwordProblem(password, { email, firstName: name });
      if (problem) {
        console.log(`  Warning: ${problem}`);
        const ok = await ask('  Use this weak password anyway? (yes/no): ');
        if (!/^y(es)?$/i.test(ok)) continue;
      }
      break;
    }
  } else {
    const problem = passwordProblem(password, { email, firstName: name });
    if (problem && env.ADMIN_ALLOW_WEAK_PASSWORD !== '1') {
      console.error(`ADMIN_PASSWORD rejected: ${problem} Set ADMIN_ALLOW_WEAK_PASSWORD=1 to use it anyway.`);
      process.exit(1);
    }
    if (problem) console.warn(`Warning: weak password accepted (${problem}) The dashboard will remind the owner to change it.`);
  }

  const hash = await hashPassword(password);
  if (user) {
    db.prepare('UPDATE users SET password_hash = ?, username = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').run(hash, username, user.id);
    db.prepare(`DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?`).run(user.id);
    console.log(`\nPassword updated for "${username}". Existing sessions were signed out.`);
  } else {
    db.prepare('INSERT INTO users (username, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)').run(username, email, hash, name, now());
    console.log(`\nOwner login "${username}" created (${email}). Sign in at /login to open the dashboard.`);
  }
  db.close();
})();
