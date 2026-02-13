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
import bootstrap  # noqa: F401

from shared.backend.auth import validate_session_token, login_participant
from shared.backend.progress_manager import progress_manager  # used in some endpoints
from config import GAME_STATE, CHARACTER_DATA, TOTAL_CLUES, GROQ_API_KEY
from utils import log_message, clear_chat_history_log
from game_state_manager import game_state_manager

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
        "https://chicago-formula.web.app",
        "https://chicago-formula.firebaseapp.com",
        "https://chicago-formula-n.web.app",
        "https://chicago-formula-n.firebaseapp.com",
        "https://chicago-formula-t.web.app",
        "https://chicago-formula-t.firebaseapp.com",
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


class SessionResponse(BaseModel):
    participant_code: str


class ResetGameResponse(BaseModel):
    success: bool
    message: str


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


@app.get("/api/auth/session", response_model=SessionResponse)
async def session_status(authorization: str = Header(...)):
    """Validate an existing session token."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "", 1)
    session = validate_session_token(token)

    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return SessionResponse(participant_code=session["participant_code"])


@app.get("/api/images/{image_path:path}")
async def get_image(image_path: str):
    """Serve images from the images directory (e.g. ep1/clue1.png or nina.png)."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    images_dir = os.path.abspath(os.path.join(base_dir, "images"))
    resolved = os.path.abspath(os.path.join(images_dir, image_path))
    # Security: path must stay inside images directory
    if os.path.commonpath([images_dir, resolved]) != images_dir:
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.exists(resolved):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(resolved)


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


@app.post("/api/game/reset", response_model=ResetGameResponse)
async def reset_game(current_user=Depends(get_current_user)):
    """Reset all game/chat history for TEST participant."""
    participant_code = current_user["participant_code"]

    if participant_code.upper() != "TEST":
        raise HTTPException(status_code=403, detail="Reset is available only for TEST participant")

    logger.info("Reset requested for TEST participant")

    # Clear in-memory state
    GAME_STATE.pop(participant_code, None)

    # Clear persisted game state and progress
    await game_state_manager.delete_game_state(participant_code)
    progress_manager.clear_user_progress(0, participant_code)

    # Clear persisted chat history log
    clear_chat_history_log(0, participant_code)

    return ResetGameResponse(
        success=True,
        message="All message history and progress were cleared. You can start from the beginning."
    )


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
        handle_location_transition,
        handle_main_menu,
        handle_menu_talk,
        handle_character_talk,
        handle_mode_public,
        handle_menu_evidence,
        handle_clue_examination,
        handle_share_usb_with_james,
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
    elif request.action in ["go_default_ep2", "go_university_ep2", "go_hospital_ep2"]:
        messages = await handle_location_transition(participant_code, request.action)
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
    elif request.action == "share_usb_with_james":
        messages = await handle_share_usb_with_james(participant_code)
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
    
    # Append messages to current episode's chat history so they are restored when returning to this episode
    if messages:
        state = GAME_STATE.get(participant_code)
        if state is not None:
            episode = state.get("current_stage", 1)
            episode_messages = state.get("episode_messages", {})
            episode_messages.setdefault(str(episode), []).extend(messages)
            state["episode_messages"] = episode_messages
            await game_state_manager.save_game_state(participant_code, state)
    
    return {"messages": messages}


@app.post("/api/game/message")
async def send_message(request: MessageRequest, current_user=Depends(get_current_user)):
    """Send a message in the game."""
    participant_code = current_user["participant_code"]
    logger.info(f"Message from {participant_code}: {request.text}")
    
    from config import GAME_STATE
    from game_handlers import handle_private_message, handle_public_message, handle_nina_message, analyze_and_log_user_text
    
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
        if messages:
            state = GAME_STATE.get(participant_code)
            if state is not None:
                episode = state.get("current_stage", 1)
                episode_messages = state.get("episode_messages", {})
                episode_messages.setdefault(str(episode), []).extend(messages)
                state["episode_messages"] = episode_messages
                await game_state_manager.save_game_state(participant_code, state)
        return {"messages": messages}
    
    # Handle public mode with director logic
    messages = await handle_public_message(participant_code, request.text)
    if messages:
        state = GAME_STATE.get(participant_code)
        if state is not None:
            episode = state.get("current_stage", 1)
            episode_messages = state.get("episode_messages", {})
            episode_messages.setdefault(str(episode), []).extend(messages)
            state["episode_messages"] = episode_messages
            await game_state_manager.save_game_state(participant_code, state)
    return {"messages": messages}


@app.post("/api/game/nina")
async def send_message_to_nina(request: MessageRequest, current_user=Depends(get_current_user)):
    """Send a message to Nina (mentor/guide character)."""
    participant_code = current_user["participant_code"]
    logger.info(f"Message to Nina from {participant_code}: {request.text}")
    
    from game_handlers import handle_nina_message
    
    messages = await handle_nina_message(participant_code, request.text)
    if messages:
        state = GAME_STATE.get(participant_code)
        if state is not None:
            episode = state.get("current_stage", 1)
            episode_messages = state.get("episode_messages", {})
            episode_messages.setdefault(str(episode), []).extend(messages)
            state["episode_messages"] = episode_messages
            await game_state_manager.save_game_state(participant_code, state)
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
        
        formatted_reply = f"*{tutor_data['full_name']}:*\n{reply_text}"
        
        # Log tutor response
        log_message(0, "character_tutor", formatted_reply, participant_code)
        
        messages.append({
            "type": "character",
            "character": "tutor",
            "character_name": tutor_data["full_name"],
            "content": formatted_reply,
            "show_explain": False
        })
        
        # Save learned word to progress
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
        
        formatted_reply = f"*{tutor_data['full_name']}:*\n{reply_text}"
        
        # Log tutor response
        log_message(0, "character_tutor", formatted_reply, participant_code)
        
        messages.append({
            "type": "character",
            "character": "tutor",
            "character_name": tutor_data["full_name"],
            "content": formatted_reply,
            "show_explain": False
        })
        
        return {"messages": messages}
    
    return {"error": "Unknown action"}


