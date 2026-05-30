# Deployment — Docker + nginx + GitHub Actions (HTTPS)

Architecture:

```
GitHub push (main)
   └─ GitHub Actions (.github/workflows/deploy.yml)
        ├─ build image  → Docker Hub: ashish8927/ecommerce-backend:latest
        └─ SSH to VPS   → docker compose pull + up -d

VPS (Hostinger, Ubuntu 24.04, 82.29.164.26)
   nginx (:443 TLS, Let's Encrypt for 82-29-164-26.nip.io)
     └─ proxy → api container (127.0.0.1:5000)  ──> MongoDB Atlas
                redis container (internal only)

Render static site (HTTPS frontend)  ──HTTPS──>  https://82-29-164-26.nip.io/api/v1
```

---

## A. GitHub repo secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `ashish8927` |
| `DOCKERHUB_TOKEN`    | Docker Hub access token (Read & Write) |
| `DEPLOY_HOST`        | `82.29.164.26` |
| `DEPLOY_USER`        | `root` |
| `DEPLOY_SSH_KEY`     | private SSH key whose public key is in the VPS `~/.ssh/authorized_keys` |

Generate a deploy key (on your machine), then add the public half to the VPS:
```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
# paste deploy_key.pub into the VPS ~/.ssh/authorized_keys
# paste the private deploy_key contents into the DEPLOY_SSH_KEY secret
```

---

## B. One-time VPS bootstrap (wipe + clean setup)

SSH in: `ssh root@82.29.164.26`

### 1. Tear down anything old
```bash
cd /opt/ecommerce-backend 2>/dev/null && docker compose -f docker-compose.prod.yml down -v 2>/dev/null
docker system prune -af            # remove old images/containers
sudo rm -rf /opt/ecommerce /opt/ecommerce-backend   # remove stale dirs
```

### 2. Install Docker + nginx + certbot (skip what's already present)
```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker            # ensures Docker starts on boot
```

### 3. Project dir + compose + env
```bash
sudo mkdir -p /opt/ecommerce-backend && cd /opt/ecommerce-backend
# copy docker-compose.prod.yml from the repo to here (scp, or paste it)
# create .env from deploy/env.prod.example and fill in REAL values:
nano .env        # set MONGO_URI, token secrets, Cloudinary, SMTP, CLIENT_URL, etc.
```
> `CLIENT_URL` MUST be `https://e-commerce-frontend-9vtd.onrender.com` (not localhost).

### 4. nginx + TLS
```bash
# copy deploy/nginx.conf to /etc/nginx/sites-available/default
sudo cp deploy/nginx.conf /etc/nginx/sites-available/default
sudo certbot --nginx -d 82-29-164-26.nip.io     # issues + wires the cert
sudo ufw allow 80,443/tcp 2>/dev/null || true
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Log in to Docker Hub + start
```bash
docker login -u ashish8927          # paste access token
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### 6. Verify
```bash
docker compose -f docker-compose.prod.yml ps          # both Up/healthy
curl https://82-29-164-26.nip.io/health               # {"status":"OK"} — no -k, trusted cert
```

---

## C. Day-to-day deploys

Just push to `main`. GitHub Actions builds, pushes, and redeploys automatically.
Manual redeploy on the VPS if ever needed:
```bash
cd /opt/ecommerce-backend
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## D. Survives reboots

- `restart: unless-stopped` on both services + `systemctl enable docker` means the
  stack auto-starts after any VPS reboot (the cause of the earlier downtime).
- The cert auto-renews (certbot installs a systemd timer).

## E. Cert renewal sanity check
```bash
sudo certbot renew --dry-run
```
