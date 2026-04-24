#!/bin/bash
apt-get update
apt-get install -y docker.io git curl nginx
curl -L "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
systemctl enable docker
systemctl start docker
cd /opt
git clone https://github.com/Kamva-pro/uptime-monitor.git
cd uptime-monitor
docker-compose up -d --build

cat << 'NGINX_CONF' > /etc/nginx/sites-available/uptime.dynamite.agency
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    location /api/ {
        proxy_pass         http://localhost:4000/;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
NGINX_CONF

rm /etc/nginx/sites-enabled/default
ln -s /etc/nginx/sites-available/uptime.dynamite.agency /etc/nginx/sites-enabled/
systemctl restart nginx