# Multi-stage game endpoints

@app.get("/api/game/stages")
async def get_available_stages(current_user=Depends(get_current_user)):
    """Get list of available stages for the current user."""
    participant_code = current_user["participant_code"]
    logger.info(f"Getting available stages for participant: {participant_code}")
    
    from game_handlers import get_available_stages, GAME_STATE, get_characters_for_stage, get_stage_location
    from config import STAGE_CONFIG, TOTAL_STAGES, CHARACTER_DATA
    
    # Ensure state is loaded
    if participant_code not in GAME_STATE:
        from game_handlers import start_game_handler
        await start_game_handler(participant_code)
    
    available_stages = get_available_stages(participant_code)
    current_stage = GAME_STATE.get(participant_code, {}).get("current_stage", 1)
    stages_completed = list(GAME_STATE.get(participant_code, {}).get("stages_completed", set()))
    stage_progress = GAME_STATE.get(participant_code, {}).get("stage_progress", {})
    
    # Special test mode: for TEST participant, show all stages as available
    is_test_mode = participant_code.upper() == "TEST"
    
    # Build stage info
    stages_info = []
    # For test mode, include all stages; otherwise only available ones
    stages_to_show = list(range(1, TOTAL_STAGES + 1)) if is_test_mode else available_stages
    
    for stage_num in stages_to_show:
        stage_config = STAGE_CONFIG.get(stage_num, {})
        progress = stage_progress.get(stage_num, {})
        is_available = stage_num in available_stages if not is_test_mode else True
        if stage_num == current_stage:
            character_keys = get_characters_for_stage(GAME_STATE.get(participant_code, {}), stage_num)
            current_location = get_stage_location(GAME_STATE.get(participant_code, {}), stage_num)
        else:
            default_location = stage_config.get("default_location")
            location_cfg = stage_config.get("locations", {}).get(default_location, {})
            character_keys = location_cfg.get("characters", stage_config.get("characters", []))
            current_location = default_location
        characters = [
            {"key": k, "full_name": CHARACTER_DATA[k]["full_name"], "image": CHARACTER_DATA.get(k, {}).get("image")}
            for k in character_keys if k in CHARACTER_DATA
        ]
        stages_info.append({
            "stage": stage_num,
            "name": stage_config.get("name", f"Stage {stage_num}"),
            "available": is_available,
            "current": stage_num == current_stage,
            "completed": stage_num in stages_completed,
            "status": progress.get("completion_status", "not_started"),
            "location": current_location,
            "characters": characters
        })
    
    return {
        "available_stages": available_stages,
        "current_stage": current_stage,
        "stages_completed": stages_completed,
        "stages_info": stages_info
    }


class StageSwitchRequest(BaseModel):
    stage_number: int


@app.post("/api/game/stage/switch")
async def switch_stage(request: StageSwitchRequest, current_user=Depends(get_current_user)):
    """Switch to a different stage."""
    participant_code = current_user["participant_code"]
    logger.info(f"Switching to stage {request.stage_number} for participant: {participant_code}")
    
    from game_handlers import switch_stage, GAME_STATE
    
    # Ensure state is loaded
    if participant_code not in GAME_STATE:
        from game_handlers import start_game_handler
        await start_game_handler(participant_code)
    
    success = await switch_stage(participant_code, request.stage_number)
    
    if success:
        return {"success": True, "current_stage": request.stage_number}
    else:
        raise HTTPException(status_code=400, detail="Stage not available or invalid")


@app.post("/api/game/stage/skip")
async def skip_stage(request: StageSwitchRequest, current_user=Depends(get_current_user)):
    """Skip the current stage."""
    participant_code = current_user["participant_code"]
    logger.info(f"Skipping stage {request.stage_number} for participant: {participant_code}")
    
    from game_handlers import skip_stage, GAME_STATE
    
    # Ensure state is loaded
    if participant_code not in GAME_STATE:
        from game_handlers import start_game_handler
        await start_game_handler(participant_code)
    
    success = await skip_stage(participant_code, request.stage_number)
    
    if success:
        return {"success": True, "stage_skipped": request.stage_number}
    else:
        raise HTTPException(status_code=400, detail="Failed to skip stage")


@app.get("/api/game/knowledge")
async def get_knowledge(current_user=Depends(get_current_user)):
    """Get accumulated knowledge from all stages."""
    participant_code = current_user["participant_code"]
    logger.info(f"Getting knowledge for participant: {participant_code}")
    
    from game_handlers import GAME_STATE
    
    # Ensure state is loaded
    if participant_code not in GAME_STATE:
        from game_handlers import start_game_handler
        await start_game_handler(participant_code)
    
    state = GAME_STATE.get(participant_code, {})
    global_knowledge = state.get("global_knowledge", [])
    
    return {
        "knowledge": global_knowledge,
        "total_items": len(global_knowledge)
    }


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

