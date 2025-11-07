"""
Game handlers for the web version, adapted from Telegram bot handlers.
"""

import logging
import json
import time
import random
from typing import Dict, List, Optional
from utils import load_system_prompt, combine_character_prompt, save_message_to_cache, log_message
from config import GAME_STATE, CHARACTER_DATA, SUSPECT_KEYS, TOTAL_CLUES
from game_state_manager import game_state_manager
from progress_manager import progress_manager
from ai_services import ask_for_dialogue

logger = logging.getLogger(__name__)


def generate_message_id() -> int:
    """Generate a unique message ID for web version."""
    return int(time.time() * 1000000) + random.randint(0, 1000)


def initialize_game_state(participant_code: str) -> Dict:
    """Initialize new game state for a participant."""
    return {
        "mode": "public",
        "current_character": None,
        "waiting_for_word": False,
        "accused_character": None,
        "accusation_attempts": 0,
        "reveal_step": 0,
        "custom_reveal_step": 0,
        "clues_examined": set(),
        "suspects_interrogated": set(),
        "accuse_unlocked": False,
        "topic_memory": {"topic": "Initial greeting", "spoken": [], "predefined_used": []},
        "game_completed": False,
        "participant_code": participant_code,
        "waiting_for_participant_code": False,
        "onboarding_step": "consent",
        "current_language_level": "B1"  # Default level
    }


