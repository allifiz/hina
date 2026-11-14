# Hina Enhancement V1.1 Polish

Based on 36 single-turn benchmark responses. Removes hard-coded owner name from persona, accepts curiosity mood and common aliases, grounds bounded per-contact memory, and improves Indonesian-first language guidance and relevance. Missing mood tags use application-side emotional state. Recent simulated reflections get earlier context priority; life context caps vary by topic. Reasoning guidance is prompt-based, not a provider-specific reasoning mode.

## Commands

- `npm test` (offline)
- `npm run benchmark` (no provider calls)
- `npm run benchmark -- --live hina-chat` (9 independent API calls)
- `npm run benchmark -- --multi hina-chat` (7 sequential API calls, generated responses fed back through real lexical retrieval and emotional state)

Specify additional tested model IDs to compare. Synthetic contacts only, no production DB writes, no WhatsApp messages. No additional unattended LLM calls. The multi-turn benchmark does not cover Baileys, provider failover, all life engines or actual user histories. Human review remains necessary. Token savings and model behavior improvements must be measured; prompt changes cannot guarantee zero identity hallucinations.

Rollback: revert the polish commits; .env and database schema unchanged.
