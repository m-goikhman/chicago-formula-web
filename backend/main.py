"""
FastAPI main application for the web version of Teach or Tell.
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import logging
import uvicorn
import os
import time
import random

from auth import validate_session_token, login_participant
from config import GAME_STATE, CHARACTER_DATA, SUSPECT_KEYS, TOTAL_CLUES, GROQ_API_KEY
from utils import log_message

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Teach or Tell Web API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://academic-torch-476710-u0.web.app",
        "https://academic-torch-476710-u0.firebaseapp.com",
        "http://localhost:8001",  # For local development
        "http://localhost:8080",  # For local development
        "http://127.0.0.1:8001",  # For local development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response models
class LoginRequest(BaseModel):
    participant_code: str


class LoginResponse(BaseModel):
    token: str
    participant_code: str


class MessageRequest(BaseModel):
    text: str


class ExplainRequest(BaseModel):
    action: str  # "init", "word", "all"
    message_id: Optional[int] = None
    word: Optional[str] = None
    original_text: Optional[str] = None


# Dependency to get current user
async def get_current_user(authorization: str = Header(...)):
    """Get current user from session token."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization.replace("Bearer ", "")
    session = validate_session_token(token)
    
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return session


# API Routes

@app.get("/")
async def root():
    """Health check endpoint."""
    return {"message": "Teach or Tell Web API", "status": "running"}