async def start_game_handler(participant_code: str) -> List[Dict]:
    """Handle game start - return list of messages to display."""
    messages = []
    
    # Check for existing game state
    saved_state_data = await game_state_manager.load_game_state(participant_code)
    
    if saved_state_data and saved_state_data.get("state"):
        saved_state = saved_state_data["state"]
        
        # If game completed, start fresh
        if saved_state.get("game_completed"):
            logger.info(f"Participant {participant_code}: Previous game completed, starting fresh")
            await game_state_manager.delete_game_state(participant_code)
            progress_manager.clear_user_progress(participant_code, participant_code)
    
    # Initialize or restore game state
    if participant_code not in GAME_STATE:
        GAME_STATE[participant_code] = initialize_game_state(participant_code)
        logger.info(f"Participant {participant_code}: Game state initialized")
    
    state = GAME_STATE[participant_code]
    
    # Start with welcome message
    welcome_text = load_system_prompt("game_texts/onboarding_1_welcome.txt")
    
    # Log system message
    log_message(0, "system", welcome_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, welcome_text)
    messages.append({
        "type": "system",
        "content": welcome_text,
        "message_id": message_id,
        "show_explain": True,
        "buttons": [
            {"text": "🎯 Find Your Language Level", "action": "onboarding_step5"}
        ]
    })
    
    state["onboarding_step"] = "welcome_shown"
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_onboarding_button(participant_code: str, action: str) -> List[Dict]:
    """Handle onboarding button clicks."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized. Please restart."}]
    
    if action == "onboarding_step5":
        # Show language level selection text first (without buttons)
        language_level_text = load_system_prompt("game_texts/onboarding_4_language_level.txt")
        
        # Log first message
        log_message(0, "system", language_level_text, participant_code)
        
        message_id1 = generate_message_id()
        save_message_to_cache(message_id1, language_level_text)
        messages.append({
            "type": "system",
            "content": language_level_text,
            "message_id": message_id1,
            "show_explain": True
        })
        
        # Then show intro-B1 text separately with typewriter style and buttons
        intro_b1_text = load_system_prompt("game_texts/intro-B1.txt")
        
        # Log second message
        log_message(0, "system", intro_b1_text, participant_code)
        
        message_id2 = generate_message_id()
        save_message_to_cache(message_id2, intro_b1_text)
        messages.append({
            "type": "system",
            "content": intro_b1_text,
            "message_id": message_id2,
            "show_explain": True,
            "typewriter_style": True,
            "buttons": [
                {"text": "Easier", "action": "language_adjust_easier"},
                {"text": "Perfect!", "action": "language_confirm"},
                {"text": "More Advanced", "action": "language_adjust_more_advanced"}
            ]
        })
        
        state["onboarding_step"] = "language_selection"
        state["current_language_level"] = "B1"  # Default to B1
        state["current_intro_text"] = intro_b1_text
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_language_adjustment(participant_code: str, action: str) -> List[Dict]:
    """Handle language level adjustments (easier/more advanced)."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    current_level = state.get("current_language_level", "B1")
    language_level_text = load_system_prompt("game_texts/onboarding_4_language_level.txt")
    
    # Determine new level and intro text
    if action == "language_adjust_easier":
        if current_level == "B2":
            new_level = "B1"
            intro_text = load_system_prompt("game_texts/intro-B1.txt")
            buttons = [
                {"text": "Easier", "action": "language_adjust_easier"},
                {"text": "Perfect!", "action": "language_confirm"},
                {"text": "More Advanced", "action": "language_adjust_more_advanced"}
            ]
        elif current_level == "B1":
            new_level = "A2"
            intro_text = load_system_prompt("game_texts/intro-A2.txt")
            buttons = [
                {"text": "Perfect!", "action": "language_confirm"},
                {"text": "More Advanced", "action": "language_adjust_more_advanced"}
            ]
        else:
            # Already at A2, can't go easier
            return messages
    
    elif action == "language_adjust_more_advanced":
        if current_level == "A2":
            new_level = "B1"
            intro_text = load_system_prompt("game_texts/intro-B1.txt")
            buttons = [
                {"text": "Easier", "action": "language_adjust_easier"},
                {"text": "Perfect!", "action": "language_confirm"},
                {"text": "More Advanced", "action": "language_adjust_more_advanced"}
            ]
        elif current_level == "B1":
            new_level = "B2"
            intro_text = load_system_prompt("game_texts/intro-B2.txt")
            buttons = [
                {"text": "Easier", "action": "language_adjust_easier"},
                {"text": "Perfect!", "action": "language_confirm"}
            ]
        else:
            # Already at B2, can't go more advanced
            return messages
    
    else:
        return messages
    
    # Update state
    state["current_language_level"] = new_level
    state["current_intro_text"] = intro_text
    
    # Show updated intro text (old message will be removed by frontend)
    # Log system message
    log_message(0, "system", intro_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, intro_text)
    messages.append({
        "type": "system",
        "content": intro_text,
        "message_id": message_id,
        "show_explain": True,
        "typewriter_style": True,
        "buttons": buttons
    })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_language_confirmation(participant_code: str) -> List[Dict]:
    """Handle language level confirmation and proceed to game."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    # Get confirmed level
    level = state.get("current_language_level", "B1")
    
    # Show confirmation
    level_confirmed_text = load_system_prompt("game_texts/level_confirmed.txt")
    confirmed_text = level_confirmed_text.replace("[LEVEL]", level.upper())
    
    # Log system message
    log_message(0, "system", confirmed_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, confirmed_text)
    messages.append({
        "type": "system",
        "content": confirmed_text,
        "message_id": message_id,
        "show_explain": True,
        "buttons": [
            {"text": "Start Investigation!", "action": "case_intro_begin"}
        ]
    })
    
    state["onboarding_step"] = "language_selected"
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_case_intro(participant_code: str, action: str) -> List[Dict]:
    """Handle case introduction sequence."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    if action == "case_intro_begin":
        # Show atmospheric start
        atmospheric_text = load_system_prompt("game_texts/atmospheric_start.txt")
        
        # Log narrator/system message
        log_message(0, "narrator", atmospheric_text, participant_code)
        
        message_id = generate_message_id()
        save_message_to_cache(message_id, atmospheric_text)
        messages.append({
            "type": "system",
            "content": atmospheric_text,
            "image": "aric-cheng-7Bv9MrBan9s-unsplash.jpg",
            "message_id": message_id,
            "show_explain": True,
            "buttons": [
                {"text": "Accept the Call", "action": "case_intro_call"}
            ]
        })
    
    elif action == "case_intro_call":
        # Call introduction
        call_text = load_system_prompt("game_texts/case_intro_1_call.txt")
        
        # Log narrator/system message
        log_message(0, "narrator", call_text, participant_code)
        
        message_id = generate_message_id()
        save_message_to_cache(message_id, call_text)
        messages.append({
            "type": "system",
            "content": call_text,
            "message_id": message_id,
            "show_explain": True,
            "buttons": [
                {"text": "What happened?", "action": "case_intro_situation"}
            ]
        })
    
    elif action == "case_intro_situation":
        # Situation description
        situation_text = load_system_prompt("game_texts/case_intro_2_situation.txt")
        
        # Log narrator/system message
        log_message(0, "narrator", situation_text, participant_code)
        
        message_id = generate_message_id()
        save_message_to_cache(message_id, situation_text)
        messages.append({
            "type": "system",
            "content": situation_text,
            "message_id": message_id,
            "show_explain": True,
            "buttons": [
                {"text": "Who is there?", "action": "case_intro_suspects"}
            ]
        })
    
    elif action == "case_intro_suspects":
        # Suspects introduction
        suspects_text = load_system_prompt("game_texts/case_intro_3_suspects.txt")
        
        # Log narrator/system message
        log_message(0, "narrator", suspects_text, participant_code)
        
        message_id = generate_message_id()
        save_message_to_cache(message_id, suspects_text)
        messages.append({
            "type": "system",
            "content": suspects_text,
            "image": "suspects.png",
            "message_id": message_id,
            "show_explain": True,
            "buttons": [
                {"text": "Start Investigation!", "action": "start_investigation"}
            ]
        })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def start_investigation(participant_code: str) -> List[Dict]:
    """Start the main investigation."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    # Show main menu
    investigation_text = "🎭 You're now at the crime scene. Choose your next action:"
    
    # Log system message
    log_message(0, "system", investigation_text, participant_code)
    
    messages.append({
        "type": "system",
        "content": investigation_text,
        "buttons": [
            {"text": "🔍 Game Menu", "action": "show_main_menu"}
        ]
    })
    
    state["onboarding_step"] = "investigation_started"
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_main_menu(participant_code: str) -> List[Dict]:
    """Show main game menu."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    menu_text = "What would you like to do?"
    
    # Log menu message
    log_message(0, "menu", menu_text, participant_code)
    
    messages.append({
        "type": "menu",
        "content": menu_text,
        "buttons": [
            {"text": "💬 Talk to Someone", "action": "menu_talk"},
            {"text": "🔍 Examine Evidence", "action": "menu_evidence"},
            {"text": "✍️ Learning Menu", "action": "menu_learning"}
        ]
    })
    
    return messages


