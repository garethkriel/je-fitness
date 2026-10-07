# JE Fitness

Website and payments dashboard for **JE Fitness**, Jackie's online coaching business in Bloemfontein.

- **Public site:** home page with a real-time 3D dumbbell, a packages page, an About page and a contact/enquiry form.
- **Packages (online coaching only):** Junior U18 (R500/month), Lifestyle Training (R1 000/month), Month-to-Month Program (R1 200/month), 12 Week Transformation (R2 000 once-off) and Once-Off Program (R2 800 for 3 months).
- **Guest checkout with PayFast:** clients enter their details and pay. No account or password is needed. Under-18s need a parent or guardian's consent.
- **Owner dashboard** (sign in at `/login`):
  - **Overview:** every client, the package they paid for, when it's paid until, and whether they are **Up to date**, **Due soon**, **Overdue** or **Not paid yet**. Clients who owe money are listed first.
  - **Clients:** search, filter by payment status and export to CSV; edit details; keep private notes; archive.
  - **Payments:** confirmed automatically by PayFast. Record EFT, cash or card-machine payments yourself, send clients secure payment links, and export to CSV.
  - **Enquiries:** messages from the contact form, which you can turn into clients.
  - **Packages:** edit prices and features.
  - **My account:** change the username, email and password.
  - **Activity log:** sign-ins and changes.

Diet plans, training programs and check-ins are **not** handled here. They belong to the separate client app.

## 1. Run it on your computer

