# Teach or Tell - Web Version

Web application version of the Chicago Formula language learning game - an interactive detective mystery game for English language learners.

## 📁 Project Structure

```
web_teach_and_tell/
├── Tell/                     # Character-driven conversation app
│   ├── backend/              # FastAPI backend
│   │   ├── main.py          # FastAPI application entrypoint
│   │   ├── auth.py          # Authentication module
│   │   ├── ai_services.py   # AI integration (Groq)
│   │   ├── game_handlers.py # Game logic handlers
│   │   ├── config.py        # Configuration & secrets
│   │   └── prompts/         # AI prompts for characters
│   │
│   └── frontend/            # Static HTML/CSS/JS frontend
│       └── index.html       # Single-page application
│
├── shared/                   # Reusable frontend/backend modules
│   ├── frontend/
│   │   ├── css/
│   │   └── js/
│   └── backend/
│       └── __init__.py
├── Portal/                   # Unified participant portal (login & mode switch)
│   └── frontend/
│       ├── index.html
│       ├── css/
│       └── js/
│
├── Teach/                    # Detective reading course
│   ├── week1_the_party.md
│   ├── week2_secrets_and_shadows.md
│   ├── week3_the_attack.md
│   └── week4_the_investigation.md
│
└── deploy.sh                 # Deployment helper script
```

## 🔑 Authentication

Simple participant code authentication for research purposes:
- Enter participant code (e.g., "AN0842")
- Session tokens valid for 7 days

## 🎮 Features

- **Interactive Detective Game**: Solve a murder mystery while learning English
- **AI-Powered Characters**: Dynamic conversations with game characters using Groq LLM
- **Language Level Adaptation**: A2, B1, B2 difficulty levels
- **Vocabulary Learning**: Built-in tutor for word explanations
- **Progress Tracking**: Learning progress and word tracking

## 🔧 Development

```bash
# Portal (login + Teach/Tell selector)
cd Portal/frontend
npx serve # or any static server

# Backend with hot reload
cd Tell/backend
uvicorn main:app --reload --port 8000

# Access API docs
open http://localhost:8000/docs

# Rebuild Teach content bundle after editing markdown weeks
node Teach/scripts/build-content.mjs
```

Production Firebase sites:

- Portal → https://chicago-formula.web.app/
- Tell → https://chicago-formula-n.web.app/
- Teach → https://chicago-formula-t.web.app/

To point the portal at production URLs, inject overrides before loading `js/portal.js`:

```html
<script>
window.portalDestinations = {
  tellProduction: 'https://chicago-formula-n.web.app/',
  teachProduction: 'https://chicago-formula-t.web.app/'
};
</script>
```

## 🚀 Deployment

The `deploy.sh` helper script will:

- rebuild the Teach content bundle (`Teach/frontend/data/content.json`)
- deploy the backend to Cloud Run using `Tell/backend/Dockerfile`
- push the Portal, Tell, and Teach frontends to Firebase Hosting

Environment variables:

- `DEPLOY_PORTAL_FRONTEND`, `DEPLOY_TELL_FRONTEND`, `DEPLOY_TEACH_FRONTEND` — set to `false` to skip individual frontends
- `PORTAL_FIREBASE_TARGET`, `TELL_FIREBASE_TARGET`, `TEACH_FIREBASE_TARGET` — Firebase hosting targets (defaults: `chicago-formula`, `chicago-formula-n`, `chicago-formula-t`)

Example:

```bash
DEPLOY_PORTAL_FRONTEND=true PORTAL_FIREBASE_TARGET=portal \
DEPLOY_TEACH_FRONTEND=true TEACH_FIREBASE_TARGET=teach \
DEPLOY_TELL_FRONTEND=true TELL_FIREBASE_TARGET=tell \
./deploy.sh
```

## 🤖 AI Development Disclosure

**This project extensively used large language models (LLMs) during development**, including:
- Code generation and refactoring
- Documentation writing
- Bug fixing and debugging
- Architecture decisions

## 📝 Notes

The character-driven detective game migrated from Telegram bot version (t.me/lingo_n_bot). 
Core game logic, AI services, and prompts remain unchanged.