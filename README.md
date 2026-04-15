# Dynamite Uptime Monitor — Deployment Guide

## What's in this project

```
uptime-checker/
├── backend/          Node.js API (pings sites, stores results in SQLite)
├── frontend/         React dashboard (the UI)
├── docker-compose.yml
├── nginx.conf        Reverse proxy config for your VPS
└── README.md
```

## Quick start (local testing)

```bash
cd backend && npm install && node server.js &
cd frontend && npm install && npm run dev
```

Open http://localhost:5173

---

## Deploy to your own server (free with Oracle Cloud)

### Step 1 — Get a free server

Sign up at https://cloud.oracle.com/free  
Create an Ubuntu 22.04 instance (ARM shape, free forever)  
Note your public IP address.

### Step 2 — Point your DNS

In your domain registrar for dynamite.co.za, add:

```
Type:  A
Name:  uptime
Value: YOUR_SERVER_IP
TTL:   3600
```

### Step 3 — SSH in and install Docker

```bash
ssh ubuntu@YOUR_SERVER_IP

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
newgrp docker

# Install Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Step 4 — Upload and run this project

```bash
# From your local machine, copy the project
scp -r uptime-checker/ ubuntu@YOUR_SERVER_IP:~/

# Back on the server
cd ~/uptime-checker
docker compose up -d
```

### Step 5 — Configure Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/uptime
sudo ln -s /etc/nginx/sites-available/uptime /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Get free SSL certificate
sudo certbot --nginx -d uptime.dynamite.co.za
```

Done! Visit https://uptime.dynamite.co.za

---

## API endpoints (for custom integrations)

| Method | Path                | Description                    |
|--------|---------------------|--------------------------------|
| GET    | /api/sites          | List all sites + status        |
| POST   | /api/sites          | Add a site `{name, url}`       |
| DELETE | /api/sites/:id      | Remove a site                  |
| POST   | /api/sites/:id/check | Manually check a site         |
| POST   | /api/check-all      | Trigger check for all sites    |

## Environment variables (backend)

| Variable           | Default | Description                          |
|--------------------|---------|--------------------------------------|
| PORT               | 4000    | API server port                      |
| DB_PATH            | ./data/uptime.db | SQLite database path        |
| CHECK_INTERVAL_MS  | 60000   | How often to ping sites (ms)         |

## Alerts (coming next)

To add Slack or email alerts when a site goes down, update the `ping()` function
in `backend/server.js` to compare the new result with the previous one and fire
a webhook if the status flipped from up → down.

Slack webhook example:
```js
if (wasUp && !result.up) {
  await axios.post(process.env.SLACK_WEBHOOK, {
    text: `🔴 *${site.name}* is DOWN — ${site.url}`
  });
}
```