async def handle_menu_talk(participant_code: str) -> List[Dict]:
    """Show character selection for talking."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    buttons = [{"text": "💬 Talk to Everyone (Public)", "action": "mode_public"}]
    
    # Add character buttons
    for key in SUSPECT_KEYS:
        if key in CHARACTER_DATA:
            char_data = CHARACTER_DATA[key]
            buttons.append({
                "text": f"{char_data['emoji']} Talk to {char_data['full_name']}",
                "action": f"talk_{key}"
            })
    
    buttons.append({"text": "⬅️ Back to Main Menu", "action": "show_main_menu"})
    
    menu_text = "Choose your conversation partner:"
    
    # Log menu message
    log_message(0, "menu", menu_text, participant_code)
    
    messages.append({
        "type": "menu",
        "content": menu_text,
        "buttons": buttons
    })
    
    return messages


async def handle_character_talk(participant_code: str, character_key: str) -> List[Dict]:
    """Initiate conversation with a specific character."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    if character_key not in CHARACTER_DATA:
        return [{"type": "error", "content": "Invalid character."}]
    
    # Set mode to private
    state["mode"] = "private"
    state["current_character"] = character_key
    
    char_data = CHARACTER_DATA[character_key]
    char_name = char_data["full_name"]
    
    # Get current language level
    current_language_level = state.get("current_language_level", "B1")
    
    # Generate narrator transition
    try:
        narrator_prompt = combine_character_prompt("narrator", current_language_level)
        description_text = await ask_for_dialogue(
            participant_code, 
            f"Describe the detective taking {char_name} aside for a private talk.",
            narrator_prompt, 
            "narrator"
        )
        
        # Log narrator message
        log_message(0, "narrator", description_text, participant_code)
        
        message_id = generate_message_id()
        save_message_to_cache(message_id, description_text, "narrator")
        messages.append({
            "type": "character",
            "character": "narrator",
            "character_name": "Narrator",
            "content": description_text,
            "message_id": message_id,
            "show_explain": True
        })
    except Exception as e:
        logger.error(f"Failed to generate narrator transition: {e}")
        fallback_text = f"You take {char_name} aside for a private conversation."
        
        # Log narrator message
        log_message(0, "narrator", fallback_text, participant_code)
        
        message_id = generate_message_id()
        save_message_to_cache(message_id, fallback_text, "narrator")
        messages.append({
            "type": "character",
            "character": "narrator",
            "character_name": "Narrator",
            "content": fallback_text,
            "message_id": message_id,
            "show_explain": True
        })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_private_message(participant_code: str, message_text: str) -> List[Dict]:
    """Handle message in private conversation mode."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    char_key = state.get("current_character")
    
    if not char_key or char_key not in CHARACTER_DATA:
        return [{"type": "error", "content": "No active character conversation."}]
    
    char_data = CHARACTER_DATA[char_key]
    
    # Check if this is first interrogation
    if char_key in SUSPECT_KEYS and char_key not in state.get("suspects_interrogated", set()):
        state.setdefault("suspects_interrogated", set()).add(char_key)
        # Note: Accuse unlock logic would go here
    
    # Get current language level
    current_language_level = state.get("current_language_level", "B1")
    system_prompt = combine_character_prompt(char_key, current_language_level)
    
    # Create context trigger
    topic_memory = state.get("topic_memory", {"topic": "None", "spoken": [], "predefined_used": []})
    context_trigger = f"The detective is asking you a question: '{message_text}'. Current topic: {topic_memory.get('topic', 'None')}."
    context_trigger += " Respond as your character."
    
    logger.info(f"Participant {participant_code}: Direct character conversation with '{char_key}'")
    
    # Log user message
    log_message(0, "user", message_text, participant_code)
    
    try:
        reply_text = await ask_for_dialogue(
            participant_code,
            context_trigger,
            system_prompt,
            char_key
        )
        
        if reply_text:
            message_id = generate_message_id()
            save_message_to_cache(message_id, reply_text, char_key)
            
            # Log character response
            log_message(0, f"character_{char_key}", reply_text, participant_code)
            
            messages.append({
                "type": "character",
                "character": char_key,
                "character_name": char_data["full_name"],
                "character_emoji": char_data["emoji"],
                "character_image": char_data.get("image"),
                "content": reply_text,
                "message_id": message_id,
                "show_explain": True
            })
        else:
            logger.error(f"Character '{char_key}' generated empty reply")
            messages.append({
                "type": "character",
                "character": char_key,
                "character_name": char_data["full_name"],
                "character_emoji": char_data["emoji"],
                "character_image": char_data.get("image"),
                "content": "[Character is thinking...]",
                "show_explain": False
            })
    except Exception as e:
        logger.error(f"Failed to get character reply from '{char_key}': {e}")
        messages.append({
            "type": "character",
            "character": char_key,
            "character_name": char_data["full_name"],
            "character_emoji": char_data["emoji"],
            "character_image": char_data.get("image"),
            "content": "[Character is thinking...]",
            "show_explain": False
        })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_public_message(participant_code: str, message_text: str) -> List[Dict]:
    """Handle message in public conversation mode using director logic."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    # First, check for direct character addressing
    from predefined_responses import extract_character_from_message_strict
    
    character_key = extract_character_from_message_strict(message_text)
    if character_key and character_key in CHARACTER_DATA:
        # Handle direct character addressing
        char_data = CHARACTER_DATA[character_key]
        
        # Get current language level
        current_language_level = state.get("current_language_level", "B1")
        system_prompt = combine_character_prompt(character_key, current_language_level)
        
        # Create context trigger
        topic_memory = state.get("topic_memory", {"topic": "None", "spoken": [], "predefined_used": []})
        context_trigger = f"The detective is directly addressing you with this question: '{message_text}'. Current topic: {topic_memory.get('topic', 'None')}. Respond as your character."
        
        logger.info(f"Participant {participant_code}: Direct addressing detected for character '{character_key}'")
        
        # Log user message
        log_message(0, "user", message_text, participant_code)
        
        try:
            reply_text = await ask_for_dialogue(
                participant_code,
                context_trigger,
                system_prompt,
                character_key
            )
            
            if reply_text:
                message_id = generate_message_id()
                save_message_to_cache(message_id, reply_text, character_key)
                
                # Log character response
                log_message(0, f"character_{character_key}", reply_text, participant_code)
                
                messages.append({
                    "type": "character",
                    "character": character_key,
                    "character_name": char_data["full_name"],
                    "character_emoji": char_data["emoji"],
                    "character_image": char_data.get("image"),
                    "content": reply_text,
                    "message_id": message_id,
                    "show_explain": True
                })
            else:
                logger.error(f"Character '{character_key}' generated empty reply for direct addressing")
                messages.append({
                    "type": "character",
                    "character": character_key,
                    "character_name": char_data["full_name"],
                    "character_emoji": char_data["emoji"],
                    "character_image": char_data.get("image"),
                    "content": "[Character is thinking...]",
                    "show_explain": False
                })
        except Exception as e:
            logger.error(f"Failed to get direct character reply from '{character_key}': {e}")
            messages.append({
                "type": "character",
                "character": character_key,
                "character_name": char_data["full_name"],
                "character_emoji": char_data["emoji"],
                "character_image": char_data.get("image"),
                "content": "[Character is thinking...]",
                "show_explain": False
            })
        
        # Save state
        await game_state_manager.save_game_state(participant_code, state)
        
        return messages
    
    # No direct addressing, use director logic
    topic_memory = state.get("topic_memory", {"topic": "None", "spoken": [], "predefined_used": []})
    context_for_director = f"Player asks everyone. Topic Memory: {json.dumps(topic_memory)}"
    
    # Log user message
    log_message(0, "user", message_text, participant_code)
    
    logger.info(f"Participant {participant_code}: Getting director decision for public mode")
    logger.info(f"Participant {participant_code}: Context: {context_for_director}")
    logger.info(f"Participant {participant_code}: User text: {message_text}")
    
    # Import director function
    from ai_services import ask_director
    
    director_decision = await ask_director(participant_code, context_for_director, message_text)
    logger.info(f"Participant {participant_code}: Director decision received")
    
    scene = director_decision.get("scene", [])
    new_topic = director_decision.get("new_topic", topic_memory["topic"])
    
    # Update topic memory
    state["topic_memory"]["topic"] = new_topic
    if new_topic != topic_memory.get("topic"):
        # Reset spoken list but preserve predefined_used when topic changes
        state["topic_memory"]["spoken"] = []
        if "predefined_used" not in state["topic_memory"]:
            state["topic_memory"]["predefined_used"] = []
    
    if not scene:
        logger.warning(f"Participant {participant_code}: Director returned an empty scene")
        return [{"type": "system", "content": "The investigation continues..."}]
    
    # Execute scene actions
    logger.info(f"Participant {participant_code}: Executing scene with {len(scene)} actions")
    for scene_action in scene:
        action_type = scene_action.get("action")
        data = scene_action.get("data", {})
        
        if action_type == "director_note":
            # Director narrative/guidance message
            message = data.get("message", "The investigation continues...")
            
            # Log director note
            log_message(0, "director_note", message, participant_code)
            
            messages.append({
                "type": "system",
                "content": message
            })
            
        elif action_type in ["character_reply", "character_reaction"]:
            char_key = data.get("character_key")
            trigger_msg = data.get("trigger_message")
            
            if char_key in CHARACTER_DATA and trigger_msg:
                char_data = CHARACTER_DATA[char_key]
                
                # Get current language level
                current_language_level = state.get("current_language_level", "B1")
                system_prompt = combine_character_prompt(char_key, current_language_level)
                
                try:
                    reply_text = await ask_for_dialogue(
                        participant_code,
                        trigger_msg,
                        system_prompt,
                        char_key
                    )
                    
                    if reply_text:
                        message_id = generate_message_id()
                        save_message_to_cache(message_id, reply_text, char_key)
                        
                        # Log character response
                        log_message(0, f"character_{char_key}", reply_text, participant_code)
                        
                        messages.append({
                            "type": "character",
                            "character": char_key,
                            "character_name": char_data["full_name"],
                            "character_emoji": char_data["emoji"],
                            "character_image": char_data.get("image"),
                            "content": reply_text,
                            "message_id": message_id,
                            "show_explain": True
                        })
                        
                        # Mark character as having spoken on this topic
                        state["topic_memory"]["spoken"].append(char_key)
                    else:
                        logger.error(f"Character '{char_key}' generated empty reply")
                        messages.append({
                            "type": "character",
                            "character": char_key,
                            "character_name": char_data["full_name"],
                            "character_emoji": char_data["emoji"],
                            "character_image": char_data.get("image"),
                            "content": "[Character is thinking...]",
                            "show_explain": False
                        })
                        
                except Exception as e:
                    logger.error(f"Failed to get character reply from '{char_key}': {e}")
                    messages.append({
                        "type": "character",
                        "character": char_key,
                        "character_name": char_data["full_name"],
                        "character_emoji": char_data["emoji"],
                        "character_image": char_data.get("image"),
                        "content": "[Character is thinking...]",
                        "show_explain": False
                    })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_mode_public(participant_code: str) -> List[Dict]:
    """Switch to public mode."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    state["mode"] = "public"
    state["current_character"] = None
    
    mode_text = "💬 You're now speaking with everyone in public. Ask your questions!"
    
    # Log system message
    log_message(0, "system", mode_text, participant_code)
    
    messages.append({
        "type": "system",
        "content": mode_text,
    })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_menu_evidence(participant_code: str) -> List[Dict]:
    """Show evidence/clue selection menu."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    buttons = []
    for i in range(1, TOTAL_CLUES + 1):
        clue_id = str(i)
        buttons.append({
            "text": f"🔍 Clue {i}",
            "action": f"examine_clue_{clue_id}"
        })
    
    buttons.append({"text": "⬅️ Back to Main Menu", "action": "show_main_menu"})
    
    menu_text = "Select evidence to examine:"
    
    # Log menu message
    log_message(0, "menu", menu_text, participant_code)
    
    messages.append({
        "type": "menu",
        "content": menu_text,
        "buttons": buttons
    })
    
    return messages


