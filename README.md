# Teach or Tell - Web Version

Web application version of the Chicago Formula language learning game - an interactive detective mystery game for English language learners.

## 📁 Project Structure

```
web_teach_and_tell/
├── backend/              # FastAPI backend
│   ├── main.py          # FastAPI application
│   ├── auth.py          # Authentication module
│   ├── ai_services.py   # AI integration (Groq)
│   ├── game_handlers.py # Game logic handlers
│   ├── config.py        # Configuration & secrets
│   └── prompts/         # AI prompts for characters
│
└── frontend/            # Static HTML/CSS/JS frontend
    └── index.html       # Single-page application
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
# Backend with hot reload
cd backend
uvicorn main:app --reload --port 8000

# Access API docs
open http://localhost:8000/docs
```

## 🤖 AI Development Disclosure

**This project extensively used large language models (LLMs) during development**, including:
- Code generation and refactoring
- Documentation writing
- Bug fixing and debugging
- Architecture decisions

## 📝 Notes

Migrated from Telegram bot version (t.me/lingo_n_bot). 
Core game logic, AI services, and prompts remain unchanged.