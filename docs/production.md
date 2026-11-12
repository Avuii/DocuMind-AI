# Production deployment

This configuration targets a single Linux host running Docker Engine, Docker Compose and Nginx. Nginx serves the regular React build and proxies the API on the same HTTPS origin. PostgreSQL and OCR have no published host ports. The API binds to host loopback and trusts one configured proxy IP. The Docker volumes hold PostgreSQL data, original documents, session signing keys and the OCR model cache.

## Configure the host

Create DNS for your hostname and install a TLS certificate with automated renewal. Restrict inbound access to the intended users. The application allows account registration to anyone who can reach it, so a private installation should sit behind a VPN or an authenticated access gateway.

```sh
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
```

Set `DOCUMIND_HOST` and copy the generated value into `DOCUMIND_DATABASE_PASSWORD`. A hexadecimal password avoids connection string delimiters. Optional GUS and CEIDG credentials go in the same protected file. Restrict Docker administrator access because Docker exposes container environment variables to administrators. Keep the configuration and secrets in your backup system. The supplied default proxy IP is the Linux Compose gateway on the outbound network. Set `DOCUMIND_PROXY_IP` to the address the API sees if your proxy topology differs. [Microsoft guidance on trusted proxies](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/8/forwarded-headers-unknown-proxies).

Use a consistent Compose project name. Validate configuration without printing the resolved credentials, bring up the dependencies, then run migrations as a separate step:

```sh
docker compose --env-file .env.production -p documind-prod -f compose.production.yml config --quiet
docker compose --env-file .env.production -p documind-prod -f compose.production.yml up -d --wait db ml-service
docker compose --env-file .env.production -p documind-prod -f compose.production.yml build backend
docker compose --env-file .env.production -p documind-prod -f compose.production.yml run --rm --no-deps -e Database__MigrateOnly=true backend
docker compose --env-file .env.production -p documind-prod -f compose.production.yml up -d backend
curl --fail http://127.0.0.1:8080/health/ready
```

The first OCR startup needs outbound access to fetch models. Registry lookups need outbound HTTPS from the API. The backend runs with an unprivileged account and a read-only root filesystem. Docker mounts writable volumes for originals and session keys and a temporary filesystem for request buffering.

## Serve the frontend and API

Run `npm ci` and `npm run build` in `frontend/`, then copy the **contents** of `frontend/dist/` to `/srv/documind/www`. Publish those files with Nginx. Replace the example host and certificate paths and install this configuration inside the Nginx `http` context, for example under `/etc/nginx/conf.d/`.

```nginx
limit_req_zone $binary_remote_addr zone=documind_auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=documind_registry:10m rate=30r/m;

server {
    listen 80;
    server_name documind.example.com;
    return 308 https://documind.example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name documind.example.com;
    ssl_certificate /etc/letsencrypt/live/documind.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/documind.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;

    root /srv/documind/www;
    index index.html;
    client_max_body_size 32m;
    limit_req_status 429;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;

    location ~* ^/api/registries/lookup/?$ {
        limit_req zone=documind_registry burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }

    location ~* ^/api/auth/(login|register|reset-password|recovery-code)/?$ {
        limit_req zone=documind_auth burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Run `nginx -t` before reloading. From a browser, sign in over HTTPS, refresh a nested route, and upload a synthetic scan. Verify that the session cookie is marked Secure, the extraction completes and the export works. A repeated HTTPS redirect usually means that the configured trusted proxy IP differs from Kestrel's immediate peer. Set the exact observed address before opening access.

## Operate and recover

- Monitor `/health/live` on host loopback for the API process and `/health/ready` for PostgreSQL and the OCR service. Optional registries are independent of readiness. Alert on consecutive readiness failures, slow or failed document processing, and low free space on the storage host.
- Keep a matching PostgreSQL backup and a snapshot of original documents and session keys. Pause writes or stop the backend and worker during the snapshot if the storage and database backup are taken separately. Encrypt backups, restrict access and test a restore on an isolated host. Losing session keys invalidates existing sessions and can affect outstanding recovery flows.
- Back up before each migration. Record the deployed source revision and image digests. During a schema change, stop the old backend before running the migration command and start the new revision afterward. Roll back by restoring compatible application images and the matching database and file snapshot if the new schema is incompatible.
- Apply updates to base images and dependencies on a regular schedule. Verify updated builds with the OCR regression suite and registry simulations before replacing the deployed revision. Limit log retention and keep access to service logs and backups restricted.
- This setup uses one worker and local volumes. Multiple hosts require coordinated worker claims, shared originals and a shared key ring. Plan those changes before scaling beyond the single-host deployment.