async def handle_clue_examination(participant_code: str, clue_id: str) -> List[Dict]:
    """Handle examination of a specific clue."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    # Load clue text
    clue_filepath = f"game_texts/Clue{clue_id}.txt"
    try:
        clue_text = load_system_prompt(clue_filepath)
    except Exception as e:
        logger.error(f"Failed to load clue {clue_id}: {e}")
        clue_text = f"Error loading clue {clue_id}"
    
    # Mark clue as examined in state
    state.setdefault("clues_examined", set()).add(clue_id)
    
    # Log clue examination
    log_message(0, "clue_examined", f"Clue {clue_id}: {clue_text}", participant_code)
    
    messages.append({
        "type": "clue",
        "clue_id": clue_id,
        "content": clue_text,
        "image": f"clue{clue_id}.png"
    })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


# Language Learning Menu Handlers

async def handle_language_menu_difficulty(participant_code: str) -> List[Dict]:
    """Show difficulty selection menu for language level."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    current_level = state.get("current_language_level", "B1")
    
    # Build buttons based on current level
    buttons = []
    
    if current_level != "A2":
        buttons.append({"text": "🌱 Light (A2)", "action": "difficulty_set_A2"})
    
    buttons.append({"text": "⚖️ Balanced (B1)", "action": "difficulty_set_B1"})
    
    if current_level != "B2":
        buttons.append({"text": "🚀 Advanced (B2)", "action": "difficulty_set_B2"})
    
    buttons.append({"text": "⬅️ Back", "action": "language_menu_back"})
    
    message_id = generate_message_id()
    text = f"⚙️ **Text Difficulty Settings**\n\nCurrent level: **{current_level}**\n\nChoose your preferred difficulty level:\n\n🌱 **Light (A2)** - Simple vocabulary and grammar\n⚖️ **Balanced (B1)** - Intermediate level, balanced complexity\n🚀 **Advanced (B2)** - More complex structures and vocabulary"
    
    # Log system message
    log_message(0, "system", text, participant_code)
    
    save_message_to_cache(message_id, text)
    
    messages.append({
        "type": "system",
        "content": text,
        "message_id": message_id,
        "show_explain": False,
        "buttons": buttons
    })
    
    return messages


