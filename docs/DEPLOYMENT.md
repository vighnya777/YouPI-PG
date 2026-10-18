# YOUPI PG V2 — Deployment & Installation Guide

This document describes how to deploy and run the clean distributable **YOUPI PG V2** package.

---

## 1. Prerequisites

- **Operating System**: Linux (Ubuntu 22.04+ / Debian 12+), macOS, or Windows 10/11 / Windows Server.
- **Node.js**: Version `>= 20.0.0` (LTS recommended).
- **Package Manager**: `npm` (included with Node.js).
- **Network Ports**:
  - One public HTTP port: the host-provided `PORT`, or `8080` (`PUBLIC_ROUTER_PORT`) if self-hosting.
  - Internal service ports (`6100`, `7000`, `6001`, `6003`, `5000`, `3000`) are private to the app host.

---

## 2. Installation Steps

### Step 1: Extract / Clone Package
Ensure you are in the package root directory:
```bash
cd "YOUPI PG PACKAGE"
```

### Step 2: Configure Environment
Copy the clean template to `.env`:
```bash
cp .env.example .env
```
Open `.env` in your editor and configure:
1. `PUBLIC_BASE_URL`: Set the one public HTTPS origin assigned to your deployment, with no path (e.g. `https://pay.yourdomain.com`).
2. `ENCRYPTION_MASTER_KEY`: Generate a 64-character hex key (e.g. `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`).
3. `JWT_SECRET`: Random string at least 32 characters.
4. `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`: Credentials for your Merchant Admin dashboard.

The five `BASE_*_URL` values are now derived from `PUBLIC_BASE_URL`; do not configure five public hosts. The public route map is:

| Surface | Path |
| --- | --- |
| Merchant Admin | `/` or `/admin` |
| Payment API | `/api/*` |
| Checkout and SDK | `/checkout/*`, `/youpi.js`, `/sdk/*` |
| Payment Help | `/help` |
| Demo Store | `/store/*` |
| Gmail OAuth callback | `/oauth/callback` |

Register `${PUBLIC_BASE_URL}/oauth/callback` as an allowed redirect URI in Google OAuth.

### Step 3: Install Dependencies
```bash
npm install
```

### Step 4: Initialize Fresh Database
Run the automated database setup to initialize schema and seed the default merchant and receiving account:
```bash
npm run db:setup
```
*(Creates `data/youpi_pg.sqlite` in clean state with 0 transactions).*

### Step 5: Start the System

#### Development / Demonstration Mode:
```bash
npm run dev
```
Starts the same path-based public gateway locally at `http://localhost:8080`. Use that origin for Admin, API, Checkout, Help, Store, and Gmail OAuth; the process supervisor remains local at `http://localhost:8090`.
On managed hosts such as Render, the development launcher binds the public gateway to the host-provided `PORT` (ahead of `PUBLIC_ROUTER_PORT`) and uses `RENDER_EXTERNAL_URL` as the public origin when `PUBLIC_BASE_URL` is unset. If the assigned public port conflicts with the Help service port, Help is moved to the next port.

#### Production Mode:
```bash
npm run start
```
Starts services in background daemon mode.

When either launcher detects a supported hosting platform, it prints the Admin API token beside the Admin URL after startup. This token is a bearer credential: restrict deployment log access to administrators and rotate the token if those logs are exposed. Local startup does not print it.

---

## 3. Verifying Your Installation

1. **Development mode** (`npm run dev`): open `http://localhost:8080`, then log in with your admin credentials from `.env`. Configure your active UPI ID and payee name in the Receiving Accounts tab.
2. **Single-origin production mode** (`npm start`): open your `PUBLIC_BASE_URL` (or `http://localhost:8080` when self-hosting with the default gateway port).
3. **Health Check**: `curl http://localhost:8080/health` returns the public gateway health. The API is routed at `/api`.

---

## 4. Production Domain & SSL (Cloudflare / NGINX)

For production deployment:
1. Set `PUBLIC_BASE_URL` to the single HTTPS origin assigned by your hosting provider.
2. Start the full application with `npm start`. The public gateway listens on the provider's `PORT` or `PUBLIC_ROUTER_PORT`; internal services remain on private ports.
3. If using Cloudflare Tunnel, create one published hostname and point it to `http://localhost:8080` (or the configured `PUBLIC_ROUTER_PORT`). Do not create separate hostnames for API, checkout, admin, Gmail, or the demo store.
4. Use the path map above; all browser and webhook URLs use that same origin.

The deployment host must allow the application to start its Node child processes and bind the internal service ports on the same machine/container. A platform that only runs one isolated process and does not permit child services, or that requires each service to be deployed separately, cannot run this monolith behind a single origin without an external reverse proxy or a deployment architecture change. Keep the internal service ports private; expose only the public gateway port.
