# Phases 5–7 — scaffolding (infra-gated)

These phases (face-match auto-sort, autonomous pipeline, AI portraits) can't be
built end-to-end or verified in this environment: they need a **deployed
InsightFace worker**, **pgvector on a running DB**, **API keys/secrets**, and a
**labeled calibration set**. What's delivered here is the reviewable groundwork
so the next implementer starts from contracts + schema, not a blank page.
Nothing here is wired into the app; **no migrations applied, no prod data
touched.**

Provider decision (confirmed): **`FACE_PROVIDER = insightface`** (self-hosted,
pgvector, no per-image vendor cost, photos stay on our infra).

## Delivered scaffolding

| File                                     | What                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/drafts/5.2_face_schema.sql`    | pgvector + `face_embeddings` (512-d, HNSW), `asset_guests` junction, guest `face_consent*`, event face settings. **Service-role only**, no anon/authenticated access. |
| `supabase/drafts/6.1_pipeline_jobs.sql`  | `pipeline_jobs` queue (FOR UPDATE SKIP LOCKED pattern), `events.pipeline_mode`, `assets.moderation`. Service-role only.                                               |
| `supabase/drafts/7.1_ai_generations.sql` | `ai_generations` + per-event AI toggle (default OFF), style prompt, per-guest cap, budget. Service-role only.                                                         |
| `src/lib/face/types.ts`                  | `FaceProvider` interface (`detectAndEmbed`, `matchGuest`) + types. Compiles.                                                                                          |
| `src/lib/ai/openrouter.ts`               | Server-only OpenRouter image call; `skipped` without `OPENROUTER_API_KEY`. Server-composed prompt + guest's own selfie only. Compiles.                                |
| `services/face-worker/`                  | FastAPI worker scaffold (`/health`, `/embed`), `FACE_SERVICE_SECRET` auth, requirements, Dockerfile. `/embed` inference is a TODO stub.                               |

## Hard prerequisites before implementing (unchanged)

1. Phase 0 merged + **deployed** + migrations **applied** (still pending — verify
   with `scripts/rls-check.mjs`, then apply).
2. Phase 3.2 consent live (done on this branch) — face adds a **separate**
   biometric opt-in on top.
3. Phase 1 delivery live (done) — required before 6.3 auto-delivery.
4. Apply `supabase/drafts/0.4.1_approved_only_media_read.sql` as part of Phase 5.

## Infra + secrets checklist

- Deploy `services/face-worker` (Fly.io/Railway/Hetzner, CPU); set
  `FACE_SERVICE_SECRET`. Implement `/embed` (SCRFD + ArcFace ONNX).
- Enable `vector` extension; apply the drafts as migrations.
- `OPENROUTER_API_KEY` + `IMAGE_MODEL` (default `google/gemini-3.1-flash-image`).
- Labeled calibration set (≥100 photos incl. hijab/varied lighting) to pick
  `auto_assign_threshold` / `review_threshold`; record the confusion matrix in a
  `PHASE5_NOTES.md`. Target auto-assign precision **≥99%** (false positives —
  someone else's photos in your gallery — are the trust-killer).

## Non-negotiable safety rails (from the spec)

- Embeddings are biometric: service-role only, deleted on consent revocation /
  guest deletion / event purge.
- Every AI feature per-event toggle default OFF; every face feature per-guest
  opt-in, unticked by default, separate AR/EN consent.
- AI generation uses the guest's **own** enrolled selfie only; prompt composed
  server-side (no guest free-text); every output through moderation before store.
- Face recognition uses the ArcFace-class model, **never** a vision LLM.
