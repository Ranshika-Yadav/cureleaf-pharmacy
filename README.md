# Cureleaf Full Stack — Dusty Blue

## Run locally

Requires Node.js 20 or newer. No npm dependencies or database service required.

macOS/Linux:
```bash
cd cureleaf-fullstack
ADMIN_PASSWORD='replace-with-a-unique-long-password' npm start
```
Windows PowerShell:
```powershell
$env:ADMIN_PASSWORD='replace-with-a-unique-long-password'
npm start
```

Open http://localhost:3000 and admin at http://localhost:3000/admin.html.

**Do not open index.html using file://**. The website needs the running Node server to access the API.

## Implemented
- Server-hosted catalog and inventory with price/stock editing in admin
- Persistent order requests with server-side price validation and order status updates
- Contact messages and newsletter subscriptions stored on disk
- Admin login with HTTP-only session cookie, server-side password verification, basic rate limiting
- Existing search, sort, filters, wishlist, cart and responsive frontend retained
- JSON files in `data/` persist between restarts; no cloud database required

## Important before production
This is a functional demo, **not a production pharmacy**. No payments are taken, no shipping is arranged, and no prescriptions are verified. Products and testimonials are illustrative. You must implement licensed-pharmacy compliance, pharmacist review, prescription validation, real inventory, secure payments, shipping, privacy/consent and production-grade authentication, CSRF protection, HTTPS, logging, backups, database transactions and email delivery before accepting real customers. File-backed persistence is suitable for a single small demo server, not multiple server instances. Never commit customer data or your admin password. Set COOKIE_SECURE=true behind HTTPS.