async def handle_difficulty_set(participant_code: str, new_level: str) -> List[Dict]:
    """Set language difficulty level."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    old_level = state.get("current_language_level", "B1")
    
    # Update the language level
    state["current_language_level"] = new_level
    
    # Save the updated state
    await game_state_manager.save_game_state(participant_code, state)
    
    logger.info(f"Participant {participant_code}: Changed text difficulty from {old_level} to {new_level}")
    
    # Show confirmation
    message_id = generate_message_id()
    text = f"✅ **Difficulty Updated!**\n\nYour text difficulty has been changed from **{old_level}** to **{new_level}**.\n\nThis setting will apply to all new conversations and character interactions. You can change it anytime from the Language Learning menu."
    
    # Log system message
    log_message(0, "system", text, participant_code)
    
    save_message_to_cache(message_id, text)
    
    messages.append({
        "type": "system",
        "content": text,
        "message_id": message_id,
        "show_explain": False,
        "buttons": [
            {"text": "⬅️ Back", "action": "language_menu_difficulty"}
        ]
    })
    
    return messages


async def handle_language_menu_progress(participant_code: str) -> List[Dict]:
    """Show language progress report."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    # Get progress data from progress manager
    # Use 0 as user_id since we're using participant_code for identification in web version
    # This will load from: participant_logs/language_progress/web_{participant_code}_language_progress.json
    # (Note: 'web_' prefix separates web version data from Telegram bot data)
    logger.info(f"Participant {participant_code}: Loading progress from: participant_logs/language_progress/web_{participant_code}_language_progress.json")
    logs = progress_manager.get_user_progress(0, participant_code)
    
    logger.info(f"Participant {participant_code}: Progress data received - words_learned: {len(logs.get('words_learned', []))}, writing_feedback: {len(logs.get('writing_feedback', []))}")
    
    # Log recent feedback entries for debugging
    if logs.get("writing_feedback"):
        recent_feedback = logs["writing_feedback"][-5:]  # Last 5 entries
        logger.info(f"Participant {participant_code}: Recent feedback entries: {[entry.get('query', '')[:50] for entry in recent_feedback]}")
    
    # Check if there's any progress data
    if not logs.get("words_learned") and not logs.get("writing_feedback"):
        message_id = generate_message_id()
        text = "📊 **Your Progress Report**\n\nYou don't have any saved progress yet! Keep playing and asking for explanations to build your learning history."
        
        # Log system message
        log_message(0, "system", text, participant_code)
        
        save_message_to_cache(message_id, text)
        
        messages.append({
            "type": "system",
            "content": text,
            "message_id": message_id,
            "show_explain": False,
            "buttons": [
                {"text": "Hide the message", "action": "hide_message"}
            ]
        })
        return messages
    
    # Build progress report
    report_title = "Your Progress Report"
    report = f"--- \n**{report_title}**\n---\n\n"
    
    if logs.get("words_learned"):
        report += "**Words You've Learned:**\n"
        for entry in logs["words_learned"]:
            word = entry.get('query', '')
            definition = entry.get('feedback', '')
            report += f"• **{word}**: {definition}\n"
        report += "\n"
    
    if logs.get("writing_feedback"):
        report += "**My Feedback on Your Phrases:**\n"
        for entry in logs["writing_feedback"]:
            query = entry.get('query', '')
            feedback = entry.get('feedback', '')
            report += f"📖 *You wrote:* {query}\n"
            report += f"✅ **My suggestion:** {feedback}\n\n"
    
    message_id = generate_message_id()
    
    # Log system message
    log_message(0, "system", report, participant_code)
    
    save_message_to_cache(message_id, report)
    
    messages.append({
        "type": "system",
        "content": report,
        "message_id": message_id,
        "show_explain": False,
        "buttons": [
            {"text": "Hide the message", "action": "hide_message"}
        ]
    })
    
    return messages


