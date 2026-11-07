# Encrypted Cloudflare R2 backups

Off-site backups are **not active until the R2 settings below are configured in Railway**. Deploying the code alone does not create a bucket, store credentials, or claim that production data has been backed up. No backup data or recovery key belongs in GitHub.

## Connect storage, one step at a time

1. In the existing Cloudflare account, open **R2 Object Storage → Overview → Create bucket**. Use a dedicated bucket such as `churp-private-backups`, with a location appropriate for the congregation. Keep public access, r2.dev access and custom public domains disabled. Do not add a bucket lifecycle rule that deletes objects earlier than the app's retention policy.
2. Create an **R2 API token** with **Object Read & Write** permission scoped to this bucket only. Save its Access Key ID, Secret Access Key and S3 API endpoint privately. Churp needs upload, download, list, delete and multipart permissions; it does not need permission to make the bucket public. Cloudflare's R2 API token itself is not the S3 Secret Access Key. Cloudflare may require R2/billing activation; use its displayed pricing rather than assuming every pilot is free.
3. Generate a separate backup encryption key on a trusted computer with this repository installed:

   ```sh
   npm run backup -- generate-key --out /secure/path/churp.backup.key
   ```

   This writes 32 random bytes as 64 hexadecimal characters to a new owner-only file, without printing the secret. Save a copy in a password manager or another secure location outside Railway and R2. Losing this key makes these backups unreadable. It must differ from the application's vault master. The command refuses to overwrite an existing key.
4. In **Railway → Churp service → Variables**, enter these privately; never paste their values into a chat, issue or commit:

   | Variable | Value |
   | --- | --- |
   | `CHURP_BACKUP_ENABLED` | `true` |
   | `CHURP_BACKUP_ENDPOINT` | The account's HTTPS R2 S3 API endpoint |
   | `CHURP_BACKUP_BUCKET` | The private bucket name |
   | `CHURP_BACKUP_ACCESS_KEY_ID` | Bucket-scoped S3 Access Key ID |
   | `CHURP_BACKUP_SECRET_ACCESS_KEY` | Bucket-scoped S3 Secret Access Key |
   | `CHURP_BACKUP_ENCRYPTION_KEY` | The 64 hex characters from the saved backup key file |

   Optional settings: `CHURP_BACKUP_HOUR=2`, `CHURP_BACKUP_TIME_ZONE=America/Denver`, `CHURP_BACKUP_RETENTION_DAYS=30`, `CHURP_BACKUP_PREFIX=churp-backups/v1/`. Keep the existing app `DATA_DIR`, vault secret and push settings unchanged. Production uses a private HTTPS R2 endpoint; arbitrary HTTP destinations are rejected.
5. Redeploy. Keep the service running continuously and keep Railway App Sleeping/Serverless sleeping disabled. The first backup starts shortly after startup. Subsequent backups run daily at 02:00 in America/Denver by default; a skipped DST hour runs after the clock moves forward. Failures retry after 15 minutes. The schedule and last verified result persist across restarts.
6. Sign in as the Churp platform admin and open **Your corner → Account settings → Backups & recovery**. This section is hidden from ordinary users and Tree admins. Wait for **Backup verified** and a downloaded-and-verified timestamp, or use **Back up now**. A separate backup object and `.verified.json` receipt should appear in R2. The app displays failure/overdue status; it does not send automatic backup-failure emails or push alerts. Check it regularly or add external monitoring.

An incomplete setup leaves the app usable, with backups clearly unavailable. R2 credentials and the backup encryption key never appear in the status response. Preserve deployment secrets such as Resend credentials separately; backups intentionally do not export the whole environment.

## What a verified backup contains

Each `.churpbackup` is a versioned, gzip-compressed AES-256-GCM encrypted archive with a fresh nonce and authenticated header. A manifest records file lengths and SHA-256 hashes. The backup key is not stored in the archive.

The archive contains a consistent **online SQLite backup** of `gatherly.sqlite`, every upload indexed by that snapshot, the **effective original vault master**, and the current push key pair if configured. An environment-configured vault master takes precedence over a stale key file, just as it does in the app. Managed message keys, report-service keys, scheduled payloads and phone drafts must authenticate against the included vault master during verification. Push keys are checked as a matching key pair. Self-managed account private keys remain with users; the backup preserves their encrypted recovery material and public key history, and cannot replace their personal recovery key or approved device.

The app stays online. Uploads are immutable; files are copied from the database snapshot's index. If a file is incomplete, missing, unsafe or deleted during copying, the run fails and retains older backups. It does not publish a supposedly complete snapshot with missing attachments. Temporary plaintext snapshots and keys use private directories and owner-only files; normal completion/error removes them. An OS kill can leave private temporary files until the container is replaced; inspect and remove stale `churp-backup-*` work directories during incident cleanup. Allow temporary disk space for the snapshot, encrypted archive, downloaded copy and verification extraction, in addition to the live volume.