You need [Node.js](https://nodejs.org) **22.13 or newer**. Then, in this folder:

```bash
npm install
```

```bash
npm start
```

Open <http://localhost:3000>. Sign in at <http://localhost:3000/login> (also linked as "Owner login" in the footer) with the username `jackie`.

To create the login on a new database, or reset the password if it's forgotten:

```bash
npm run create-admin
```

Run the automated tests with `npm test`.

## 2. Settings (`.env`)

The settings live in `.env`, which holds Jackie's PayFast details, so **keep it private**: it is never uploaded to GitHub (`.gitignore` excludes it), and you should never send it to anyone. On a new computer or server, copy `.env.example` to `.env` and fill it in; it lists every option.

| Setting | What it does |
| --- | --- |
| `NODE_ENV` | Set to `production` on the live server, in the host's settings. This also switches PayFast to live payments. |
| `PUBLIC_URL` | The site's public address, e.g. `https://jefitness.co.za`. PayFast sends payment confirmations to `PUBLIC_URL/payfast/notify`, and payment links use this address. |
| `SESSION_SECRET` | A long random value that protects the dashboard login. Use a new one on the live server: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. **Required in production.** |
| `TRUST_PROXY` | Set to `1` if the host puts the site behind a proxy (Render, Railway, cPanel, Nginx). |
| `PAYFAST_*` | PayFast details (see below). |

## 3. PayFast

| Where the site runs | Payments |
| --- | --- |
| Your computer | **Test payments** (PayFast sandbox, fake money). Jackie's real account is never charged. |
| Live server (`NODE_ENV=production`) | **Real payments** into Jackie's PayFast account (`PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY`). |

To force a mode, set `PAYFAST_SANDBOX=true` (test) or `PAYFAST_SANDBOX=false` (live). The startup log and the dashboard show which mode is on.

For live payments the site **won't start** unless `PUBLIC_URL` is the site's public `https://` address. Otherwise clients would be charged but PayFast couldn't tell the site, and they would still show as unpaid.

### Going live

1. Host the site (see **Hosting**) with `NODE_ENV=production`, `PUBLIC_URL=https://<the domain>`, a new `SESSION_SECRET`, and Jackie's `PAYFAST_MERCHANT_ID` and `PAYFAST_MERCHANT_KEY` from `.env`.
2. Recommended: in Jackie's PayFast dashboard (**Settings → Developer Settings**), set a **passphrase** and put the same value in `PAYFAST_PASSPHRASE`. They must match exactly, or PayFast rejects every payment.
3. Make a small real payment on the live site and check that it appears on the dashboard as paid.

When a client pays, PayFast notifies the site. The site then checks the signature, checks that the request came from PayFast's servers, checks the amount, and asks PayFast to confirm. Only then is the payment marked as paid. Every notification is logged under **Payments → PayFast notification log**.

### Testing payment confirmations

PayFast's shared test merchant works for checkout, but its passphrase is unknown, so test checkouts are sent unsigned and **payments are not confirmed automatically**. For a full end-to-end test:

1. Create a free account at <https://sandbox.payfast.co.za>.
2. Under **Settings → Developer Settings**, copy your sandbox Merchant ID and Merchant Key, and set a passphrase.
3. Put them in `.env` as `PAYFAST_SANDBOX_MERCHANT_ID`, `PAYFAST_SANDBOX_MERCHANT_KEY` and `PAYFAST_SANDBOX_PASSPHRASE`.
4. The site must be reachable from the internet for PayFast to confirm payments. Deploy it, or use a tunnel such as `ngrok` and set `PUBLIC_URL` to the tunnel address.

## 4. How payments and packages work

- **Monthly packages** cover one month per payment. **Once-off packages** cover their whole block (12 weeks, or 3 months).
- If a client pays early, the new period starts when the current one ends, so no days are lost.
- Payment status on the dashboard:

  | Status | Meaning |
  | --- | --- |
  | Up to date | Paid, and not due again within 7 days. |
  | Due soon | The paid period ends within 7 days ("Ending soon" for once-off programs). |
  | Overdue | A monthly package has ended and the next month isn't paid. |
  | Not paid yet | Signed up or added, but nothing paid. |
  | Program finished | A once-off program has run its course. |

- Monthly packages are rolling: a client simply pays again for the next month, using the website or a payment link you send.
- **Payment links:** the dashboard has a one-click **Payment link** button for overdue clients and a **Copy pay link** button for unpaid ones. On a client's page you can choose a package (and optionally a different amount), then copy or email the link. It opens a secure PayFast payment for that client.
- **Paid another way?** Use **Record a payment** on the client's page, or **Mark paid** on a pending payment.
- Each client is identified by email. If someone checks out again with the same email, the payment is added to their existing record. Their saved details are never overwritten from the website.

## 5. Editing the website text

- **Business details, About copy and FAQs:** `src/site.js`.
- **Package prices and features:** edit them in the dashboard under **Packages**. `src/packages.seed.js` only provides the starting values.
- **Jackie's qualification:** the details and the "What Jackie is qualified to do" list are under `qualification` in `src/site.js`. The certificate images are `public/img/certificate.jpg` and `certificate-preview.jpg`. They were rebuilt from the original PDF **without Jackie's ID number**. Never upload the original PDF; a test fails if a PDF or an ID number ends up in the site.
- **Jackie's photo:** save it as `public/img/jackie.jpg` (portrait, about 1100 × 1375 px), then restart the site. The About page shows it in place of the 3D kettlebell.
- **Terms and privacy:** `views/legal/terms.ejs` and `views/legal/privacy.ejs`. These are sensible starting points; have them reviewed for the business.

## 6. Hosting

This is a Node.js app that stores its data in a single SQLite file. It needs a host that runs Node 22+ **with persistent disk storage**. Serverless hosts such as Vercel or Netlify, and free plans without a disk, are **not** suitable.

### Render (set up)

`render.yaml` describes the whole setup: a web service in Frankfurt (closest to South Africa) on the `0.5c-512mb` plan, a 1 GB disk at `/var/data` for the database, live PayFast payments and a health check at `/healthz`.

1. Sign in at <https://dashboard.render.com> with GitHub and add a payment method.
2. **New → Blueprint**, pick the `je-fitness` repository and click **Apply**. Or open <https://render.com/deploy?repo=https://github.com/garethkriel/je-fitness>.
3. Render asks for three secret values:
   - `PAYFAST_MERCHANT_ID` and `PAYFAST_MERCHANT_KEY`: Jackie's live PayFast details (the same as in `.env`).
   - `ADMIN_PASSWORD`: the password for Jackie's dashboard login (username `jackie`). It's only used on the very first start. Delete it from **Environment** after the first sign-in.
4. Wait for the deploy to finish, then open the `https://je-fitness.onrender.com` address Render shows (the name can have a suffix if it's taken).

Every push to the `main` branch on GitHub deploys automatically. With a disk attached, each deploy takes the site offline for a few seconds.

**Custom domain:** in Render open the service, then **Settings → Custom Domains**, add the domain (e.g. `jefitness.co.za`) and create the DNS records Render shows at the domain registrar. Then add an environment variable `PUBLIC_URL=https://jefitness.co.za` so payment links and PayFast notifications use it.

**Back up the database** (`/var/data/je-fitness.sqlite`) regularly: it holds all clients and payments, and Jackie's login. Render keeps daily snapshots of the disk (see the service's **Disks** page), which can be restored if something goes wrong.

## 7. Security

- The owner password is hashed with scrypt. The account locks for 15 minutes after 5 failed sign-ins, and sign-in attempts are rate-limited.
- If the password is easy to guess, the dashboard shows a reminder to change it (under **My account**) until it's changed.
- Dashboard sessions expire after 4 hours of inactivity. Session cookies are HttpOnly, SameSite and Secure over HTTPS.
- Every form has CSRF protection and Origin checks.
- A strict Content-Security-Policy with per-request nonces, HSTS, and `frame-ancestors 'none'`.
- Database queries are parameterised, output is escaped, and input is validated.
- The contact form has a honeypot and rate limits to stop spam.
- Payment links use long random tokens that can't be guessed.
- PayFast notifications get signature, source-IP, amount and server-confirmation checks.
- CSV exports are protected against spreadsheet formula injection.

## Project layout

```
server.js                 App setup, security headers, routes
src/site.js               Business details and page copy (edit me)
src/config.js             Settings from .env, PayFast test/live mode
src/packages.seed.js      Starting packages (first start only)
src/db.js                 SQLite schema
src/services/billing.js   Packages, clients, orders, payment status
src/payfast.js            PayFast signing and notification checks
src/routes/               public, checkout (+ PayFast), auth, admin
views/                    Page templates (EJS)
public/                   Styles, animations, 3D scenes (Three.js)
scripts/create-admin.js   Create or reset the owner login
test/                     Automated tests (npm test)
```
