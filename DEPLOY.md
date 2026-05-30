# Hostinger KVM2 Deployment

This backend is ready for a Docker-based Linux VPS deployment:

- Node app runs inside Docker on port `5000`
- Redis runs as a private Docker service
- nginx handles public HTTPS on ports `80` and `443`
- GitHub Actions builds the image, pushes it to Docker Hub, then restarts the VPS container
- MongoDB should be MongoDB Atlas or another external MongoDB connection string

Replace these placeholders before running commands:

- `<VPS_IP>`: your Hostinger VPS public IP
- `<API_DOMAIN>`: your API domain, for example `api.example.com`
- `<DOCKERHUB_USERNAME>`: your Docker Hub username
- `<FRONTEND_URL>`: your live frontend URL, for example `https://your-frontend.onrender.com`

If you do not have a domain yet, you can use nip.io with your VPS IP:

```bash
<VPS_IP_WITH_DASHES>.nip.io
```

Example: `82.29.164.26` becomes `82-29-164-26.nip.io`.

## 1. Local Files To Check

Required files are already present:

- `Dockerfile`
- `docker-compose.prod.yml`
- `deploy/nginx.conf`
- `deploy/env.prod.example`
- `.github/workflows/deploy.yml`
- `.dockerignore`

Before deploy, edit these values:

- `docker-compose.prod.yml`: set `image:` to `<DOCKERHUB_USERNAME>/ecommerce-backend:latest`
- `.github/workflows/deploy.yml`: set the Docker tag to the same image
- `deploy/nginx.conf`: replace `82-29-164-26.nip.io` with `<API_DOMAIN>`

Commit and push after editing:

```bash
git add Dockerfile docker-compose.prod.yml deploy/nginx.conf deploy/env.prod.example .github/workflows/deploy.yml DEPLOY.md server.js
git commit -m "Prepare production deployment"
git push origin main
```

## 2. Create GitHub Secrets

Open your GitHub repo:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

Add:

```text
DOCKERHUB_USERNAME=<DOCKERHUB_USERNAME>
DOCKERHUB_TOKEN=<Docker Hub access token with read/write access>
DEPLOY_HOST=<VPS_IP>
DEPLOY_USER=root
DEPLOY_SSH_KEY=<private SSH key for the VPS>
```

Create a deploy SSH key on your local machine:

```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
```

Copy the public key to the VPS:

```bash
ssh-copy-id -i deploy_key.pub root@<VPS_IP>
```

Put the private key content into GitHub secret `DEPLOY_SSH_KEY`:

```bash
cat deploy_key
```

## 3. Bootstrap The VPS

SSH into Hostinger:

```bash
ssh root@<VPS_IP>
```

Update Linux and install Docker, nginx, and certbot:

```bash
apt update
apt upgrade -y
apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx ufw
systemctl enable --now docker
systemctl enable --now nginx
```

Create the app directory:

```bash
mkdir -p /opt/ecommerce-backend
cd /opt/ecommerce-backend
```

Copy production files from your computer to the VPS:

```bash
scp docker-compose.prod.yml root@<VPS_IP>:/opt/ecommerce-backend/docker-compose.prod.yml
scp deploy/env.prod.example root@<VPS_IP>:/opt/ecommerce-backend/.env
scp deploy/nginx.conf root@<VPS_IP>:/etc/nginx/sites-available/default
```

Back on the VPS, edit the env file:

```bash
nano /opt/ecommerce-backend/.env
```

Required production values:

```text
PORT=5000
NODE_ENV=production
MONGO_URI=<MongoDB Atlas connection string>
ACCESS_TOKEN_SECRET=<long random secret>
REFRESH_TOKEN_SECRET=<long random secret>
CLOUDINARY_CLOUD_NAME=<cloudinary cloud name>
CLOUDINARY_API_KEY=<cloudinary api key>
CLOUDINARY_API_SECRET=<cloudinary api secret>
SMTP_USER=<email user>
SMTP_PASS=<email app password>
RAZORPAY_KEY_ID=<razorpay key id>
RAZORPAY_KEY_SECRET=<razorpay key secret>
GOOGLE_CLIENT_ID=<google client id, if Google login is enabled>
CLIENT_URL=<FRONTEND_URL>
```

Generate strong secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

## 4. Configure nginx And HTTPS

Edit nginx if needed:

```bash
nano /etc/nginx/sites-available/default
```

Make sure `server_name` is your API domain:

```nginx
server_name <API_DOMAIN>;
```

Test nginx:

```bash
nginx -t
systemctl reload nginx
```

Allow web traffic:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Create the SSL certificate:

```bash
certbot --nginx -d <API_DOMAIN>
```

## 5. Start The App

Log in to Docker Hub on the VPS:

```bash
docker login -u <DOCKERHUB_USERNAME>
```

Start the stack:

```bash
cd /opt/ecommerce-backend
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Check containers:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

Test the API:

```bash
curl http://127.0.0.1:5000/health
curl https://<API_DOMAIN>/health
```

Expected result:

```json
{"status":"OK"}
```

## 6. Automatic Deploys

After the first VPS setup, deploys are automatic:

```bash
git add .
git commit -m "Update backend"
git push origin main
```

GitHub Actions will:

1. install dependencies
2. run syntax checks
3. build the Docker image
4. push the image to Docker Hub
5. SSH into the VPS
6. run `docker compose pull && docker compose up -d`

Manual redeploy command:

```bash
ssh root@<VPS_IP>
cd /opt/ecommerce-backend
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## 7. Useful Debug Commands

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 api
docker compose -f docker-compose.prod.yml logs --tail=100 redis
docker restart ecommerce-backend-api-1
nginx -t
systemctl status nginx
certbot renew --dry-run
```
