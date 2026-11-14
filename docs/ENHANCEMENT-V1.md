# Hina Enhancement V1

Three incremental milestones on top of Foundation V1. No DB format reset, API key changes or additional LLM calls in the normal text path. Model routing remains configured by .env; use hina-chat as primary. New profile emotional fields migrate lazily and old code ignores additional fields.

| Phase | Implemented increment |
|---|---|
| 1 | Contextual brief replies, avoid repeated questions, ordinary short messages use model |
| 2 | Prioritized context budget and durable output contract |
| 3 | Recency-aware archive ranking, dates, user-reported provenance, no old assistant replies in archive |
| 4 | Gap-aware conversation and chronological interpretation |
| 5 | Independent concern/curiosity dynamics, bounded decay and migration |
| 6 | Canonical identity and values; independent opinions without coercion |
| 7 | Conservative social cues, space and advice preferences |
| 8 | Per-recipient contextual event selection, bounded repeat suppression, pause and existing opt-in safety |
| 9 | Synthetic benchmark runner and runtime route/latency observations |

## Evaluation

Run `npm test` without network calls. `npm run benchmark` lists the dry-run case count. Explicit live comparison: `npm run benchmark -- --live hina-chat cbai/glm-5.2 cbai/kimi-k2.6 cbai/deepseek-v4.1-flash ag/gemini-3.8-flash-low`. Each model uses nine API requests; charges and rate limits may apply. Use only permitted providers. JSONL results contain synthetic replies and rubric, not actual contact records. Automatic checks are surface heuristics, not validated naturalness or reasoning scores. Human review is required for each rubric; repeat across weeks and compare latency, failures and drift. The production log [AI_METRIC] reports returned upstream model when supplied by router; it is not proof of actual provider identity.

## Rollback

Keep your existing .env and data backups. Revert the enhancement commit(s), then allow normal deployment; migration adds fields only. Do not restore stale state merely to roll back code. Review prior DB backups before any manual restore.

## Limits

Phase 3 is lexical retrieval, not embeddings or full contradiction resolution. Proactive notifications are generic simulated interests only, not an owner-project content share or automatic promises. No new autonomous model calls. Phase 9 long-term quality is not established until actual measurements and review exist.
