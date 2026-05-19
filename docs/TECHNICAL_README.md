# Chicago Formula — Technical Documentation

This document is the **developer-facing** reference for the web repository.

---

## Table of contents

1. [System overview](#system-overview)
2. [Teach vs Tell vs Portal](#teach-vs-tell-vs-portal)
3. [Repository layout](#repository-layout)
4. [Shared code (source of truth)](#shared-code-source-of-truth)
5. [Local development](#local-development)
6. [Deployment](#deployment)
7. [Authentication and participant codes](#authentication-and-participant-codes)
8. [Backend API](#backend-api)
9. [Tell (Interactive Narrative Version)](#tell-interactive-narrative-version)
10. [Teach (Traditional Version)](#teach-traditional-version)
11. [Portal (study entry)](#portal-study-entry)
12. [Character messages and scripted content](#character-messages-and-scripted-content)
13. [LLM prompts and AI services](#llm-prompts-and-ai-services)
14. [Predefined responses](#predefined-responses)
15. [Testing and QA tools](#testing-and-qa-tools)
16. [Data storage (Google Cloud Storage)](#data-storage-google-cloud-storage)
17. [Further reading in this repo](#further-reading-in-this-repo)

---

## System overview

Chicago Formula is a research web platform for English writing practice built around a shared detective narrative. Three deployable surfaces share one backend:

| Surface | Role | Production URL (default) |
|---------|------|---------------------------|
| **Tell** | Interactive Narrative Version — chat with AI characters, evidence, accusations | https://chicago-formula-n.web.app/ |
| **Teach** | Traditional Version — weekly reading + writing exercises on the same story | https://chicago-formula-t.web.app/ |
| **Portal** | Consent, onboarding questionnaire, stratified assignment to Tell or Teach | https://chicago-formula.web.app/ |

**Backend:** FastAPI on Google Cloud Run (`teach-tell-backend`), Python 3.11, shared by Tell and Teach.

**LLM:** Groq API, model `llama-3.3-70b-versatile` (character dialogue, tutor explain/feedback, Teach writing correction).

**Persistence:** Google Cloud Storage (game state, chat logs, language progress, study onboarding exports). Google Secret Manager for `groq-api-key` and `gcs-bucket-name`.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Portal    │     │    Tell     │     │    Teach    │
│  (static)   │     │  (static)   │     │  (static)   │
│ Firebase    │     │ Firebase    │     │ Firebase    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           ▼
              ┌────────────────────────┐
              │  shared/backend (API)  │
              │  Cloud Run + Groq + GCS  │
              └────────────────────────┘
```

---

## Teach vs Tell vs Portal

These are **not** two skins of the same UI — they are different game experiences for the experiment.

### Tell — Interactive Narrative Version

- Real-time **chat** with suspects and Nina (detective guide).
- **Public** vs **private** conversation modes, evidence examination, multi-episode progression (4 stages).
- **LLM-generated** character replies with system prompts per character, episode, and location.
- **Predefined responses** for scripted beats (topic keywords, ordered sequences).
- **Tutor:** word explanations, silent analysis of player messages, progress report.
- **Onboarding inside the game:** consent flow, CEFR level (A2/B1/B2), case intro via scripted `game_texts`.
- Uses almost exclusively **`/api/game/*`** endpoints.

### Teach — Traditional Version

- **Weekly structure** (4 weeks): story blocks (markdown) + exercises (markdown + interactive renderers).
- **No character chat.** Writing tasks, gap-fills, matching, drag-and-drop suspects, etc.
- Optional **LLM feedback** on open-ended writing via `/api/teach/open-ended-response` and final summary via `/api/teach/final-summary`.
- Progress stored locally (`teach_mode_progress_v1`) and synced to backend via `/api/teach/state`.
- Pre-game questionnaire link is embedded in Teach welcome copy (Google Forms); Portal handles study stratification separately.

### Portal

- Ethics/consent UI (EN/IT), language learner profile questionnaire.
- Calls `/api/study/questionnaire` and `/api/study/onboarding` to compute CEFR band and assign **arm**: `tell` (experimental) or `teach` (control).
- Redirects participant to the correct Firebase-hosted app with their code.

**Research mapping** (see `shared/backend/study_onboarding.py`): experimental arm = Tell, control arm = Teach.

---

## Repository layout

```
web_teach_and_tell/
├── shared/
│   ├── frontend/          # Source of truth for Teach/Tell shared UI (auth, API client, explain, CSS)
│   └── backend/           # FastAPI app, prompts, game_texts, images, AI logic
├── Tell/frontend/         # Tell-specific JS + copy of shared/frontend → shared/
├── Teach/frontend/        # Teach-specific JS, data/, week markdown at Teach/
├── Portal/frontend/       # portal.html, i18n, consent forms
├── docs/                  # Images + this file
├── Dockerfile             # Cloud Run image (shared/backend)
├── deploy.sh              # Interactive deploy menu
├── dev-local.sh           # Local stack: API + 3 static servers
└── README.md              # General audience (do not replace with this file)
```

**Do not edit** `Tell/backend/prompts/**` or `Teach/backend/prompts/**` if present — prompts live under `shared/backend/prompts/`.

---

## Shared code (source of truth)

| Copy (deploy overwrites) | Edit here |
|--------------------------|-----------|
| `Teach/frontend/shared/**` | `shared/frontend/**` |
| `Tell/frontend/shared/**` | `shared/frontend/**` |

`deploy.sh` and `dev-local.sh` run `rsync`-style copy from `shared/frontend` into both app frontends. Local edits under `Teach/frontend/shared/` are lost on sync unless moved upstream.

Shared frontend modules include:

- `shared/frontend/js/config.js` — `sharedConfig.resolveApiBase()` (localhost vs production API URL)
- `auth-session.js`, `api-client.js`, `explain-client.js`, `ui-shared.js`, `highlights.js`
- `shared/frontend/css/styles.css`

---

## Local development

### Prerequisites

- Python 3.11+
- `gcloud` CLI (only for deploy / GCS with credentials)
- Optional: Firebase CLI for hosting deploys

### One-command stack

```bash
./dev-local.sh
```

| Service | URL |
|---------|-----|
| Portal | http://127.0.0.1:3080/portal.html |
| Tell | http://127.0.0.1:3081/ |
| Teach | http://127.0.0.1:3082/ |
| API docs | http://127.0.0.1:8000/docs |

```bash
./dev-local.sh stop      # stop all
./dev-local.sh status    # PIDs
./dev-local.sh sync      # only sync shared/frontend
./dev-local.sh --no-sync # start without copying shared assets
```

Environment overrides: `DEV_API_PORT`, `DEV_PORTAL_PORT`, `DEV_TELL_PORT`, `DEV_TEACH_PORT`.

- Creates `.venv` at repo root and installs `shared/backend/requirements.txt`.
- Sets `SKIP_GCS=1` by default so local runs work without GCS credentials (game state / logs may not persist).

### Manual backend only

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r shared/backend/requirements.txt
export PYTHONPATH="$(pwd)"
export SKIP_GCS=1   # optional
uvicorn shared.backend.main:app --reload --host 127.0.0.1 --port 8000
```

Frontends: serve `Tell/frontend`, `Teach/frontend`, or `Portal/frontend` with any static server on ports matching CORS entries in `shared/backend/main.py`.

### API base URL

Both `Tell/frontend/js/config.js` and `Teach/frontend/js/config.js` use `sharedConfig.resolveApiBase()`:

- **Localhost:** `http://localhost:8000`
- **Production:** Cloud Run URL (see config files; update when redeploying backend)

---

## Deployment

### `deploy.sh` (interactive)

```bash
./deploy.sh
```

Menu options: backend (Cloud Run), Tell frontend, Teach frontend, Portal frontend, or all.

Non-interactive example:

```bash
DEPLOY_BACKEND=true DEPLOY_TELL_FRONTEND=true SKIP_SYNC_CONFIRM=true ./deploy.sh
```

Firebase hosting targets (defaults):

| App | `firebase.json` site |
|-----|----------------------|
| Portal | `chicago-formula` |
| Tell | `chicago-formula-n` |
| Teach | `chicago-formula-t` |

Backend: `gcloud run deploy teach-tell-backend` in `europe-west4`, image `gcr.io/$PROJECT_ID/teach-tell-backend`, built from repo root `Dockerfile`.

Detailed Cloud Run + Secret Manager steps: [`shared/backend/DEPLOY_CLOUD_RUN.md`](../shared/backend/DEPLOY_CLOUD_RUN.md).

---

## Authentication and participant codes

Implementation: `shared/backend/auth.py`.

| Code pattern | Purpose |
|--------------|---------|
| `DEMO` | Public try-out; normal player rules |
| `TEST`, `ROBERTA` | **Test mode** — all episodes unlocked, debug defaults, reset history, hidden chat commands |
| `AA1234` | Research participant: 2 letters + 4 digits |

Sessions are in-memory tokens (`Bearer` header), 7-day expiry. **Not** suitable for multi-instance production without external session store (acceptable for study scale with single Cloud Run instance or sticky behavior).

Login: `POST /api/auth/login` with `{ "participant_code": "..." }`.

---

## Backend API

Interactive docs when running locally: http://127.0.0.1:8000/docs

### Auth & study

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Issue session token |
| GET | `/api/auth/session` | Validate token |
| GET | `/api/study/questionnaire` | Portal onboarding questions |
| POST | `/api/study/onboarding` | Submit answers → arm + CEFR band + one-time token |
| POST | `/api/study/onboarding/attach` | Link token to logged-in participant |

### Tell game

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/game/start` | Start / resume session |
| POST | `/api/game/action` | Button actions (`talk_tim`, `examine_clue_1`, …) |
| POST | `/api/game/message` | Player chat message |
| POST | `/api/game/nina` | Message to Nina (tutor channel) |
| POST | `/api/game/explain` | Word / message explanations |
| POST | `/api/game/reset` | **TEST/ROBERTA only** — wipe state + logs |
| GET | `/api/game/stages` | Episode list and unlock status |
| POST | `/api/game/stage/switch` | Change current episode |
| POST | `/api/game/stage/skip` | Skip episode (test / design) |
| GET | `/api/game/knowledge` | Global knowledge graph for participant |
| GET | `/api/images/{path}` | Character/clue images |
| WS | `/ws/{participant_code}` | WebSocket (if used by client) |

### Teach

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/teach/open-ended-response` | Log writing + optional LLM feedback |
| GET | `/api/teach/final-summary` | End-of-study LLM summary |
| GET | `/api/teach/progress-report` | Words learned + writing feedback report |
| GET/POST | `/api/teach/state` | Persist Teach UI progress server-side |
| GET | `/api/teach/outro-questionnaire` | Outro copy |

Button/action routing for scripted Tell content: see [`shared/backend/docs/buttons-cheat-sheet.md`](../shared/backend/docs/buttons-cheat-sheet.md).

---

## Tell (Interactive Narrative Version)

### Frontend entrypoints

| File | Role |
|------|------|
| `Tell/frontend/index.html` | Shell |
| `Tell/frontend/js/init.js` | Bootstrap |
| `Tell/frontend/js/api.js` | API calls, test-mode menu, reset |
| `Tell/frontend/js/game.js` | Message rendering, buttons, chat UX |
| `Tell/frontend/js/ui.js` | Layout, menus |
| `Tell/frontend/js/tutorial.js` | First-time tutorial |

### Game flow (backend)

Core logic: `shared/backend/game_handlers.py`, config: `shared/backend/game_config.py`.

- **Stages 1–4** (“episodes”), unlock schedule `STAGE_UNLOCK_DELAY_DAYS` (7 days) unless test mode.
- **Locations** per stage (e.g. EP1 `part1_ep1` / `part2_ep1` for Pauline arrival).
- **Modes:** `public` (group chat) vs private `talk_<character>`.
- **Evidence:** `examine_clue_<n>`; EP1 needs `TOTAL_CLUES` (4) before accusation flow.
- **Accusation:** offer → select suspect → reason → win/lose branches via `game_texts`.

### Message pipeline (player text)

1. Optional **test commands** (`/pauline`, `/debug on|off`) — `handle_test_chat_command`.
2. **Predefined engine** — keyword topics, scripted multi-character replies (`shared/backend/predefined/`).
3. **LLM** — `ask_for_dialogue()` in `shared/backend/ai_services.py` with combined character prompt.

Director / contradiction guards for EP1 are configured in `ai_services.py` (`EP1_CONTRADICTION_*`).

### Tutor (Nina + explain)

- Explain API uses prompts under `prompts/language_learning/` (per-level A2/B1/B2 snippets + tutor templates).
- Tell-specific feedback prompt: `prompts/language_learning/tell/tutor_feedback_tell.md`.

---

## Teach (Traditional Version)

### Content model (hybrid)

Documented in [`Teach/frontend/data/teach-manifest/README.md`](../Teach/frontend/data/teach-manifest/README.md).

- **Week order:** `Teach/frontend/data/teach-manifest/weekN.json`
- **Story text:** `Teach/frontend/data/stories/weekN/*.md` (and legacy `Teach/weekN_*.md` sources referenced in manifest)
- **Exercises:** `Teach/frontend/data/exercises/weekN/*.md`

Each manifest `items[]` entry: `kind` = `story` | `exercise`, plus optional `renderer`, `category`, `contentSource`.

### Exercise renderers

Registered in `Teach/frontend/js/ui.js`:

| Renderer | Trigger in markdown | Module |
|----------|---------------------|--------|
| `match_words` | `[match_words]` block | `exercises/match-words.js` |
| `sentence_builder` | `[sentence_builder]` | `exercises/sentence-builder.js` |
| `fill_in_the_blanks` | (heading / content patterns) | `exercises/fill-in-the-blanks.js` |
| `suspects_drag` | manifest `renderer` | `exercises/suspects-drag.js` |
| `pick_explain` | `[pick_explain]` | `exercises/pick-explain.js` |

Categories (`writing`, `info`, …) control UI policies (e.g. hide Check/Reset on writing — `TEACH_EXERCISE_BUTTON_POLICY_BY_CATEGORY` in `config.js`).

### Teach backend integration

- Open-ended responses logged to GCS under `participant_logs/teach/`.
- Corrector / feedback prompts: `prompts/language_learning/teach/corrector.md`, `deliever_feedback.md`, `deliever_final_feedback.md`.
- Client state blob: `/api/teach/state` for cross-device resume.

### Key frontend files

| File | Role |
|------|------|
| `Teach/frontend/js/app.js` | App shell, week navigation |
| `Teach/frontend/js/content-loader.js` | Markdown → sections |
| `Teach/frontend/js/layout/week-content.js` | Renders manifest items |
| `Teach/frontend/js/open-ended-logger.js` | Sends writing to API |
| `Teach/frontend/js/explain.js` | Highlights / explain (shared client) |

---

## Portal (study entry)

- **UI:** `Portal/frontend/portal.html`, styles `css/portal.css`, strings `js/i18n.js`.
- **Questionnaire CSV (reference):** `Portal/questionnaire/language_learner_profile.csv` — live copy served from backend `questionnaire_builtin.py`.
- **CEFR scoring:** [`shared/backend/docs/cefr_self_rating_scoring.md`](../shared/backend/docs/cefr_self_rating_scoring.md) — sum of three blocks → B1 vs B2 for stratification.
- **Consent HTML:** `Portal/frontend/consent_forms/` (and related paths under `Portal/consent_forms/`).

After onboarding, participant receives `arm` (`tell` | `teach`) and should open the matching hosted app with their assigned code.

---

## Character messages and scripted content

Two complementary systems: **files** (deterministic) and **LLM** (dynamic).

### Scripted text files (`game_texts`)

Directory: `shared/backend/game_texts/ep<episode>/`.

**Parser:** `shared/backend/scripted_messages.py`

Features:

- Multiple messages per file: blocks separated by a line `---`
- Sender metadata: `[from: tim]`, `[character: Fiona McAllister]`, `[sender: narrator]`
- Buttons section:

  ```text
  [buttons]
  Continue|case_intro_next
  Open menu|show_main_menu
  ```

- Inline actions: `inline::text` or `inline::nina>>Line one.\nLine two.`

**Loading:** `POST /api/game/action` with `action` = filename (with or without `.txt`) or registered command key. Full action list: [buttons cheat sheet](../shared/backend/docs/buttons-cheat-sheet.md).

**Examples:**

- Onboarding: `onboarding_1_welcome.txt`, `onboarding_4_language_level.txt`
- Case intro chain: `case_intro_1_call.txt` … `case_intro_5_arrest_order.txt` (see `STAGE_CONFIG` intro_files in `game_config.py`)
- Clues: `Clue1.txt` … `Clue4.txt`
- Accusation / outro: `accuse_*.txt`, `outro_*.txt`
- EP2 openers: `dialogue_openers/<location>/<character>.txt`

**Editing workflow:**

1. Edit `.txt` under `shared/backend/game_texts/`.
2. Restart backend (or rely on `--reload` locally).
3. Use **TEST/ROBERTA** + `/debug on` to see routing/debug lines in chat when testing Tell.

Frontend-only action: `hide_message` (handled in `Tell/frontend/js/game.js`, not sent to server).

### LLM character messages

Prompt path resolution: `utils.get_prompt_path(character_key, episode, location)`.

EP1 has two prompt trees:

- `prompts/ep1/pauline/` — Pauline present
- `prompts/ep1/no_pauline/` — before Pauline unlock

EP2+ use location folders (`default_ep2`, `university_ep2`, `hospital_ep2`) — see [`shared/backend/prompts/ep2/README.md`](../shared/backend/prompts/ep2/README.md).

Narrator: `prompts/prompt_narrator.md`. Nina (global): `prompts/prompt_nina.md`.

Language level snippets merged into prompts: `prompts/language_learning/a2.md`, `b1.md`, `b2.md`.

### Chat logging

`utils.log_message(role, content, participant_code, source=...)` appends to:

`participant_logs/tell/chat_history/{CODE}_chat_history.txt`

Roles include `user`, `character_<key>`, `action`, etc. Timestamps in Europe/Berlin.

---

## LLM prompts and AI services

Central module: `shared/backend/ai_services.py`.

| Use case | Model | Temperature (typical) |
|----------|--------|------------------------|
| Character dialogue | `llama-3.3-70b-versatile` | 0.7 |
| Tutor / explain / Teach correction | same | 0.2–0.5 |

Without `GROQ_API_KEY`, dialogue falls back to stub responses and LLM features are disabled (warning on startup).

Secrets loaded via `shared/backend/secrets.py` (Secret Manager in production, env vars locally).

---

## Predefined responses

For reproducible study moments, keyword-triggered replies bypass or augment the LLM.

- **Engine:** `shared/backend/predefined/engine.py`
- **Profiles:** `shared/backend/predefined/profiles/` (e.g. `ep1_pauline.py`, `ep1_no_pauline.py`)
- **Resolver:** picks profile from game state (Pauline unlocked or not)

Topics are keyword-matched; responses can be ordered sequences or multi-character strategies. Used topic keys are stored in `state["topic_memory"]`.

When debugging predefined routing, run backend with logging and use `/debug on` (TEST/ROBERTA).

---

## Testing and QA tools

There is **no automated pytest suite** in this repository; validation is manual via test participant codes and the local stack.

### Participant codes

| Code | Behavior |
|------|----------|
| `DEMO` | Public demo; normal unlock schedule |
| `TEST`, `ROBERTA` | Full test mode (see below) |

### Test mode capabilities (`TEST` / `ROBERTA`)

Implemented in `auth.py`, `game_handlers.py`, `Tell/frontend/js/api.js`, `main.py`.

- All **4 episodes unlocked** immediately.
- **Debug mode on** by default (extra system/debug messages in chat).
- Menu item **Reset All History** → `POST /api/game/reset` (clears `GAME_STATE`, GCS game state, Tell progress, chat log).

### Hidden chat commands (Tell main chat)

Only for TEST/ROBERTA (`handle_test_chat_command`):

| Command | Effect |
|---------|--------|
| `/pauline`, `/skip_to_pauline`, `/test_pauline` | Unlock EP1 phase 2 + Pauline entrance (must be on Episode 1) |
| `/debug on` | Show technical debug messages |
| `/debug off` | Hide them |

Short reference for testers: [`shared/backend/docs/roberta_quick_instructions.txt`](../shared/backend/docs/roberta_quick_instructions.txt)

### Suggested manual test checklist (Tell)

1. `./dev-local.sh` → open Tell, login `TEST`.
2. Complete onboarding / level selection via buttons.
3. `case_intro_*` chain, `start_investigation`, talk to each suspect (public + private).
4. Examine four clues, accusation flow, outro.
5. `/pauline` on EP1 if testing Pauline branch without playing through.
6. Reset and confirm clean restart.

### Suggested manual test checklist (Teach)

1. Login `DEMO` or study code on Teach URL.
2. Walk week 1 manifest: story scroll, each renderer type.
3. Submit a writing exercise; verify feedback when `include_feedback` is enabled.
4. Check `/api/teach/progress-report` after explain/word saves (requires GCS locally if not `SKIP_GCS`).

### Suggested manual test checklist (Portal)

1. Consent toggles, language switch EN/IT.
2. Submit questionnaire → verify redirect arm matches band stratification.
3. Attach onboarding token after game login (`/api/study/onboarding/attach`).

### API exploration

- Swagger UI: http://127.0.0.1:8000/docs
- Use `curl` or Postman with `Authorization: Bearer <token>` from login response.

---

## Data storage (Google Cloud Storage)

When `GCS_BUCKET_NAME` is set (Secret Manager: `gcs-bucket-name`):

| Path | Content |
|------|---------|
| `game_states/user_{CODE}_state.json` | Tell game state snapshot |
| `participant_logs/tell/chat_history/{CODE}_chat_history.txt` | Tell chat log |
| `participant_logs/teach/chat_history/{CODE}_chat_history.txt` | Teach chat log (if used) |
| `participant_logs/tell/language_progress/{CODE}_language_progress.json` | Words + writing feedback |
| `participant_logs/teach/language_progress/{CODE}_language_progress.json` | Teach progress |
| `study_onboarding/participants.csv` | Onboarding export (Portal pipeline) |

Local dev: `SKIP_GCS=1` skips reliance on bucket for some paths; game state may not persist across restarts.

---

## Further reading in this repo

| Document | Topic |
|----------|--------|
| [`shared/backend/docs/buttons-cheat-sheet.md`](../shared/backend/docs/buttons-cheat-sheet.md) | `game_texts` buttons and `action` keys |
| [`shared/backend/docs/roberta_quick_instructions.txt`](../shared/backend/docs/roberta_quick_instructions.txt) | TEST/ROBERTA quick reference |
| [`shared/backend/docs/cefr_self_rating_scoring.md`](../shared/backend/docs/cefr_self_rating_scoring.md) | Portal CEFR bands |
| [`shared/backend/DEPLOY_CLOUD_RUN.md`](../shared/backend/DEPLOY_CLOUD_RUN.md) | GCP deploy (RU/EN mix) |
| [`Teach/frontend/data/teach-manifest/README.md`](../Teach/frontend/data/teach-manifest/README.md) | Teach week manifest |
| [`shared/backend/prompts/ep2/README.md`](../shared/backend/prompts/ep2/README.md) | EP2 location prompts |
| [`.cursor/rules/shared-source-of-truth.mdc`](../.cursor/rules/shared-source-of-truth.mdc) | Edit shared copies rule |
