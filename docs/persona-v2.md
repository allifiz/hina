# Hina Persona V2: natural chat, same character

This PR tunes Hina's conversational style for GPT-OSS through the existing 9Router API.

## Changes
- Add short, concrete Indonesian WhatsApp-style examples for banter, flirting, teasing, support, frustration, and explanations.
- Adapt style by message and user intent: `playful`, `supportive`, `informative`, `brief`, and `conversational`.
- Preserve existing owner/relationship, self-respect, mood, adult-mode, reminders, and factual/RAG behaviors.
- Put the mood tag at the **end**; the existing parser supports prefix and suffix tags.
- Remove the Qwen-only `/no_think` marker from the shared persona; the existing `local` provider still injects it when needed.
- Keep 9Router request payload minimal to avoid introducing unsupported sampling arguments.

## Preview on the Azure VPS without restarting WhatsApp

The commands below run a standalone model preview in a **separate Git worktree**. No systemd changes, no WhatsApp connection, and no database writes.

```bash
cd "$HOME/bot-hina"
git fetch origin feat/hina-natural-persona-v2
git worktree add --detach "$HOME/hina-persona-preview" origin/feat/hina-natural-persona-v2
ln -s "$HOME/bot-hina/node_modules" "$HOME/hina-persona-preview/node_modules"
ln -s "$HOME/bot-hina/.env" "$HOME/hina-persona-preview/.env"
cd "$HOME/hina-persona-preview"
node --test
node scripts/preview-persona.js "helo cantik"
node scripts/preview-persona.js "coba tebak aku siapa"
node scripts/preview-persona.js "aku capek banget hari ini"
```

Worktree folder is private under `$HOME` and the API key is referenced from the existing server `.env` (never copy it into Git). If the worktree already exists, inspect it first instead of overwriting it.

The preview uses a single-turn model call as owner "Allif". Real WhatsApp interactions also supply recent chat context, which may change the response. Each preview costs a 9Router provider request.

After review and merge, GitHub Actions on `main` will redeploy and restart `hina.service`.

## Behavior checklist
- Is the reply natural and short enough for WhatsApp?
- Does it react to teasing without falling into a formal assistant voice?
- Does it avoid repeating words/phrases from the few-shot examples verbatim?
- Does it respond empathetically to someone upset, without becoming excessively clingy?
- Does it preserve a firm tone when the relationship is cold/heated?
- Does it remain factual when using RAG/news, without inventing recent facts?

## Limitations
- No automatic way to guarantee a particular tone from GPT-OSS. The first test is prompt/routing logic only; human evaluation of real model replies is still needed.
- Chat memory is currently in-process and not durable across restarts; this PR intentionally does not change persistence.
- Voice notes, ASR/TTS, image, and WhatsApp authentication are unchanged.

## Preview a multi-turn conversation

Single-turn previews can miss awkward transitions. The new preview keeps assistant/user
history and the evolving mood in memory for the duration of the command, without
touching the live WhatsApp service or database.

Fetch the latest PR branch inside the existing preview worktree, then run:

```bash
cd ~/bot-hina
git fetch origin feat/hina-natural-persona-v2
git -C ~/hina-persona-preview switch --detach origin/feat/hina-natural-persona-v2
cd ~/hina-persona-preview
node --test
node scripts/preview-conversation.js "helo cantik" "ih kamu tuh nyebelin banget tau ga" "ahahah jangan ngambek dong" "hina, kalo kita jalan bareng kamu pengen kemana?"
```

Each turn calls 9Router once, and prior replies are sent back as context.
The preview simulates the owner relationship. It is **not** a replacement for
testing actual WhatsApp LID/relationship state and memory behavior.