A separate worker process creates the archive, verifies its local restore, uploads it with multipart support, checks remote length/hash metadata, downloads it again, checks its SHA-256 and fully validates the downloaded archive. Only then does it write the verification receipt and record success. Retention runs afterward, defaults to 30 days, and keeps **at least seven verified generations** even if they are older than 30 days. Only the dedicated prefix and generated backup filenames are eligible for pruning. Incomplete/orphaned uploads do not count toward the seven verified copies. A pruning failure leaves the new verified backup intact and shows a warning. Worker crashes and redeploys leave previous copies untouched.

The job is serialized within the running app; avoid simultaneous out-of-band CLI runs. Failed verification never triggers retention. The worker has a two-hour timeout. Configure independent monitoring for a missed verified backup, and keep the volume and service available; there is no separate scheduler when the Railway service is asleep or stopped. Each backup is a full snapshot, so R2 storage and request usage grow with the app and retention count.

## Restore drill and production recovery

Use a trusted operator environment with Node 24 and this repository's dependencies. Work outside the Git repository. Retain the original backup key securely. Verification and restoration never start the app, deliver messages or overwrite live data.

Verify a downloaded archive:

```sh
npm run backup -- verify --file /secure/recovery/snapshot.churpbackup --key-file /secure/path/churp.backup.key
```

Or, when the private R2 environment variables are configured, use its exact generated object name:

```sh
npm run backup -- verify --object churp-backups/v1/EXACT_GENERATED_NAME.churpbackup --key-file /secure/path/churp.backup.key
```

A remote verify downloads from R2 and checks the stored checksum as well as archive authentication, paths, entry hashes, SQLite integrity/foreign keys, indexed uploads and recovery keys. For a full drill, restore into a **new, nonexistent folder**:

```sh
npm run backup -- restore --file /secure/recovery/snapshot.churpbackup --key-file /secure/path/churp.backup.key --to /secure/recovery/churp-restored
```

The restored folder has a `restore-review-required.json` marker. Both application startup and Railway deployment preparation refuse to use it until review is acknowledged. Old sign-in sessions and recovery/Google challenges are revoked, push subscriptions/queued alerts are removed, pending scheduled sends are held, recurring-send advancement is stopped, recurring phone drafts are paused and retired queued provider texts are canceled. Restoring cannot silently replay old scheduled messages. It does not alter the source database or current deployment.

Before using this data in production, reconcile **account deletions, parent-link removals, blocked conversations, membership/ownership changes, invitation revocations and review permissions that occurred after the snapshot**. These later changes are not present in an older backup. Use available current records, support/privacy request records and incident records; do not assume a backup is a zero-loss event journal. Resolve held scheduled sends individually and avoid duplicate sends after the recovery point. Keep the replacement offline if these questions remain unresolved.

After that review, record it explicitly:

```sh
npm run backup -- acknowledge-restore --data-dir /secure/recovery/churp-restored --reviewed-deletions-and-permissions
```

This rechecks SQLite, records `restore-reviewed.json` and removes the startup block. It does not reinstate revoked sessions or automatically resume held sends. Test selected Nest/private history and attachments using test accounts in an isolated deployment. Users with self-managed encryption still need the recovery key matching the snapshot’s identity, or an approved device retaining those keys; a newer key replacement may not unlock an older identity.

For a Railway recovery, use a stopped **replacement service and volume**, preserve the original service/volume and restore into a temporary operator folder first. After review, copy the complete reviewed folder contents (including vault/push key files) into the empty replacement volume mounted at `/data`, preserve private file permissions, and keep `DATA_DIR=/data`. Do not rename the mounted volume root or copy over a running service's data. Ensure any configured `CHURP_KEY_VAULT_SECRET` or VAPID variables match the restored originals; unrelated or newly generated keys will strand history or notifications. Then start the replacement, validate accounts/history/files and reconnect automatic backups before switching traffic. App-store readiness still requires the remaining launch steps.

## Key rotation and recovery boundaries

Keep old backup keys for as long as retained archives use them. Changing the backup encryption key only affects new archives; it does not re-encrypt previous ones. Test a fresh verified backup before retiring old keys. Do not rotate the app vault master as part of backup setup. Account deletion removes current personal data but does not rewrite historical backups; retention applies to those snapshots, and restores require reconciliation before going live. Manually created Railway snapshots and legacy `.bak` files follow their own retention policy.

Tests cover live restore of real signed/encrypted Nest/private messages and attachments, managed/self-managed keys, current push keys, corruption/wrong keys, path traversal, missing uploads, at-rest encryption, download verification before retention, S3 multipart uploads, schedule persistence/DST, operator-only controls and the restore startup block. They use isolated local fixtures rather than production credentials or data. A real R2 backup/restore drill remains necessary after the bucket is connected.
