# Deploy Gatherly on Railway

The repository contains a Dockerfile and `railway.json`. Railway builds the frontend and starts the production Node server together. Google Sign-in is optional; username/password messaging works without external credentials.

## First deployment

1. Connect Railway's GitHub App to `dustinfausett/Gatherly`. In Railway, create a project from that repository and select the `main` branch. Review your Railway plan and charges before launching a service; no particular free allowance or monthly cost is assumed here.
2. Attach a **Volume** to the Gatherly service, mounted at **`/data`**. Railway's first build may finish before the Volume is added. Gatherly intentionally refuses to start on Railway without a Volume so accounts, messages, uploads, and push keys cannot silently disappear on redeploy.
3. Redeploy the service after attaching the Volume. The Docker image already supplies `NODE_ENV=production`, `DATA_DIR=/data`, and `TRUST_PROXY=1`. Railway supplies the listening `PORT`. Use **one replica** because this version uses SQLite and local event streams.
4. In the service's **Settings → Networking**, generate a public domain. If Railway asks for a target port, use the listening `PORT` from the service logs (default `3000`). Railway provides HTTPS for the generated domain.
5. Redeploy after generating the domain. The app derives `APP_URL` from Railway's `RAILWAY_PUBLIC_DOMAIN`, and creates private push-signing keys once on the persistent Volume. Open the generated HTTPS domain and create your account. The first user must still create a Community; no public admin account is preinstalled.

The app is ready to serve when Railway's deployment health check to `/api/health` succeeds. Validate it by registering, creating a Community/Subcommunity/Group, sending a message, and inviting another account. Redeploy once and confirm the same account and messages remain.

To test the production container locally before deploying:

```sh
docker build -t gatherly:railway-test .
node tests/container-smoke.mjs
```

The smoke check uses a temporary Docker Volume and removes its own containers and Volume afterward. It exercises real registration, secure cookies, messages, file uploads, reverse-proxy headers, and preservation of sessions, messages, files, and push keys after replacing the container.

## Optional settings

- **Custom domain:** set `APP_URL` to the full HTTPS origin, such as `https://chat.example.com`. For push, set `VAPID_SUBJECT` to a public HTTPS contact URL or a `mailto:` address. This setting can also be used with Railway's generated domain.
- **Google:** create a Google OAuth Web client, add the exact HTTPS app origin to authorized JavaScript origins, and set `GOOGLE_CLIENT_ID` in Railway's Variables. Restart/redeploy the service. No Google client secret is required.
- **Push:** users opt in through their profile. Keys are retained in `/data/push-keys.json`; do not delete or replace them on redeploy. If supplying existing keys instead, set both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` securely in Railway Variables and set `VAPID_SUBJECT`. Never paste private keys into chat or commit them.

## Keep data safe

Retain the Volume when changing or redeploying the service. Back up the entire `/data` directory, including SQLite and its WAL files, `uploads/`, and `push-keys.json`. A simple consistent backup stops the app before copying the directory. Do not place real data on a service without a Volume or increase replica count on this SQLite version.

## Troubleshooting

- **“Failed to fetch repository files”**: confirm the repository has a pushed `main` branch and that Railway's GitHub App has access to it. Changes in a Codex workspace do not reach GitHub until committed and pushed. After the first push, use Railway's repository-picker Refresh button.
- **“Attach a Railway Volume”**: attach the Volume at `/data` and redeploy. Volume storage is necessary before this app can accept real user data.
- **“DATA_DIR must match”**: keep `DATA_DIR` and the Volume mount path at `/data`.
- **Build is healthy but no website link**: generate a public domain in the service's Networking settings.
- **Sign-in works, Google does not**: username/password and Google setup are independent. Check `GOOGLE_CLIENT_ID`, the Google consent screen/test users, and the exact authorized JavaScript origin.
- **Push is unavailable**: after generating the Railway domain, redeploy and check that it is HTTPS. Opt in using a supported browser. iPhone/iPad require adding the app to the Home Screen. Actual device delivery must be tested after deployment.
