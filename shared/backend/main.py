"""
FastAPI main application for the web version of Teach or Tell.
"""

from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import logging
import json
import uvicorn
import os
from . import bootstrap  # noqa: F401

from .auth import validate_session_token, login_participant, is_test_mode_participant
from .demo_slots import is_demo_mode_participant
from . import study_onboarding
from . import meara_vocab
from .progress_manager import (
    progress_manager,
    TELL_SOURCE,
    TEACH_SOURCE,
)
from .game_config import GAME_STATE, CHARACTER_DATA
from .utils import log_message
from .game_state_manager import game_state_manager

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
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3080",  # dev-local.sh — Portal
        "http://127.0.0.1:3080",
        "http://localhost:3081",  # dev-local.sh — Tell
        "http://127.0.0.1:3081",
        "http://localhost:3082",  # dev-local.sh — Teach
        "http://127.0.0.1:3082",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response models
class LoginRequest(BaseModel):
    participant_code: str
    demo_slot: Optional[str] = None
    login_source: Optional[str] = None


class LoginResponse(BaseModel):
    token: str
    participant_code: str
    study_arm: Optional[str] = None
    demo_mode: bool = False


class SessionResponse(BaseModel):
    participant_code: str
    study_arm: Optional[str] = None
    demo_mode: bool = False


class OnboardingQuestionnaireResponse(BaseModel):
    questions: list


class OnboardingSubmitRequest(BaseModel):
    answers: dict


class OnboardingSubmitResponse(BaseModel):
    cefr_band: str
    success: bool = True


class OnboardingAssignResponse(BaseModel):
    arm: str
    participant_code: str


class StudyProgressResponse(BaseModel):
    questionnaire_done: bool
    meara_done: bool
    meara_pretest_done: bool = False
    meara_posttest_done: bool = False
    study_arm: Optional[str] = None
    weekly_questionnaire_link: Optional[str] = None
    final_questionnaire_link: Optional[str] = None


class MearaWordsResponse(BaseModel):
    words: list


class MearaResponseItem(BaseModel):
    word: str
    knows: bool


class MearaSubmitRequest(BaseModel):
    phase: str
    word_order: list
    responses: list[MearaResponseItem]


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
    source: Optional[str] = None


class TeachOpenEndedResponseRequest(BaseModel):
    section_id: str
    prompt: Optional[str] = None
    response: str
    week_id: Optional[str] = None
    renderer: Optional[str] = None
    category: Optional[str] = None
    writing_space: Optional[str] = None
    include_feedback: Optional[bool] = False


class TeachOutroQuestionnaireResponse(BaseModel):
    text: str


class TeachClientStateRequest(BaseModel):
    state: dict


class TeachClientStateResponse(BaseModel):
    state: dict


def _resolve_learning_source(source: Optional[str]) -> str:
    normalized = str(source or "").strip().lower()
    if normalized == TEACH_SOURCE:
        return TEACH_SOURCE
    return TELL_SOURCE


def _build_fallback_writing_feedback(response_text: str) -> str:
    text = str(response_text or "").strip()
    if not text:
        return ""
    if len(text) < 40:
        return "Good start. Add a bit more detail so your idea is clearer."
    if "." not in text and "!" not in text and "?" not in text:
        return "Nice idea. Add punctuation so your writing reads as a complete sentence."
    return "Good job! Your writing is clear and complete."


def _build_progress_report_message(logs: dict) -> str:
    words_learned = logs.get("words_learned") or []
    writing_feedback = logs.get("writing_feedback") or []
    meaningful_feedback = [
        entry for entry in writing_feedback
        if (
            not str(entry.get("feedback") or "").startswith("teach_open_ended_response::")
            and entry.get("improvement_needed") is not False
        )
    ]

    if not words_learned and not meaningful_feedback:
        return (
            "📊 **Your Progress Report**\n\n"
            "You don't have any saved progress yet! Keep asking for explanations and writing "
            "responses to build your learning history."
        )

    report = "--- \n**Your Progress Report**\n---\n\n"

    if words_learned:
        report += "**Words You've Learned:**\n"
        for entry in words_learned:
            word = str(entry.get("query") or "").strip()
            definition = str(entry.get("feedback") or "").strip()
            if not word:
                continue
            report += f"• **{word}**: {definition}\n"
        report += "\n"

    if meaningful_feedback:
        report += "**My Feedback on Your Phrases:**\n"
        for entry in meaningful_feedback:
            query = str(entry.get("query") or "").strip()
            feedback = str(entry.get("feedback") or "").strip()
            if not query and not feedback:
                continue
            report += f"📖 *You wrote:* {query}\n"
            report += f"✅ **My suggestion:** {feedback}\n\n"

    return report