@app.post("/api/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Login with participant code."""
    logger.info(f"Login attempt for participant code: {request.participant_code}")
    
    token = login_participant(request.participant_code)
    
    if not token:
        raise HTTPException(status_code=401, detail="Invalid participant code")
    
    return LoginResponse(
        token=token,
        participant_code=request.participant_code.upper()
    )


@app.get("/api/images/{image_name}")
async def get_image(image_name: str):
    """Serve images from the images directory."""
    # Base directory where images are stored
    base_dir = os.path.dirname(os.path.abspath(__file__))
    image_path = os.path.join(base_dir, "images", image_name)
    
    # Security check: ensure the path is within the images directory
    if not os.path.commonpath([base_dir, os.path.abspath(image_path)]) == base_dir:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
    
    return FileResponse(image_path)


@app.get("/api/game/start")
@app.post("/api/game/start")
async def start_game(current_user=Depends(get_current_user)):
    """Start a new game session."""
    participant_code = current_user["participant_code"]
    logger.info(f"Starting game for participant: {participant_code}")
    
    # Import and use game handlers
    from game_handlers import start_game_handler
    
    messages = await start_game_handler(participant_code)
    
    return {"messages": messages, "participant_code": participant_code}


class ActionRequest(BaseModel):
    action: str


@app.post("/api/game/action")
async def handle_game_action(request: ActionRequest, current_user=Depends(get_current_user)):
    """Handle game actions (button clicks, menu navigation)."""
    participant_code = current_user["participant_code"]
    logger.info(f"Action from {participant_code}: {request.action}")
    
    # Log user action to chat history
    log_message(0, "action", request.action, participant_code)
    
    from game_handlers import (
        handle_onboarding_button,
        handle_language_adjustment,
        handle_language_confirmation,
        handle_case_intro,
        start_investigation,
        handle_main_menu,
        handle_menu_talk,
        handle_character_talk,
        handle_mode_public,
        handle_menu_evidence,
        handle_clue_examination,
        handle_language_menu_difficulty,
        handle_difficulty_set,
        handle_language_menu_progress,
        handle_language_menu_back
    )
    
    # Route actions to appropriate handlers
    if request.action.startswith("onboarding_"):
        messages = await handle_onboarding_button(participant_code, request.action)
    elif request.action in ["language_adjust_easier", "language_adjust_more_advanced"]:
        messages = await handle_language_adjustment(participant_code, request.action)
    elif request.action == "language_confirm":
        messages = await handle_language_confirmation(participant_code)
    elif request.action.startswith("case_intro_"):
        messages = await handle_case_intro(participant_code, request.action)
    elif request.action == "start_investigation":
        messages = await start_investigation(participant_code)
    elif request.action == "show_main_menu":
        messages = await handle_main_menu(participant_code)
    elif request.action == "menu_talk":
        messages = await handle_menu_talk(participant_code)
    elif request.action.startswith("talk_"):
        # Extract character key from action (e.g., "talk_tim" -> "tim")
        character_key = request.action.split("_", 1)[1]
        messages = await handle_character_talk(participant_code, character_key)
    elif request.action == "mode_public":
        messages = await handle_mode_public(participant_code)
    elif request.action == "menu_evidence":
        messages = await handle_menu_evidence(participant_code)
    elif request.action.startswith("examine_clue_"):
        clue_id = request.action.split("_", 2)[2]
        messages = await handle_clue_examination(participant_code, clue_id)
    elif request.action == "language_menu_difficulty":
        messages = await handle_language_menu_difficulty(participant_code)
    elif request.action.startswith("difficulty_set_"):
        new_level = request.action.split("_", 2)[2]  # Extract A2, B1, or B2
        messages = await handle_difficulty_set(participant_code, new_level)
    elif request.action == "language_menu_progress":
        messages = await handle_language_menu_progress(participant_code)
    elif request.action == "language_menu_back":
        messages = await handle_language_menu_back(participant_code)
    else:
        messages = [{"type": "error", "content": "Unknown action"}]
    
    return {"messages": messages}


@app.post("/api/game/message")
async def send_message(request: MessageRequest, current_user=Depends(get_current_user)):
    """Send a message in the game."""
    participant_code = current_user["participant_code"]
    logger.info(f"Message from {participant_code}: {request.text}")
    
    from config import GAME_STATE
    from game_handlers import handle_private_message, handle_public_message, analyze_and_log_user_text
    
    state = GAME_STATE.get(participant_code, {})
    mode = state.get("mode", "public")
    
    # Automatically analyze user's text for grammar errors (background task)
    # Don't await to avoid blocking the response
    try:
        # Run analysis in background (fire and forget)
        # In production, you might want to use background tasks
        import asyncio
        asyncio.create_task(analyze_and_log_user_text(participant_code, request.text))
    except Exception as e:
        logger.warning(f"Failed to schedule text analysis: {e}")
    
    # Handle private conversation mode
    if mode == "private":
        messages = await handle_private_message(participant_code, request.text)
        return {"messages": messages}
    
    # Handle public mode with director logic
    messages = await handle_public_message(participant_code, request.text)
    return {"messages": messages}


@app.post("/api/game/explain")
async def handle_explain(request: ExplainRequest, current_user=Depends(get_current_user)):
    """Handle explain actions (word spotting, explanations)."""
    participant_code = current_user["participant_code"]
    logger.info(f"Explain action from {participant_code}: {request.action}")
    
    from config import message_cache
    from utils import save_message_to_cache
    from ai_services import ask_word_spotter, ask_tutor_for_explanation
    from config import CHARACTER_DATA
    
    messages = []
    tutor_data = CHARACTER_DATA["tutor"]
    
    if request.action == "init":
        # Get difficult words to explain
        original_text = request.original_text
        if not original_text:
            return {"error": "No text provided"}
        
        words_to_explain = await ask_word_spotter(original_text)
        
        return {
            "message": "init_response",
            "words": words_to_explain,
            "original_text": original_text
        }
    
    elif request.action == "word":
        # Explain a specific word
        word = request.word
        original_text = request.original_text or ""
        
        if not word:
            return {"error": "No word provided"}
        
        # Use 0 as user_id since we're using participant_code for identification
        explanation_data = await ask_tutor_for_explanation(
            0,  # user_id (not used in web version, participant_code is used instead)
            word, 
            original_text
        )
        
        definition = explanation_data.get("definition", "No definition available")
        examples = explanation_data.get("examples", [])
        contextual_explanation = explanation_data.get("contextual_explanation", "")
        
        # Format the explanation message
        reply_text = f"*{word}:* {definition}\n"
        if examples:
            reply_text += "\n*Examples:*\n"
            for ex in examples:
                reply_text += f"- _{ex}_\n"
        if contextual_explanation:
            reply_text += f"\n*In Context:*\n_{contextual_explanation}_"
        
        formatted_reply = f"{tutor_data['emoji']} *{tutor_data['full_name']}:*\n{reply_text}"
        
        # Log tutor response
        log_message(0, "character_tutor", formatted_reply, participant_code)
        
        messages.append({
            "type": "character",
            "character": "tutor",
            "character_name": tutor_data["full_name"],
            "character_emoji": tutor_data["emoji"],
            "content": formatted_reply,
            "show_explain": False
        })
        
        # Save learned word to progress
        from progress_manager import progress_manager
        progress_manager.add_word_learned(0, word, definition, participant_code)
        
        return {"messages": messages}
    
    elif request.action == "all":
        # Explain the whole sentence
        original_text = request.original_text
        if not original_text:
            return {"error": "No text provided"}
        
        explanation_data = await ask_tutor_for_explanation(
            participant_code,
            original_text,
            original_text
        )
        
        definition = explanation_data.get("definition", "No definition available")
        examples = explanation_data.get("examples", [])
        contextual_explanation = explanation_data.get("contextual_explanation", "")
        
        # Format the explanation message
        reply_text = f"*Explanation:* {definition}\n"
        if examples:
            reply_text += "\n*Examples:*\n"
            for ex in examples:
                reply_text += f"- _{ex}_\n"
        if contextual_explanation:
            reply_text += f"\n*Additional Context:*\n_{contextual_explanation}_"
        
        formatted_reply = f"{tutor_data['emoji']} *{tutor_data['full_name']}:*\n{reply_text}"
        
        # Log tutor response
        log_message(0, "character_tutor", formatted_reply, participant_code)
        
        messages.append({
            "type": "character",
            "character": "tutor",
            "character_name": tutor_data["full_name"],
            "character_emoji": tutor_data["emoji"],
            "content": formatted_reply,
            "show_explain": False
        })
        
        return {"messages": messages}
    
    return {"error": "Unknown action"}


@app.websocket("/ws/{participant_code}")
async def websocket_endpoint(websocket: WebSocket, participant_code: str):
    """WebSocket endpoint for real-time communication."""
    await websocket.accept()
    logger.info(f"WebSocket connection opened for participant: {participant_code}")
    
    try:
        while True:
            data = await websocket.receive_json()
            
            # Handle incoming message
            if "message" in data:
                text = data["message"]
                logger.info(f"WebSocket message from {participant_code}: {text}")
                
                # TODO: Process through game handlers
                response = {
                    "type": "message",
                    "content": f"Echo: {text}",
                    "sender": "bot"
                }
                
                await websocket.send_json(response)
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket connection closed for participant: {participant_code}")


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

