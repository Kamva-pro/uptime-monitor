# Deploying Uptime Monitor on Xneelo

## Option A — `uptime.dynamite.agency` subdomain (Recommended)

### Requirements
- Xneelo VPS or dedicated server with root/SSH access
- Docker + Docker Compose installed
- Domain: dynamite.agency managed in Xneelo DNS

---

### Step 1 — Add DNS Record

In your Xneelo DNS manager (or wherever dynamite.agency NS points):

| Type | Name   | Value           | TTL |
|------|--------|-----------------|-----|
| A    | uptime | YOUR.SERVER.IP  | 300 |

> Replace `YOUR.SERVER.IP` with your Xneelo server's public IP.

---

### Step 2 — SSH into your server and clone the repo

```bash
ssh root@YOUR.SERVER.IP
cd /var/www
git clone https://github.com/YOUR_USER/uptime-monitor.git
cd uptime-monitor
```

---

### Step 3 — Set your email credentials

Edit `docker-compose.yml` and replace:
```
SMTP_PASS=YOUR_EMAIL_PASSWORD_HERE
```
with your actual `alerts@dynamite.agency` mailbox password.

---

### Step 4 — Install Docker (if not installed)

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

---

### Step 5 — Build and start containers

```bash
docker compose up -d --build
```

Verify both containers are running:
```bash
docker ps
# uptime-api   → port 4000
# uptime-ui    → port 3000
```

---

### Step 6 — Install Nginx on the host server

```bash
apt install nginx -y
```

Create a new vhost config:
```bash
nano /etc/nginx/sites-available/uptime.dynamite.agency
```

Paste this (HTTP only first, then we add SSL):
```nginx
server {
    listen 80;
    server_name uptime.dynamite.agency;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass         http://localhost:4000/;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Enable it:
```bash
ln -s /etc/nginx/sites-available/uptime.dynamite.agency /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

### Step 7 — SSL Certificate (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d uptime.dynamite.agency
```

Certbot will auto-configure HTTPS and set up auto-renewal.

✅ Your app is now live at **https://uptime.dynamite.agency**

---

## Option B — `spydrone.co.za/uptime` path-based

This requires the main spydrone.co.za nginx config to proxy `/uptime` to the containers.

### Add to spydrone.co.za nginx config

```nginx
location /uptime/ {
    proxy_pass         http://localhost:3000/;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
}

location /uptime/api/ {
    proxy_pass         http://localhost:4000/;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
}
```

> **Important**: Update `VITE_API_URL` in `docker-compose.yml` frontend args to `/uptime/api`
> and rebuild: `docker compose up -d --build frontend`

---

## Option C — Xneelo Shared Hosting (cPanel / Node.js Selector)

If you're on **shared hosting** (no Docker/SSH root access):

1. In cPanel → **Node.js Selector** → Create Application
   - Node version: 18+
   - App root: `uptime-monitor/backend`
   - App URL: `uptime.dynamite.agency`
   - Startup file: `server.js`

2. Upload backend files via File Manager or FTP

3. In the Node.js app environment variables, add all `SMTP_*` vars

4. Static frontend: Build it locally:
   ```bash
   cd frontend && npm install && npm run build
   ```
   Upload `frontend/dist/` to the public_html subdomain folder.

5. Add `.htaccess` in the subdomain root to proxy `/api/` to the Node app port.

> ⚠️ Shared hosting has limitations — the VPS/Docker approach (Option A) is strongly recommended for a production uptime monitor.

---

## Updating the App

After pulling new code changes:

```bash
cd /var/www/uptime-monitor
git pull
docker compose up -d --build
```

Data is persisted in the `uptime-data` Docker volume — it survives rebuilds.

---

## Useful Commands

```bash
# View live backend logs
docker logs -f uptime-api

# View frontend logs
docker logs -f uptime-ui

# Restart containers
docker compose restart

# Stop everything
docker compose down

# Check data file
docker exec uptime-api cat /app/data/db.json | head -50
```
