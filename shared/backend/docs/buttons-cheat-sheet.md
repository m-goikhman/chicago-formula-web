# `game_texts` Buttons: Cheat Sheet

## `[buttons]` section

At the end of the file (after the message text):

```text
[buttons]
Button label|action_key
Second button|another_action
```

- One button = one line: `text|action`.
- Empty lines in the button list are ignored.
- `[buttons]` is stripped from the message text; buttons are usually attached to the **last** message in the chain (if the file has multiple blocks separated by `---`).

## Extra syntax in the same `.txt`

| Mechanic | Short explanation |
|----------|-------------------|
| Multiple messages | Blocks are separated by a line with `---` (or longer). |
| Sender | `[from: key]` / `[character: Name]` / `[sender: narrator]` — at the start of the file and/or at the start of each block after `---`. |
| Inline without a file | `inline::text` or `inline::key>>text` (`text` can contain `\n` for line breaks). |

Detailed parsing logic: `scripted_messages.py`.

---

## Commands in the `action` field (handled by server)

Route: `POST /api/game/action` → `request.action`.

### Onboarding

| action | Purpose |
|--------|---------|
| `onboarding_step5` | Move to language level selection (from the welcome flow). |
| *(any `onboarding_*`)* | Routed to `handle_onboarding_button` — currently `onboarding_step5` is the one effectively used. |

### Language (after level selection)

| action | Purpose |
|--------|---------|
| `language_adjust_easier` | Easier (A2 / B1 / B2). |
| `language_adjust_more_advanced` | Harder. |
| `language_confirm` | Confirm level → continue to case intro. |

### Case intro (`STAGE_CONFIG` → `intro_files`)

| action | Purpose |
|--------|---------|
| `case_intro_begin` | First intro step (after "Start Investigation!" from code). |
| `case_intro_next` | Next intro file. |

**Important:** only `case_intro_begin` and `case_intro_next` are actually handled. Other `case_intro_*` actions will not advance intro steps.

### Game and menus

| action | Purpose |
|--------|---------|
| `start_investigation` | Start investigation / main menu. |
| `show_main_menu` | Main menu. |
| `menu_talk` | "Talk" menu. |
| `menu_evidence` | Evidence. |
| `mode_public` | Public mode (Talk to Everyone). |

### Character dialogue

| action | Purpose |
|--------|---------|
| `talk_<key>` | For example `talk_tim`, `talk_nina`, `talk_james`. |

### Episode 2: locations

| action | Purpose |
|--------|---------|
| `go_default_ep2` | Default EP2 location. |
| `go_university_ep2` | University. |
| `go_alex_apartment_ep2` | Alex's apartment. |

### Evidence

| action | Purpose |
|--------|---------|
| `examine_clue_<id>` | Evidence in current episode (e.g., `examine_clue_1`). |
| `examine_ep2_clue_<id>` | Evidence, forced to EP2. |

### EP1 accusation

| action | Purpose |
|--------|---------|
| `accuse_offer_declined` | Decline accusation offer. |
| `accuse_offer_accepted` | Accept accusation offer. |
| `accuse_open_menu` | Open accusation menu. |
| `accuse_<suspect>` | Accuse: `tim`, `pauline`, `fiona`, `ronnie` (with `accuse_` prefix). |

### Misc EP1 / EP2

| action | Purpose |
|--------|---------|
| `reveal_ep1_killer` | Legacy: dumps `reveal_*.txt` in EP1. Not used in normal play (failed accusations go to Nina → Tim finale instead). |
| `share_usb_with_james` | Show USB to James (EP2). |

### Language difficulty menu

| action | Purpose |
|--------|---------|
| `language_menu_difficulty` | Difficulty selection screen. |
| `difficulty_set_A2` | Set A2 level. |
| `difficulty_set_B1` | Set B1 level. |
| `difficulty_set_B2` | Set B2 level. |
| `language_menu_progress` | Progress (from language menu). |
| `language_menu_back` | Back from language menu. |

### Fallback (if `action` matches none of the rules above)

1. **`inline::...`** — one message with text from `action` (see above).
2. **File path** in `game_texts/ep<episode>/` — for example `dialogue_openers/university_ep2/james.txt` or `accuse_why.txt` (`.txt` extension is optional).  
   Restrictions: no `..`, no absolute paths.

### EP1 special case (by file path)

When loading from `game_texts`, action `pauline_entrance_doorway` (or with `.txt`) additionally switches EP1 location to Pauline's phase.

---

## Frontend only (not sent to server as game logic)

| action | Behavior |
|--------|----------|
| `hide_message` | Handled in `Tell/frontend/js/game.js` — hides the message in UI. |

---

## Quick example

```text
[from: nina]
Short line.

---
[from: tim]
Tim's reply.

[buttons]
Next|case_intro_next
Go to menu now|show_main_menu
```

```text
[buttons]
Hint|inline::nina>>Check the note again.\nRead it line by line.
```