async def handle_language_menu_back(participant_code: str) -> List[Dict]:
    """Return to language menu (placeholder, can close menu or show main menu)."""
    # Just close the menu by returning empty messages
    # Frontend will handle closing the dropdown
    return []


async def analyze_and_log_user_text(participant_code: str, text: str):
    """Silently analyze user text and log feedback if improvements are needed.
    
    Note: This analyzes only text from the web version user, identified by participant_code.
    Data is stored in participant_logs/language_progress/web_{participant_code}_language_progress.json
    (Note: 'web_' prefix separates web version data from Telegram bot data)
    """
    from ai_services import ask_tutor_for_analysis
    
    logger.info(f"Participant {participant_code}: Analyzing text from WEB version: '{text[:100]}...'")
    
    # Use 0 as user_id since we're using participant_code for identification in web version
    analysis_result = await ask_tutor_for_analysis(0, text)
    
    if analysis_result.get("improvement_needed"):
        feedback = analysis_result.get("feedback", "")
        logger.info(f"Participant {participant_code}: Tutor feedback needed. Saving to: participant_logs/language_progress/web_{participant_code}_language_progress.json")
        logger.info(f"Feedback: '{feedback[:100]}...'")
        # Use progress manager to save feedback - will use participant_code for file path
        success = progress_manager.add_writing_feedback(0, text, feedback, participant_code)
        if success:
            logger.info(f"Participant {participant_code}: Successfully saved feedback to progress manager")
        else:
            logger.error(f"Participant {participant_code}: Failed to save feedback to progress manager")