# Dependency to get current user
async def get_current_user(authorization: str = Header(..., alias="Authorization")):
    """Get current user from session token."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization.replace("Bearer ", "", 1)
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
    
    login_result = login_participant(
        request.participant_code,
        demo_slot=request.demo_slot,
    )

    if not login_result:
        raise HTTPException(status_code=401, detail="Invalid participant code")

    token, demo_mode = login_result
    session = validate_session_token(token)
    code = (session or {}).get("participant_code") or request.participant_code.upper()
    study_onboarding.record_login_source(code, request.login_source)
    study = study_onboarding.get_participant_study(code)
    study_arm = study.get("arm") if study else None

    return LoginResponse(
        token=token,
        participant_code=code,
        study_arm=study_arm,
        demo_mode=demo_mode or is_demo_mode_participant(code),
    )


@app.get("/api/auth/session", response_model=SessionResponse)
async def session_status(current_user=Depends(get_current_user)):
    """Validate an existing session token."""
    code = current_user["participant_code"]
    study = study_onboarding.get_participant_study(code)
    study_arm = study.get("arm") if study else None

    return SessionResponse(
        participant_code=code,
        study_arm=study_arm,
        demo_mode=is_demo_mode_participant(code),
    )


@app.get("/api/study/questionnaire", response_model=OnboardingQuestionnaireResponse)
async def study_questionnaire():
    """Language learner profile items for the portal onboarding survey (EN copy bundled with backend)."""
    return OnboardingQuestionnaireResponse(questions=study_onboarding.load_questionnaire())


@app.post("/api/study/onboarding", response_model=OnboardingSubmitResponse)
async def study_onboarding_submit(
    request: OnboardingSubmitRequest,
    current_user=Depends(get_current_user),
):
    """Save language learner profile for the authenticated participant (no arm assignment yet)."""
    code = current_user["participant_code"]
    try:
        band, _norm = study_onboarding.submit_questionnaire(code, request.answers)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return OnboardingSubmitResponse(cefr_band=band)


@app.post("/api/study/onboarding/assign", response_model=OnboardingAssignResponse)
async def study_onboarding_assign_arm(current_user=Depends(get_current_user)):
    """Stratified Tell vs Teach assignment after portal onboarding tests."""
    code = current_user["participant_code"]
    try:
        arm = study_onboarding.assign_arm(code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return OnboardingAssignResponse(arm=arm, participant_code=code)


@app.get("/api/study/progress", response_model=StudyProgressResponse)
async def study_portal_progress(current_user=Depends(get_current_user)):
    """Which portal steps the participant has already completed."""
    code = current_user["participant_code"]
    meara_pretest_done = meara_vocab.has_submission(code, "pretest")
    meara_posttest_done = meara_vocab.has_submission(code, "posttest")
    from .game_handlers import get_final_study_form_links

    form_links = get_final_study_form_links(code)
    progress = study_onboarding.get_portal_progress(
        code,
        meara_done=meara_pretest_done,
        meara_pretest_done=meara_pretest_done,
        meara_posttest_done=meara_posttest_done,
        weekly_questionnaire_link=form_links["weekly_questionnaire_link"],
        final_questionnaire_link=form_links["final_questionnaire_link"],
    )
    return StudyProgressResponse(**progress)


@app.get("/api/study/meara/words", response_model=MearaWordsResponse)
async def study_meara_words():
    """Vocabulary test items (words only; labels are stored server-side)."""
    return MearaWordsResponse(words=meara_vocab.get_word_list())


@app.post("/api/study/meara/submit")
async def study_meara_submit(
    request: MearaSubmitRequest,
    current_user=Depends(get_current_user),
):
    """Persist Yes/No vocabulary test responses for a participant."""
    code = current_user["participant_code"]
    try:
        payload = meara_vocab.submit_results(
            participant_code=code,
            phase=request.phase,
            word_order=request.word_order,
            responses=[item.model_dump() for item in request.responses],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return {"success": True, "participant_code": code, "phase": payload.get("phase")}


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
    from .game_handlers import start_game_handler
    
    messages, start_meta = await start_game_handler(participant_code)
    
    return {"messages": messages, "participant_code": participant_code, **start_meta}


@app.post("/api/game/reset", response_model=ResetGameResponse)
async def reset_game(current_user=Depends(get_current_user)):
    """Reset test-mode progress to Episode 1 right after case intro."""
    participant_code = current_user["participant_code"]

    if not is_test_mode_participant(participant_code):
        raise HTTPException(status_code=403, detail="Reset is available only for TEST/ROBERTA participant")

    logger.info("Reset requested for TEST/ROBERTA participant")

    from .game_handlers import reset_to_ep1_post_intro

    await reset_to_ep1_post_intro(participant_code)

    return ResetGameResponse(
        success=True,
        message=(
            "History and progress were reset to Episode 1 after the case intro "
            "(case_intro_5_arrest_order.txt)."
        ),
    )


class ActionRequest(BaseModel):
    action: str


@app.post("/api/game/action")
async def handle_game_action(request: ActionRequest, current_user=Depends(get_current_user)):
    """Handle game actions (button clicks, menu navigation)."""
    participant_code = current_user["participant_code"]
    logger.info(f"Action from {participant_code}: {request.action}")
    
    # Log user action to chat history
    log_message("action", request.action, participant_code)
    
    from .game_handlers import (
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
        handle_ep4_material_examination,
        handle_accuse_offer_declined,
        handle_accuse_offer_accepted,
        handle_accuse_open_menu,
        handle_accuse_nina_enters,
        handle_accuse_nina_to_public,
        handle_accuse_select_target,
        handle_accuse_explain_cancel,
        handle_accuse_explain_ready,
        handle_reveal_ep1_killer,
        handle_share_usb_with_james,
        handle_language_menu_difficulty,
        handle_difficulty_set,
        handle_language_menu_progress,
        handle_language_menu_back,
        handle_game_text_action,
        handle_inline_button_action,
        handle_ep1_usb_received,
        handle_ep1_outro_narrator,
        handle_ep1_outro_questionnaire,
        handle_ep3_head_out,
        handle_ep3_outro_questionnaire,
        handle_ep4_fiona_reassured,
        handle_ep4_outro_questionnaire,
        handle_get_final_summary,
        append_episode_messages,
        get_messages_for_current_location,
        get_stage_location,
        episode_has_locations,
    )

    state_before_action = GAME_STATE.get(participant_code)
    episode_before_action = state_before_action.get("current_stage", 1) if state_before_action else 1
    location_before_action = (
        get_stage_location(state_before_action, episode_before_action)
        if state_before_action and episode_has_locations(episode_before_action)
        else None
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
    elif request.action in [
        "go_default_ep3", "go_university_ep3", "go_alex_apartment_ep3",
        "go_default_ep2", "go_university_ep2", "go_alex_apartment_ep2",
        "go_precinct_ep4", "go_university_ep4", "go_bar_ep4",
        "go_pauline_office_ep4", "go_phone_ep4", "go_motel_ep4",
    ]:
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
    elif request.action == "ep1_usb_received":
        messages = await handle_ep1_usb_received(participant_code)
    elif request.action == "ep1_outro_narrator":
        messages = await handle_ep1_outro_narrator(participant_code)
    elif request.action == "outro_questionnaire":
        messages = await handle_ep1_outro_questionnaire(participant_code)
    elif request.action == "ep3_head_out":
        messages = await handle_ep3_head_out(participant_code)
    elif request.action == "ep3_outro_questionnaire":
        messages = await handle_ep3_outro_questionnaire(participant_code)
    elif request.action == "ep4_fiona_reassured":
        messages = await handle_ep4_fiona_reassured(participant_code)
    elif request.action == "ep4_outro_questionnaire":
        messages = await handle_ep4_outro_questionnaire(participant_code)
    elif request.action == "get_final_summary":
        messages = await handle_get_final_summary(participant_code)
    elif request.action.startswith("examine_ep4_material_"):
        material_id = request.action[len("examine_ep4_material_"):]
        messages = await handle_ep4_material_examination(participant_code, material_id)
    elif request.action.startswith("examine_ep3_clue_") or request.action.startswith("examine_ep2_clue_"):
        clue_id = request.action.split("_", 3)[3]
        messages = await handle_clue_examination(participant_code, clue_id, forced_stage=3)
    elif request.action.startswith("examine_clue_"):
        clue_id = request.action.split("_", 2)[2]
        messages = await handle_clue_examination(participant_code, clue_id)
    elif request.action == "accuse_offer_declined":
        messages = await handle_accuse_offer_declined(participant_code)
    elif request.action == "accuse_offer_accepted":
        messages = await handle_accuse_offer_accepted(participant_code)
    elif request.action == "accuse_open_menu":
        messages = await handle_accuse_open_menu(participant_code)
    elif request.action == "accuse_nina_enters":
        messages = await handle_accuse_nina_enters(participant_code)
    elif request.action == "accuse_nina_to_public":
        messages = await handle_accuse_nina_to_public(participant_code)
    elif request.action == "accuse_explain_cancel":
        messages = await handle_accuse_explain_cancel(participant_code)
    elif request.action == "accuse_explain_ready":
        messages = await handle_accuse_explain_ready(participant_code)
    elif request.action.startswith("accuse_"):
        accused_key = request.action.split("_", 1)[1]
        messages = await handle_accuse_select_target(participant_code, accused_key)
    elif request.action == "reveal_ep1_killer":
        messages = await handle_reveal_ep1_killer(participant_code)
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
        inline_messages = await handle_inline_button_action(participant_code, request.action)
        if inline_messages is not None:
            messages = inline_messages
        else:
            # Fallback: treat unknown action as a game_texts file path and show it as an in-game message.
            messages = await handle_game_text_action(participant_code, request.action)
            if not messages:
                messages = [{"type": "error", "content": "Unknown action"}]
    
    # Append messages to current episode's chat history so they are restored when returning.
    replace_chat = False
    if messages:
        state = GAME_STATE.get(participant_code)
        if state is not None:
            episode = state.get("current_stage", 1)
            append_episode_messages(state, episode, messages)
            location_after_action = (
                get_stage_location(state, episode)
                if episode_has_locations(episode)
                else None
            )
            replace_chat = bool(
                location_before_action
                and location_after_action
                and location_before_action != location_after_action
            )
            if replace_chat:
                messages = get_messages_for_current_location(state, episode)
            await game_state_manager.save_game_state(participant_code, state)
    
    response = {"messages": messages}
    if replace_chat:
        response["replace_chat"] = True
    return response


@app.post("/api/game/message")
async def send_message(request: MessageRequest, current_user=Depends(get_current_user)):
    """Send a message in the game."""
    participant_code = current_user["participant_code"]
    logger.info(f"Message from {participant_code}: {request.text}")

    try:
        from .game_config import GAME_STATE
        from .game_handlers import (
            handle_private_message,
            handle_public_message,
            handle_accuse_reason_message,
            analyze_and_log_user_text,
            handle_test_chat_command,
            append_episode_messages,
            get_messages_for_current_location,
            get_stage_location,
            episode_has_locations,
            maybe_trigger_ep4_nina_phone_located,
            maybe_trigger_ep4_alex_asks_fate,
            maybe_trigger_ep4_pauline_alex_log,
            _normalize_ep4_public_dialogue_mode,
        )

        state = GAME_STATE.get(participant_code, {})
        _normalize_ep4_public_dialogue_mode(state)
        mode = state.get("mode", "public")
        episode = state.get("current_stage", 1)
        location_before_message = (
            get_stage_location(state, episode)
            if episode_has_locations(episode)
            else None
        )

        # Hidden test-only chat command(s), e.g. /pauline to jump to Pauline appearance in EP1.
        command_messages = await handle_test_chat_command(participant_code, request.text)
        if command_messages is not None:
            replace_chat = False
            if command_messages:
                state = GAME_STATE.get(participant_code)
                if state is not None:
                    episode = state.get("current_stage", 1)
                    append_episode_messages(state, episode, command_messages)
                    location_after_message = (
                        get_stage_location(state, episode)
                        if episode_has_locations(episode)
                        else None
                    )
                    replace_chat = bool(
                        location_before_message
                        and location_after_message
                        and location_before_message != location_after_message
                    )
                    if replace_chat:
                        command_messages = get_messages_for_current_location(state, episode)
                    await game_state_manager.save_game_state(participant_code, state)
            response = {"messages": command_messages}
            if replace_chat:
                response["replace_chat"] = True
            return response

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
            replace_chat = False
            state = GAME_STATE.get(participant_code)
            if state is not None:
                episode = state.get("current_stage", 1)
                char_key = str(state.get("current_character") or "").strip()
                request_text = str(request.text or "").strip()
                stored_messages = []
                if request_text and char_key:
                    user_message = {
                        "type": "user",
                        "content": request_text,
                        "chat_scope": f"private:{char_key}",
                    }
                    if location_before_message:
                        user_message["location"] = location_before_message
                    stored_messages.append(user_message)
                if messages:
                    stored_messages.extend(messages)
                append_episode_messages(state, episode, stored_messages)
                location_after_message = (
                    get_stage_location(state, episode)
                    if episode_has_locations(episode)
                    else None
                )
                replace_chat = bool(
                    location_before_message
                    and location_after_message
                    and location_before_message != location_after_message
                )
                if replace_chat:
                    messages = get_messages_for_current_location(state, episode)
                await game_state_manager.save_game_state(participant_code, state)
            response = {"messages": messages}
            if replace_chat:
                response["replace_chat"] = True
            return response

        # During episode 1/2 accusation rationale step, keep all free-text inside the
        # accusation pipeline. This includes the explicit "let me explain why"
        # path and the case where player types rationale immediately.
        if (
            state.get("current_stage", 1) in {1, 2}
            and (
                state.get("accuse_waiting_for_reason", False)
                or bool(str(state.get("accuse_pending_target") or "").strip())
            )
        ):
            messages = await handle_accuse_reason_message(participant_code, request.text)
            if messages:
                state = GAME_STATE.get(participant_code)
                if state is not None:
                    episode = state.get("current_stage", 1)
                    append_episode_messages(state, episode, messages)
                    await game_state_manager.save_game_state(participant_code, state)
            return {"messages": messages}

        # Handle public mode with director logic
        messages = await handle_public_message(participant_code, request.text)
        state = GAME_STATE.get(participant_code)
        if state is not None:
            phone_located_messages = await maybe_trigger_ep4_nina_phone_located(
                participant_code, state, request.text
            )
            if phone_located_messages:
                messages = (messages or []) + phone_located_messages

            pauline_log_messages = await maybe_trigger_ep4_pauline_alex_log(
                participant_code, state, request.text
            )
            if pauline_log_messages:
                messages = (messages or []) + pauline_log_messages

            alex_fate_messages = await maybe_trigger_ep4_alex_asks_fate(
                participant_code, state, request.text
            )
            if alex_fate_messages:
                messages = (messages or []) + alex_fate_messages

            episode = state.get("current_stage", 1)
            request_text = str(request.text or "").strip()
            stored_messages = []
            if request_text:
                stored_messages.append({
                    "type": "user",
                    "content": request_text,
                    "chat_scope": "public",
                })
            if messages:
                stored_messages.extend(messages)
            if stored_messages:
                append_episode_messages(state, episode, stored_messages)
                await game_state_manager.save_game_state(participant_code, state)
        return {"messages": messages}
    except Exception as e:
        logger.exception(f"Unhandled error in /api/game/message for {participant_code}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to process game message. Check backend logs for details."
        )


@app.post("/api/game/nina")
async def send_message_to_nina(request: MessageRequest, current_user=Depends(get_current_user)):
    """Send a message to Nina (mentor/guide character)."""
    participant_code = current_user["participant_code"]
    logger.info(f"Message to Nina from {participant_code}: {request.text}")
    
    from .game_handlers import handle_nina_message, append_episode_messages
    
    messages = await handle_nina_message(participant_code, request.text)

    # Persist modal conversation separately so restore keeps it out of public chat.
    modal_history_messages = []
    request_text = str(request.text or "").strip()
    if request_text:
        modal_history_messages.append({
            "type": "user",
            "content": request_text,
            "ui": {
                "ninaModalMessage": True
            }
        })
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        merged_ui = dict(msg.get("ui", {}))
        merged_ui["ninaModalMessage"] = True
        modal_history_messages.append({
            **msg,
            "ui": merged_ui
        })

    if modal_history_messages:
        state = GAME_STATE.get(participant_code)
        if state is not None:
            episode = state.get("current_stage", 1)
            append_episode_messages(state, episode, modal_history_messages)
            await game_state_manager.save_game_state(participant_code, state)
    return {"messages": messages}


@app.post("/api/game/explain")
async def handle_explain(request: ExplainRequest, current_user=Depends(get_current_user)):
    """Handle explain actions (word spotting, explanations)."""
    participant_code = current_user["participant_code"]
    logger.info(f"Explain action from {participant_code}: {request.action}")
    learning_source = _resolve_learning_source(request.source)
    
    from .ai_services import ask_word_spotter, ask_tutor_for_explanation
    from .game_config import CHARACTER_DATA

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
        
        # Use participant_code as identity in web version.
        explanation_data = await ask_tutor_for_explanation(
            participant_code,
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
        log_message("character_tutor", formatted_reply, participant_code)
        
        messages.append({
            "type": "character",
            "character": "tutor",
            "character_name": tutor_data["full_name"],
            "content": formatted_reply,
            "show_explain": False
        })
        
        # Save learned word to progress
        progress_manager.add_participant_word_learned(
            participant_code,
            word,
            definition,
            source=learning_source,
        )
        
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
        log_message("character_tutor", formatted_reply, participant_code)
        
        messages.append({
            "type": "character",
            "character": "tutor",
            "character_name": tutor_data["full_name"],
            "content": formatted_reply,
            "show_explain": False
        })
        
        return {"messages": messages}
    
    return {"error": "Unknown action"}


@app.post("/api/teach/open-ended-response")
async def save_teach_open_ended_response(
    request: TeachOpenEndedResponseRequest,
    current_user=Depends(get_current_user),
):
    """Persist Teach open-ended writing responses in participant progress logs."""
    participant_code = current_user["participant_code"]
    cleaned_response = str(request.response or "").strip()
    if not cleaned_response:
        return {"saved": False, "reason": "empty_response"}

    prompt = str(request.prompt or "").strip()
    section_id = str(request.section_id or "").strip() or "unknown_section"
    week_id = str(request.week_id or "").strip()
    renderer = str(request.renderer or "").strip()
    category = str(request.category or "").strip().lower()
    writing_space = str(request.writing_space or "").strip().lower()
    include_feedback = bool(request.include_feedback)

    tutor_feedback = ""
    tutor_briefly = ""
    improvement_needed = None
    passed = False
    pass_reason = "pending_tutor"
    should_generate_feedback = (
        include_feedback
        and category == "writing"
        and len(cleaned_response) >= 20
    )
    if should_generate_feedback:
        try:
            from .ai_services import ask_teach_corrector, ask_teach_deliver_feedback

            detected_errors = await ask_teach_corrector(participant_code, cleaned_response)
            try:
                log_message(
                    "teach_corrector_output",
                    json.dumps(
                        {
                            "section_id": section_id,
                            "response_text": cleaned_response,
                            "errors_count": len(detected_errors),
                            "errors": detected_errors,
                        },
                        ensure_ascii=False,
                    ),
                    participant_code,
                    source=TEACH_SOURCE,
                )
            except Exception:
                # Logging must never break feedback flow.
                pass
            error_count = len(detected_errors)
            passed = 0 <= error_count <= 3
            improvement_needed = error_count > 0

            if improvement_needed:
                tutor_feedback = await ask_teach_deliver_feedback(participant_code, detected_errors)
                tutor_briefly = json.dumps(detected_errors, ensure_ascii=False)
            else:
                tutor_feedback = _build_fallback_writing_feedback(cleaned_response)
                tutor_briefly = ""
        except Exception as error:
            logger.warning("Teach writing feedback generation failed: %s", error)
            tutor_feedback = ""
            tutor_briefly = ""
            improvement_needed = False
            passed = True
        if not tutor_feedback:
            tutor_feedback = _build_fallback_writing_feedback(cleaned_response)
        pass_reason = "error_threshold_passed" if passed else "error_threshold_failed"
    elif category == "writing":
        pass_reason = "too_short" if len(cleaned_response) < 20 else "pending_tutor"

    stored_feedback = tutor_feedback or f"teach_open_ended_response::{section_id}"
    success = progress_manager.add_participant_writing_feedback(
        participant_code=participant_code,
        user_text=cleaned_response,
        feedback=stored_feedback,
        briefly=tutor_briefly,
        improvement_needed=improvement_needed,
        source=TEACH_SOURCE,
        deduplicate_by_query=False,
    )

    return {
        "saved": bool(success),
        "feedback": tutor_feedback,
        "passed": passed,
        "pass_reason": pass_reason,
    }


@app.get("/api/teach/final-summary")
async def get_teach_final_summary(
    current_user=Depends(get_current_user),
):
    """Generate final tutor summary for Teach progress."""
    participant_code = current_user["participant_code"]

    from .ai_services import ask_tutor_for_final_summary

    try:
        logs = progress_manager.get_participant_progress(
            participant_code=participant_code,
            source=TEACH_SOURCE,
        )
    except Exception as error:
        logger.warning("Failed to load Teach progress for final summary: %s", error)
        logs = {"words_learned": [], "writing_feedback": []}

    summary_data = await ask_tutor_for_final_summary(
        participant_code,
        logs,
        source=TEACH_SOURCE,
    )
    summary = str((summary_data or {}).get("summary") or "").strip()
    if not summary:
        summary = (
            "Great job completing this episode! Keep practicing and your English will continue to improve."
        )

    return {"summary": summary}


@app.get("/api/teach/progress-report")
async def get_teach_progress_report(current_user=Depends(get_current_user)):
    """Build Teach learning progress report (words + tutor writing feedback)."""
    participant_code = current_user["participant_code"]
    logs = progress_manager.get_participant_progress(participant_code, source=TEACH_SOURCE)
    report = _build_progress_report_message(logs)
    return {"report": report}


@app.get("/api/teach/state", response_model=TeachClientStateResponse)
async def get_teach_client_state(current_user=Depends(get_current_user)):
    """Load persisted Teach frontend state for cross-device restore."""
    participant_code = current_user["participant_code"]
    state = progress_manager.get_participant_client_state(
        participant_code=participant_code,
        source=TEACH_SOURCE,
    )
    return TeachClientStateResponse(state=state if isinstance(state, dict) else {})


@app.post("/api/teach/state")
async def save_teach_client_state(
    request: TeachClientStateRequest,
    current_user=Depends(get_current_user),
):
    """Persist Teach frontend state for cross-device resume."""
    participant_code = current_user["participant_code"]
    state = request.state if isinstance(request.state, dict) else {}
    success = progress_manager.save_participant_client_state(
        participant_code=participant_code,
        client_state=state,
        source=TEACH_SOURCE,
    )
    return {"saved": bool(success)}


@app.get("/api/teach/outro-questionnaire", response_model=TeachOutroQuestionnaireResponse)
async def get_teach_outro_questionnaire(
    week_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    """Return the EP1 outro questionnaire text with Teach-specific dynamic links."""
    participant_code = current_user["participant_code"]
    week_number = 1
    if week_id:
        normalized = str(week_id).strip().lower()
        if normalized.startswith("week"):
            normalized = normalized[4:]
        try:
            week_number = int(normalized)
        except ValueError:
            week_number = 1
    week_number = max(1, min(4, week_number))

    from .game_handlers import build_weekly_outro_questionnaire_text

    pseudo_state = {"questionnaire_week": week_number, "current_stage": week_number}
    text = build_weekly_outro_questionnaire_text(participant_code, pseudo_state)
    return TeachOutroQuestionnaireResponse(text=text)


# Multi-stage game endpoints

@app.get("/api/game/stages")
async def get_available_stages(current_user=Depends(get_current_user)):
    """Get list of available stages for the current user."""
    participant_code = current_user["participant_code"]
    logger.info(f"Getting available stages for participant: {participant_code}")
    
    from .game_handlers import (
        get_available_stages,
        GAME_STATE,
        get_characters_for_stage,
        get_stage_location,
        get_stage_locations_info,
        ep4_nina_modal_chat_available,
        get_dialogue_mode_metadata,
        _get_stage_progress_entry,
    )
    from .game_config import STAGE_CONFIG, TOTAL_STAGES, CHARACTER_DATA
    
    # Ensure state is loaded
    if participant_code not in GAME_STATE:
        from .game_handlers import start_game_handler
        await start_game_handler(participant_code)
    
    available_stages = get_available_stages(participant_code)
    current_stage = GAME_STATE.get(participant_code, {}).get("current_stage", 1)
    stages_completed = list(GAME_STATE.get(participant_code, {}).get("stages_completed", set()))
    stage_progress = GAME_STATE.get(participant_code, {}).get("stage_progress", {})
    
    # Special test mode: for TEST/ROBERTA participants, show all stages as available
    is_test_mode = is_test_mode_participant(participant_code)
    
    # Build stage info
    stages_info = []
    game_state = GAME_STATE.get(participant_code, {})
    # For test mode, include all stages; otherwise only available ones
    stages_to_show = list(range(1, TOTAL_STAGES + 1)) if is_test_mode else available_stages

    for stage_num in stages_to_show:
        stage_config = STAGE_CONFIG.get(stage_num, {})
        progress = _get_stage_progress_entry(game_state, stage_num)
        is_available = stage_num in available_stages if not is_test_mode else True
        if stage_num == current_stage:
            character_keys = get_characters_for_stage(game_state, stage_num)
            current_location = get_stage_location(game_state, stage_num)
        else:
            default_location = stage_config.get("default_location")
            location_cfg = stage_config.get("locations", {}).get(default_location, {})
            character_keys = location_cfg.get("characters", stage_config.get("characters", []))
            current_location = default_location
        locations_info = get_stage_locations_info(game_state, stage_num)
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
            "characters": characters,
            "locations": locations_info,
        })

    return {
        "available_stages": available_stages,
        "current_stage": current_stage,
        "stages_completed": stages_completed,
        "stages_info": stages_info,
        "game_completed": bool(game_state.get("game_completed", False)),
        "ep1_usb_drive_unlocked": bool(game_state.get("ep1_usb_drive_unlocked", False)),
        "ep4_nina_chat_available": ep4_nina_modal_chat_available(game_state),
        **get_dialogue_mode_metadata(game_state),
    }


class StageSwitchRequest(BaseModel):
    stage_number: int


@app.post("/api/game/stage/switch")
async def switch_stage(request: StageSwitchRequest, current_user=Depends(get_current_user)):
    """Switch to a different stage."""
    participant_code = current_user["participant_code"]
    logger.info(f"Switching to stage {request.stage_number} for participant: {participant_code}")
    
    from .game_handlers import switch_stage, GAME_STATE
    
    # Ensure state is loaded
    if participant_code not in GAME_STATE:
        from .game_handlers import start_game_handler
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
    
    from .game_handlers import skip_stage, GAME_STATE
    
    # Ensure state is loaded
    if participant_code not in GAME_STATE:
        from .game_handlers import start_game_handler
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
    
    from .game_handlers import GAME_STATE
    
    # Ensure state is loaded
    if participant_code not in GAME_STATE:
        from .game_handlers import start_game_handler
        await start_game_handler(participant_code)
    
    state = GAME_STATE.get(participant_code, {})
    global_knowledge = state.get("global_knowledge", [])
    
    return {
        "knowledge": global_knowledge,
        "total_items": len(global_knowledge)
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

