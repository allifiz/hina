# Hina on Azure: 9Router as primary chat model

The existing WhatsApp bot uses Baileys, persona/moods, memory, reminders, Google News RSS, and optional Tavily. This change **does not** replace the bot or its WhatsApp session: it adds 9Router as the first provider for **text chat**.

## Required environment variables

Edit the existing `.env` in the Azure deployment directory (never put the real key in Git):

```dotenv
NINEROUTER_API_KEY=your-key-from-9router-dashboard
NINEROUTER_BASE_URL=http://127.0.0.1:20128/v1
NINEROUTER_MODEL=ag/gpt-oss-120b-medium
LOCAL_MODEL_ENABLED=false
```

The URL assumes 9Router and Hina run on the **same Azure VM**. The model was verified with the 9Router chat completions API. Do not expose 9Router's port 20128 publicly.

Qwen and OpenRouter remain optional fallbacks when their credentials are configured. The old Qwen **ASR, TTS, vision, and image-generation** functions still require a working `QWEN_API_KEY`; GPT-OSS text chat does not replace those media endpoints. Incoming messages that match an instant-reply rule may intentionally be answered without calling any AI.

## Pre-deployment checks: do this before merging the PR

1. Check if Hina's systemd service still exists and determine the actual checkout directory:

```bash
systemctl is-active hina || true
systemctl is-enabled hina || true
systemctl show hina -p User -p WorkingDirectory -p ExecStart --no-pager
sudo systemctl status hina --no-pager
```

The GitHub workflow uses `AZURE_HOST`, `AZURE_USER`, `AZURE_SSH_KEY`, and `AZURE_APP_PATH` repository secrets, then runs `git fetch`, `git reset --hard origin/main`, `npm install --omit=dev`, tests, and `sudo -n systemctl restart hina`. Its most recent run on September 8, 2026 succeeded; **that does not verify that the secrets, SSH access, or service still work today**.

2. Back up the current `.env`, WhatsApp auth folder (`auth_info_baileys`), and `database.json` on the VPS before any deployment. Preserve file permissions, and do not share the backup or commit these files.

3. **Important:** `database.json` is currently tracked by Git. The workflow's `git reset --hard` can overwrite runtime changes to user profiles or reminders. To keep the live database outside the checkout, create a private directory and copy the latest VPS database into it. **When you are ready to merge**, briefly stop Hina with `sudo systemctl stop hina` before making the final copy, so new messages cannot alter the source database during cutover. Keep the backup, then complete the `.env` update and merge promptly. If deployment fails, restore the backup and recover the systemd service before accepting more messages. Use the correct deployment directory first:

```bash
APP_DIR="$(systemctl show hina -p WorkingDirectory --value)"
printf 'Deployment directory: %s\n' "$APP_DIR"
# Confirm the directory before using it:
test -n "$APP_DIR" && test -d "$APP_DIR/.git" || { echo "Check the systemd WorkingDirectory first"; exit 1; }
mkdir -p "$HOME/hina-data"
chmod 700 "$HOME/hina-data"
cp -p "$APP_DIR/database.json" "$HOME/hina-data/database.json"
chmod 600 "$HOME/hina-data/database.json"
```

Then add `DB_FILE=/home/azureuser/hina-data/database.json` to the **server's** `.env` (adjust the absolute path if the service runs under another user). The new code supports this optional `DB_FILE` override; the old default stays `./database.json` for backwards compatibility. This relocation must happen before relying on the new deployment to protect mutable data.

4. Confirm 9Router still answers on `127.0.0.1:20128` from the VPS. Verify that the systemd service's user can read the Hina `.env`. Never paste API keys, WhatsApp credentials, or `systemctl cat` output containing secrets into chat.

## WhatsApp session repair (November 13, 2026)

The existing `hina.service` was looping on Baileys `DisconnectReason.loggedOut` (401), repeatedly reconnecting with invalid saved credentials. Its systemd `Restart=always` caused a persistent restart loop even when Node.js exited successfully.

Before reconnecting, **stop the service**, preserving its auth folder and database:

```bash
sudo systemctl stop hina
sudo systemctl reset-failed hina
cd /home/azureuser/bot-hina
umask 077
BACKUP="$HOME/hina-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
cp -a .env database.json auth_info_baileys "$BACKUP/"
chmod 600 .env
chmod -R go-rwx auth_info_baileys "$BACKUP"
```

Reduce the risk of future 401 loops by configuring systemd to restart Hina on *failures* only, not successful logout exits. This override persists independently of Git deployments:

```bash
sudo mkdir -p /etc/systemd/system/hina.service.d
printf '[Service]\nRestart=on-failure\n' | sudo tee /etc/systemd/system/hina.service.d/restart.conf
sudo systemctl daemon-reload
systemctl show hina -p Restart
```

Check **WhatsApp → Linked devices** on the phone. If Hina is unlinked, the old saved credentials cannot work. To safely force a new QR (after backing up), move the stale auth folder instead of deleting it:

```bash
cd /home/azureuser/bot-hina
mv auth_info_baileys "$BACKUP/auth_info_baileys-stale"
node index.js
```

The `auth_info_baileys-stale` destination must not already exist. QR appears directly in the interactive SSH terminal; scan from the phone's Linked devices screen. After `connection === open`, stop the manual process (Ctrl+C), then `sudo systemctl start hina`. Check status/logs and keep only one instance connected.

This PR also changes `shouldSyncHistoryMessage`: do not blanket-disable initial LID mappings. It allows the essential small sync types but still excludes `FULL` history sync on low-RAM Azure.

## Test and deploy

Run in a local checkout or the Azure deployment directory:

```bash
npm install
npm test
node --check index.js
```

Review and merge the PR only after the pre-deployment checks. A push to `main` triggers `.github/workflows/deploy.yml`; a push to this feature branch does **not**.

After merging, use **Actions** to check whether the new workflow actually succeeded. On Azure:

```bash
sudo systemctl status hina --no-pager
sudo journalctl -u hina -n 50 --no-pager
curl -sS -o /dev/null -w '9Router HTTP %{http_code}\n' http://127.0.0.1:20128/dashboard
free -h
```

The 9Router HTTP 307 redirect to `/login` is normal. Hina must remain the single bot instance (systemd, **not** a second PM2 bot). If the bot's saved session is intact, Baileys should reconnect without scanning a new QR code.

## Current limitations and security

- Text chat uses 9Router as the priority; Google News RSS/Tavily enrich current-events answers before model generation.
- Gemini/Claude via Antigravity were returning 404 in the VPS setup, so only the verified `ag/gpt-oss-120b-medium` model is configured.
- Hina's repository is public and currently tracks a `database.json` snapshot and contains hard-coded user identifiers in `config.js`. Review and remove personal information from public Git history as a separate cleanup. Keep production secrets outside Git.
- `whatsapp-web.js` remains in dependencies, but the current runtime uses Baileys. A dependency cleanup can be done separately after first deployment.
