# Hina: ERNIE-first 9Router + Persistent Memories

## Release scope

- Use `openrouter/baidu/ernie-5.5-flash-preview:free` as the **default** primary route.
- Use `ag/gpt-oss-120b-medium` as 9Router fallback for model access errors, rate limits, empty responses, and transient network failures.
- When ERNIE returns 429/402 it is bypassed for 30 minutes; 403/404 bypasses it for 60 minutes. This is a process-local cooldown, not a promise of provider availability or infinite quota.
- Persist each WhatsApp sender's text conversation and last mood to `DB_FILE`, preserving existing profiles and reminders.
- Maintain last 160 messages per sender by default, send the latest 10 to the AI, and retrieve at most 3 older exchanges on keyword overlap.
- Allow the user to explicitly save facts beyond the 160-message archive through `/ingat`; `/lupa` removes them.
- No voice-note work in this release.

## Configure 9Router

9Router's OpenRouter connection must be enabled and the ERNIE model must actually appear in `GET /v1/models`. It was tested successfully on the owner's server before the release.

On Azure, existing `.env` with `NINEROUTER_MODEL=ag/gpt-oss-120b-medium` is safe: the new `NINEROUTER_PRIMARY_MODEL` defaults to ERNIE, while `NINEROUTER_MODEL` stays as backward-compatible extra fallback.

Optional explicit settings (put in `/home/azureuser/bot-hina/.env`, not in Git):

```dotenv
NINEROUTER_PRIMARY_MODEL=openrouter/baidu/ernie-5.5-flash-preview:free
NINEROUTER_FALLBACK_MODELS=ag/gpt-oss-120b-medium
NINEROUTER_MODEL=ag/gpt-oss-120b-medium
LOCAL_MODEL_ENABLED=false
DB_FILE=/home/azureuser/hina-data/database.json
MEMORY_MAX_MESSAGES=160
```

The primary model is always **tried first** after its cooldown expires. `/status` prints the configured primary; journal entries `Balasan dibuat via...` identify the model actually used for each response. `/model` shows model order.

OpenRouter's `:free` designation does not mean unlimited; if exhausted, fallback may still work through the other 9Router provider, assuming that provider is available.

## User memory commands

- `/ingat`: list saved facts for this WhatsApp sender.
- `/ingat aku suka lukisan bulan`: save one fact (up to 180 characters, up to 20 facts per sender).
- `/lupa bulan`: remove remembered facts containing `bulan`.
- `/lupa semua`: clear **only** this sender's explicit fact notes.
- `/resetme`: erase **both** this sender's rolling chat history and explicit notes. Profiles/reminders stay untouched.

Old chats are retrieved by lightweight word matching, **not** embeddings or automatic AI summaries. Older than `MEMORY_MAX_MESSAGES` is dropped from chat history unless explicitly saved as a fact. The memory system makes no extra model API calls.

## Data storage, privacy, and migration

The existing JSON `DB_FILE` is extended in-place with `chatHistories` and `memoryNotes` keys; old data with only `userProfiles` and `reminders` loads without migration scripts. The saved file is written into a temporary sibling and atomically renamed, mode `0600`.

The bot saves **private WhatsApp conversation text** as plaintext JSON locally on Azure. Keep `$HOME/hina-data` permissions restricted and do not commit or publicly upload the file. Users can delete stored conversation data using `/resetme`; the operator should secure or regularly rotate the backup files as well. Backups contain messages and may retain deleted records until separately purged by the operator.

Deployment workflow first backs up `.env`, `auth_info_baileys/`, `database.json`, and the known external path `$HOME/hina-data/database.json` if present. The external backup is stored at `$HOME/hina-backups/deploy-*/database-external.json`. It is not automatically restored, because doing so could overwrite newer conversation writes.

## Tests and rollout

Pull-request CI installs npm dependencies on Node 22 and runs `npm test`, including model 429 fallback, mood logic, legacy JSON migration, persisted memory recovery after simulated module reload, bounded archive and per-sender isolation. Tests do not call 9Router or WhatsApp.

Once merged to `main`, the existing GitHub Action deploys and restarts `hina.service`. It waits 8 seconds and fails if systemd reports the service inactive.

On the Azure host, inspect:

```bash
sudo systemctl is-active hina
sudo journalctl -u hina -n 100 --no-pager
```

Expected startup label: `9Router -> openrouter/baidu/ernie-5.5-flash-preview:free`.

Send WhatsApp messages, then verify `Balasan dibuat via 9Router (openrouter/baidu/ernie-5.5-flash-preview:free)` and that the reply arrived. Test `/ingat`, `/lupa`, and restart persistence with a **non-sensitive** test fact.

If reverting the application to an older code version, be careful: older `saveDatabase` functions do not preserve `chatHistories` / `memoryNotes`. Back up the external DB first, and restore the newer DB when returning to the memory-enabled version.
