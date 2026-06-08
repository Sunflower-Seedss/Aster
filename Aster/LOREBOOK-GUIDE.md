# DreamJourney Lorebooks: Complete Technical Guide

**For:** Future AI instances organizing and understanding DreamJourney lorebooks  
**Scope:** Platform mechanics, lorebook formatting, trigger matching, cascades, weights, and Aster integration  
**Audience:** Zero prior knowledge assumed; all concepts explained from first principles

---

## Part 1: DreamJourney AI Platform Overview

### What is DreamJourney?

DreamJourney AI (https://www.dreamjourneyai.com) is a web-based creative writing platform that lets users chat with AI bots (characters). It's a **Next.js SPA** (Single Page Application) that doesn't reload between navigations — route changes are detected via `history.pushState/replaceState` and polling.

**Key pages:**
- `/app/session/{sessionId}` — A chat with a specific bot
- `/app/create/bot/{botId}` — Bot creation/editing form
- `/app/dashboard` and other non-chat pages

### What are Bots?

Bots are AI personas that users create and customize. Each bot has:
- **Text fields:** name, description, greeting, personality traits, context, author note, etc.
- **Attachments:** up to **4 lorebooks** — 3 "bot lorebooks" + 1 "persona lorebook"
- **Metadata:** visibility, NSFW flag, content warnings, category, tags, images

When a user chats with a bot, DreamJourney's backend includes the bot's context, the currently selected lorebooks, and the chat history in the API call to the LLM.

---

## Part 2: What is Aster?

Aster is a Manifest V3 Chromium browser extension that adds quality-of-life tools to DreamJourney AI. It injects a floating panel into chat pages and creator pages.

### Core Features

1. **Chat Tools**
   - **Session stats** — Live count of user/bot messages, rerolls since Memory Nexus
   - **Saved replies** — Capture regenerated bot messages for comparison
   - **Scratchpad** — Draft unsent messages, keep the last 5
   - **Quill AI assistant** — Optional: connect your own local LLM or API

2. **Creator Tools**
   - **Bot export/import** — Download a complete bot snapshot (all fields + dropdowns), re-import to another bot
   - **Lorebook tools** — Load, test, and manage multiple lorebooks
   - **Active Chat Scanner** — Live highlight triggers in the current chat (CSS Custom Highlight API)
   - **Active Chat Panel** — Real-time token budget tracker for loaded lorebooks
   - **Lorebook Workshop** — Merge, wrap, validate lorebooks

3. **Panel Management**
   - Collapsible cards (remember state)
   - Draggable, resizable
   - Two skins (DreamJourney + Sunflowers) with light/dark themes
   - All data stored locally in `chrome.storage.local` — nothing uploaded

### Version 2.2 Addition: 4-Slot Lorebook System

Previously, Aster could only load 1 active lorebook at a time. **V2.2 introduces 4 slots:**
- **Bot Lorebook 1, 2, 3** — Attach bot-specific lorebooks
- **Persona Lorebook** — Character-specific lore

Users can load all 4 simultaneously. When analyzing messages, Aster merges all entries and shows which slot each came from.

---

## Part 3: Lorebook Fundamentals

### What is a Lorebook?

A lorebook is a **structured JSON file** that defines a collection of **entries**. Each entry has:
- **Trigger keys** — Words/phrases that activate the entry when found in chat text
- **Description** — The lore content that gets inserted into the model's context
- **Metadata** — Weight, pinning status, visibility, type, etc.

**Purpose:** When a user or bot writes a message containing a trigger, DreamJourney's backend matches it against all loaded lorebook entries and inserts matching entries into the context window — so the model has relevant lore available when generating its response.

### Lorebook JSON Structure

```json
{
  "name": "My World",
  "description": "Lorebook for a fantasy setting",
  "entries": [
    {
      "name": "Imperium Divinum",
      "description": "An ancient empire that ruled for 3000 years. Known for...",
      "keys": [
        { "keyText": "Imperium", "disabled": false },
        { "keyText": "Imperium Divinum", "disabled": false }
      ],
      "weight": 8,
      "pinned": false,
      "hidden": false,
      "type": "place"
    },
    {
      "name": "Thalia",
      "description": "A mage with silver eyes and forbidden knowledge...",
      "keys": [
        { "keyText": "Thalia", "disabled": false },
        { "keyText": "_thalia_", "disabled": false }
      ],
      "weight": 5,
      "pinned": true,
      "hidden": false,
      "type": "character"
    }
  ]
}
```

**Required fields:**
- `entries` — Array of entry objects
- Each entry must have `name` and at least one key in `keys` array with a non-empty `keyText`

**Optional fields:**
- `name`, `description` — Metadata about the lorebook itself
- `weight`, `type`, `hidden` — Per-entry metadata

---

## Part 4: How Trigger Matching Works

### The Word Boundary Rule

DreamJourney's trigger matcher uses **word boundary detection**. A trigger only matches if it:
1. **Is preceded by a non-word character** (space, punctuation, or start of text)
2. **Is followed by a non-word character** (space, punctuation, or end of text)
3. **Case-insensitive** — "Thalia" matches "thalia" or "THALIA"

**Word characters:** `[a-z0-9_]` (letters, digits, and underscore)

### Example: Multi-Word Triggers

```
Trigger: "Imperium Divinum"
Chat text: "The Imperium Divinum collapsed."

Match? YES
- "The " (space before) + "Imperium" + " " (space in middle is OK) + "Divinum" + "." (punctuation after)
- Both words have valid boundaries
```

```
Trigger: "Imperium Divinum"
Chat text: "The Imperiums Divinum collapsed."

Match? NO
- "Imperium" is followed by "s" (word character), so no boundary
```

### Trigger Wrapping: The Underscore Convention

Triggers can be **explicitly wrapped** to prevent accidental matches. Common wrapping styles:

```
_trigger_        (underscore wrap)
/trigger/        (forward slash wrap)
-trigger-        (hyphen wrap)
<trigger>        (angle bracket wrap)
```

**Important:** In Aster's implementation, the underscore is treated as a **word character**. This means:

```
Wrapped: "_Imperium Divinum_"
Chat text: "The _Imperium Divinum_ is ancient."

Match? NO (underscores count as word boundaries)
- Before "Imperium": "_" is a word character, so no boundary
- After "Divinum": "_" is a word character, so no boundary
- The entry is protected from matching
```

But what about multi-word wraps?

```
Wrapped: "_Imperium Divinum_"
Chat text: "Someone mentioned _Imperium Divinum_ in passing."

When Aster's trigger matcher checks the internal "Imperium":
- Before "Imperium": "_" (word char) — no match!
- The whole entry is protected (only direct exact-wrap matches are stripped)
```

**Summary:** Underscore wraps work because:
1. When you write `_Imperium Divinum_` as a trigger, you're wrapping the ENTIRE phrase
2. The internal space doesn't create a match for "Imperium" alone because the `_` before it is a word character
3. If the chat has an unwrapped "Imperium", it won't accidentally trigger the wrapped entry

---

## Part 5: Direct Hits vs. Cascades

### Direct Hits

A **direct hit** is when a trigger from an entry matches in the user or bot's message.

```
Entry "Thalia":
  keys: ["Thalia"]
  description: "A mage with silver eyes..."

Chat message: "Thalia walks into the tavern."

Result: DIRECT HIT
- "Thalia" is found in the chat text
- The entry is activated
```

### Cascades (Recursive Activation)

A **cascade** is when an activated entry's description contains a trigger that matches another entry's key — causing a chain reaction.

```
Entry 1 "Silver Eyes" (ACTIVATED directly):
  keys: ["Silver Eyes", "silver eyes"]
  description: "A rare trait found only in mages of the Thalia lineage. 
                These eyes grant..."

Entry 2 "Thalia Lineage":
  keys: ["Thalia", "Thalia lineage", "lineage"]
  description: "An ancient bloodline of powerful mages..."

Process:
1. Chat has "silver eyes" → Direct hit on Entry 1
2. Entry 1 is activated, its description is scanned
3. Description contains "Thalia" → Matches Entry 2's key
4. Entry 2 is activated (CASCADE)
5. Continue scanning Entry 2's description for other triggers (BFS)
```

**Cascade Algorithm (BFS):**
1. Start with all directly activated entries (pinned + direct hits)
2. Queue them up
3. For each queued entry, scan its description for triggers
4. Any new matches are added to the queue
5. Continue until the queue is empty

**Key rule:** Only use `lbFindUnwrapped()` for cascades — entries with protective wraps (`/x/`, `-x-`, `<x>`, `_x_`) are NOT included in cascades.

---

## Part 6: Entry Weights, Pinning, and Token Budget

### Weight System

Each entry has an optional `weight` (default: 5, range: typically 1-10).

**Purpose:** When multiple entries are activated, they're sorted by:
1. **Pinned entries first** (always included)
2. **Then by weight descending** (higher weight = higher priority)

```
Activated entries:
- "Ancient Thalia" (pinned: true, weight: 8)
- "Silver Eyes" (pinned: false, weight: 9)
- "Tavern" (pinned: false, weight: 3)

Sort order:
1. "Ancient Thalia" (pinned)
2. "Silver Eyes" (weight 9)
3. "Tavern" (weight 3)
```

### Pinning

Entries can be marked `"pinned": true`. Pinned entries are:
- Always included in the context
- Never affected by token budget cuts
- Appear first in the loaded entries

**Use case:** Critical lore that should always be available (main character backstory, world rules, etc.)

### Token Budget

DreamJourney has a **1500-token context limit** for lorebook entries. When loading entries:

1. **Estimate tokens:** `Math.round(description.length / 4)` (rough 1 token ≈ 4 characters)
2. **Sort entries:** Pinned first, then by weight
3. **Load sequentially** until reaching 1500 tokens
4. **Cut entries:** Entries that exceed the budget are marked as "cut" and not loaded

**Example:**
```
Activated entries (in order):
1. "Pinned Lore" (500 tokens, pinned)
2. "Character A" (400 tokens)
3. "Character B" (300 tokens)
4. "World Fact" (200 tokens)

Budget: 1500 tokens

Loading:
- Pinned Lore: 0 + 500 = 500 ✓
- Character A: 500 + 400 = 900 ✓
- Character B: 900 + 300 = 1200 ✓
- World Fact: 1200 + 200 = 1400 ✓
- (If there were more, they'd be cut)
```

**Important:** Token estimate is approximate. The actual token count depends on the model's tokenizer.

---

## Part 7: Hidden Entries and Other Metadata

### Hidden Entries

Entries can have `"hidden": true`. This means:
- The entry can still be activated by triggers
- But it's not visible in tools/UI (Aster's Message Tester won't show it expanded)
- Useful for background lore that the model should know but users don't need to see

### Entry Type

`"type"` is a descriptive label (e.g., "character", "place", "object", "rule"). It's metadata for organization and doesn't affect matching.

### Disabled Keys

Individual keys can have `"disabled": true`, which prevents that specific key from triggering. Useful for:
- Keeping an entry definition but disabling certain triggers temporarily
- Avoiding conflicts with other entries

```
Entry "City":
  keys: [
    { keyText: "Paris", disabled: false },  # This triggers
    { keyText: "City", disabled: true }      # This doesn't trigger
  ]
```

---

## Part 8: DreamJourney Platform Quirks

### Scroll Snap and Lazy Loading

DreamJourney uses lazy loading for message history. When scrolling up, an `IntersectionObserver` on a sentinel element triggers batches of older messages to load. However, DreamJourney's "stick to bottom" scroll handler fights against manual scrolling.

**Aster's solution (in content.js):**
- Use a **pulse-based approach**: Set `scrollTop = 0` every 900ms
- Let DreamJourney's natural scroll snap between pulses
- Terminate when: height hasn't changed for 5.4s AND the first message in DOM is a bot message
- Show a verification modal so users can confirm they reached the true top

**Critical:** Do NOT modify `scrollToTop`, the 900ms timing, or the termination condition — it's finely tuned and changing it causes regressions on large chats.

### Message IDs Are Duplicated

Each message in the chat DOM appears as **two elements with the same ID**:
1. Outer wrapper (has avatar)
2. Inner action row (no avatar)

Aster's `getMessages()` deduplicates with a Set, keeping the first (outer wrapper).

### Regen Replaces Elements

When a user clicks "Regenerate" on a bot message:
1. The old message element is destroyed
2. A new one is created with a **new ID**
3. IDs are NOT stable across regenerations

**Aster's solution:** Don't use index-based lookup. Instead:
- On regen click, record the **preceding user message ID** (stable)
- In `settleRegen()`, find the first bot message after that anchor
- This correctly identifies the regenerated message

### No `<h1>` on the Page

Document has no `<h1>` for the character name. Instead, find it via:
```javascript
document.querySelector('[aria-label="Go back to main app"]')
  ?.parentElement
  ?.querySelector('p[class*="font-bold"]')
  ?.innerText
```

### Thinking Models (Nyx, Athena)

Some models (Nyx, Athena) output thinking blocks inside messages as:
```
```<thinking>
Model's reasoning here...
</thinking>
```
```

Aster has a "Remove the thinking block from this reply" button that strips these via the edit flow (regex-based, only strips backtick-fenced blocks).

---

## Part 9: Aster's Lorebook Integration

### Single-Slot System (Pre-v2.2)

Previously, Aster had `djt:lorebook` in storage — one active lorebook at a time.

Functions:
- `lbAnalyze(message, entries)` — Analyze a message against entries
- `buildScanRegex(entries)` — Build a regex for live highlighting
- `runChatScan()` — Apply highlights to the 4 most recent messages (2 bot, 2 user)
- `updateActiveChatPanel()` — Show token tracker for recent messages

### 4-Slot System (v2.2+)

**Storage:** `djt:lorebooks: {bot1, bot2, bot3, persona}`

**Helper functions:**
- `loadAllLorebooks(cb)` — Load all 4 slots, merge entries with `origin` metadata attached
- `saveLorebook(slot, json)` — Save JSON to a specific slot
- `clearLorebook(slot)` — Clear a specific slot

**Analysis flow:**
1. Load all 4 lorebooks via `loadAllLorebooks()`
2. Merge entries into one array (each entry has `.origin: 'bot1'|'bot2'|'bot3'|'persona'`)
3. Run `lbAnalyze()` on merged entries
4. Display origin badges: `[Bot 1]`, `[Bot 2]`, `[Bot 3]`, `[Persona]`
5. Token budget is total across all 4 (1500 combined)

### Load Modal UI

The **Load Lorebook** modal shows:
- 4 labeled slots (Bot 1/2/3, Persona) with current load status
- "Use from library" and "Clear" buttons per slot
- Paste area with dropdown to choose target slot
- Saved lorebook library (same as before)

### Message Tester

The **Message Tester** tool:
1. Loads all 4 lorebooks (merged)
2. Analyzes typed or pasted messages
3. Shows summary badges (direct, cascade, pinned, cut)
4. Lists all activated entries with origin badges

Token bar shows progress to 1500-token limit.

### Active Chat Scanner

The **Active Chat Scanner** live-highlights triggers in the chat:
1. Loads all 4 lorebooks (merged)
2. Builds a regex from all trigger keys
3. Uses CSS Custom Highlight API (no DOM mutation)
4. Scans only the 4 most recent messages (2 bot, 2 user) to stay performant
5. Shows total trigger count in toast

### Active Chat Panel

The **Active Chat Panel** inline card:
1. Loads all 4 lorebooks on panel toggle
2. Analyzes recent chat text (last 4 messages combined)
3. Shows token budget bar (color changes to red if over 1500)
4. Lists activated entries with origin badges
5. Refreshes on new messages (500ms debounce) + 30s fallback

---

## Part 10: Data Storage

### Per-Session Storage

Key: `djt:{sessionId}`

```json
{
  "rerolls": 3,
  "sinceNexus": 2,
  "regenHistory": {
    "versions": [
      "First regenerated text...",
      "Second regenerated text..."
    ],
    "current": 0
  },
  "scratch": "",
  "scratchHistory": ["Message 1", "Message 2"],
  "countsSnapshot": { "user": 50, "bot": 45, "total": 95 },
  "quillPersona": "A mysterious sage who..."
}
```

### Global Settings

Key: `djt:settings`

```json
{
  "theme": "dark",
  "skin": "dreamjourney",
  "saveRegens": true,
  "stats": true,
  "nexus": true,
  "scratchpad": true,
  "autoRefresh": true,
  "deleteThinking": false,
  "panelPos": { "top": 68, "right": 14 },
  "panelSize": { "width": 400, "bodyHeight": 500 },
  "activeTab": "chat",
  "cardCollapsed": { "stats": false, "regen": true },
  "scanActive": false,
  "lorebookLibrary": [],
  "hidden": { "tab:creator": false },
  "quill": {
    "enabled": false,
    "ack": false,
    "backend": "ollama",
    "ollamaUrl": "http://localhost:11434",
    "ollamaModel": "mistral"
  }
}
```

### Lorebook Storage (v2.2)

Key: `djt:lorebooks`

```json
{
  "bot1": "{\"name\":\"World\",\"entries\":[...]}",
  "bot2": "{\"name\":\"Characters\",\"entries\":[...]}",
  "bot3": null,
  "persona": "{\"name\":\"PC Lore\",\"entries\":[...]}"
}
```

Each slot contains a JSON string of the full lorebook.

### Lorebook Library

Key: `djt:lb-library`

```json
[
  {
    "name": "My Favorite Lorebook",
    "json": "{\"entries\":[...]}",
    "dateAdded": 1718000000000
  }
]
```

Array of saved lorebooks for quick reuse.

### Bot Backups

Key: `djt:botbackup:{botId}`

Stores a snapshot of a bot's export (all fields) for recovery. Auto-saved every 5s while on a bot page.

**NOTE:** Storage keys keep the `djt:` prefix even after the Aster rename — renaming would orphan all user saved data.

---

## Part 11: Cascades in Detail

### BFS Traversal

Cascades use **breadth-first search (BFS)** to avoid infinite loops and correctly order activations.

```
Scenario:
- Entry A (direct hit): description mentions triggers for B and C
- Entry B: description mentions trigger for D
- Entry C: description mentions trigger for B (again)
- Entry D: description mentions nothing

BFS Order:
1. Activate A (direct hit)
2. Scan A's description → finds B, C
3. Queue: [B, C]
4. Scan B's description → finds D
5. Queue: [C, D]
6. Scan C's description → finds B (already visited, skip)
7. Queue: [D]
8. Scan D's description → finds nothing
9. Done

Result: A, B, C, D all activated. B wasn't duplicated.
```

**Visited set:** Entries are only processed once, even if multiple entries reference them.

### Cascade Map Structure

In Aster's `lbAnalyze()` return object:

```javascript
cascadeMap: {
  "EntryB": [
    { source: "EntryA", keys: ["trigger_b_1", "trigger_b_2"] }
  ],
  "EntryD": [
    { source: "EntryB", keys: ["trigger_d"] }
  ]
}
```

When displaying, Aster shows: `🔗 Cascade from EntryA via trigger_b_1`

---

## Part 12: Advanced: Wrapping Logic

### Why Underscore Wraps Work

The key insight: DreamJourney's matcher treats underscore as a **word character**.

```
Trigger definition: "Thalia"
Wrapped trigger definition: "_Thalia_"

When user writes: "The mage _Thalia_ is powerful"
  - Unwrapped entry matches (there's an unwrapped "Thalia")
  - Wrapped entry doesn't match (the "Thalia" in "_Thalia_" has `_` on both sides)

Aster's implementation:
  lbFindMatches(text, trigger) uses boundary class [a-z0-9_]
  lbFindUnwrapped() filters out protective wraps (/x/, -x-, <x>, _x_)
```

### Multi-Word Wraps

```
Trigger: "_Imperium Divinum_"

In chat: "The old _Imperium Divinum_ empire"

Word-by-word check:
- "Imperium": before="_ " → underscore is word char, no match
- (The entry is protected)

Word-by-word check in: "The old Imperium Divinum empire"
- "Imperium": before=" ", after=" " → MATCH
- "Divinum": before=" ", after=" " → MATCH
```

The underscore wrap protects the entire phrase from matching anywhere else.

### Lorebook Workshop Wrapping

Aster's **Lorebook Workshop** (helper tools) only uses underscore wraps:
- "Wrap All Triggers" → `_trigger_` for each key
- "Wrap a Snippet" → `_text_` around selected text
- "Remove Wrapping" → removes all protective wraps

This keeps formatting consistent.

---

## Part 13: Format Checker (Lorebook Workshop)

The **Format Checker** validates a pasted lorebook against DreamJourney's required structure:

**Requirements:**
- Must be valid JSON
- Must have an `entries` array
- Each entry must have:
  - `name` (non-empty)
  - At least one key in `keys` array
  - Each key must have `keyText` (non-empty)

**Output:** Lists any entries that don't meet these requirements by name, with specific issues.

---

## Part 14: Important Caveats and Limitations

### Token Estimation is Approximate

Aster estimates tokens as `length / 4`. Actual token count depends on:
- The model's tokenizer
- Whitespace and formatting
- Special characters

**Recommendation:** If an entry shows "~500 tokens" in Aster but is critical, test with the actual model to be sure.

### Scanner and Panel Only Check Recent Messages

Both the **Active Chat Scanner** and **Active Chat Panel** only analyze the last 4 messages (2 bot, 2 user). This is intentional:
- Keeps performance high
- Focuses on "currently in play" lore
- Avoids analyzing outdated context

**If you need full-chat analysis:** Scroll to the top in the Message Tester tool.

### Hidden Entries Are Still Triggered

An entry with `hidden: true` will:
- Still be activated by triggers
- Still be included in context
- Just not be displayed in Message Tester

This isn't a safety feature — don't rely on `hidden` to prevent an entry from loading.

### Cascades Don't Work with Wrapped Triggers

Cascades use `lbFindUnwrapped()`, which explicitly filters out wrapped triggers. This means:

```
Entry A: description contains "_trigger_for_b_"
Entry B: keys include "trigger_for_b"

Result: NO CASCADE
- The wrapped version doesn't match because the key is looking for the unwrapped version
```

This is intentional — wrapped triggers are meant to be safe from unintended matches.

### Virtual Message Limitation

DreamJourney virtualizes old messages (unmounts them from DOM). This means:
- Stats counters reset when you refresh (they count only loaded messages)
- Message Tester on very old chats only sees the loaded window
- **Workaround:** Click "Scroll to first message" in the Download panel to load all messages before analyzing

---

## Part 15: Practical Workflow Example

### Scenario: Creating a Fantasy Lorebook

**Goal:** Create a lorebook for a fantasy setting with cascading references.

**Entries:**

1. **The Kingdom of Aldor**
   ```json
   {
     "name": "The Kingdom of Aldor",
     "description": "A prosperous kingdom ruled by the Valorian dynasty. Known for its vast libraries and magical schools.",
     "keys": [
       { "keyText": "Aldor" },
       { "keyText": "Kingdom of Aldor" }
     ],
     "weight": 7,
     "pinned": true,
     "type": "place"
   }
   ```

2. **The Valorian Dynasty**
   ```json
   {
     "name": "The Valorian Dynasty",
     "description": "An ancient bloodline of powerful sorcerers. They have ruled for over 2000 years. The current ruler is King Valorian III.",
     "keys": [
       { "keyText": "Valorian" },
       { "keyText": "Valorian dynasty" }
     ],
     "weight": 8,
     "type": "faction"
   }
   ```

3. **King Valorian III**
   ```json
   {
     "name": "King Valorian III",
     "description": "The current monarch, known for his wisdom and strength. He has three children: Prince Aldric, Princess Elara, and Prince Theon.",
     "keys": [
       { "keyText": "Valorian III" },
       { "keyText": "King Valorian" }
     ],
     "weight": 9,
     "type": "character"
   }
   ```

4. **Prince Aldric**
   ```json
   {
     "name": "Prince Aldric",
     "description": "The eldest son, skilled warrior and diplomat. Known for his blue eyes and diplomatic negotiations.",
     "keys": [
       { "keyText": "Aldric" },
       { "keyText": "Prince Aldric" },
       { "keyText": "_aldric_" }  # Wrapped to avoid accidental matches
     ],
     "weight": 6,
     "hidden": false,
     "type": "character"
   }
   ```

### Analysis: What Happens When User Writes "Tell me about Aldor"

1. **Direct hits:**
   - "Aldor" matches "Kingdom of Aldor" entry → ACTIVATE

2. **Cascade from Kingdom of Aldor:**
   - Description mentions "Valorian dynasty" → ACTIVATE Valorian Dynasty entry

3. **Cascade from Valorian Dynasty:**
   - Description mentions "King Valorian III" → ACTIVATE King Valorian III entry

4. **Cascade from King Valorian III:**
   - Description mentions "Prince Aldric", "Princess Elara", "Prince Theon"
   - These match Prince Aldric entry → ACTIVATE

5. **Final activation order** (pinned first, then weight):
   - The Kingdom of Aldor (pinned, weight 7)
   - Prince Aldric (weight 6)
   - The Valorian Dynasty (weight 8)
   - King Valorian III (weight 9)

   **Wait, that's not the order!** Let me recalculate. After pinned:
   - The Kingdom of Aldor (pinned)
   - King Valorian III (weight 9)
   - The Valorian Dynasty (weight 8)
   - Prince Aldric (weight 6)

6. **Token calculation:** Sum descriptions until hitting 1500-token limit.

---

## Part 16: Aster-Specific Implementation Details

### MV3 Service Worker (background.js)

The service worker handles:
- **Network boundary for Quill:** Content script can't make HTTPS requests to fetch from a local HTTP LLM (mixed content blocked). All Quill calls route through background.js.
- **Message routing:** `chrome.runtime.sendMessage` between content script and service worker
- **Message contract:** `quill.test`, `quill.models`, `quill.chat`, `export`, `import`

### Content Script Mutation Handling (djtMutating flag)

When Aster injects elements (like the "Remove thinking" button), it sets `djtMutating = true` to prevent the `containerObserver` from seeing its own mutations and triggering a loop.

```javascript
djtMutating = true;
// Inject buttons, add elements
refreshThinkingButtons();
djtMutating = false;
```

### 500ms Debouncing

Active Chat Panel and Message Tester use 500ms debounce on message mutations (via `containerObserver`). This prevents lag when the bot is streaming text character-by-character.

### CSS Custom Highlight API

The Active Chat Scanner uses `new Highlight()` + `CSS.highlights.set()` to paint overlays **without mutating the DOM**. This avoids:
- React conflicts
- Retriggering the container observer
- Performance issues

Requires Chrome 105+.

---

## Part 17: File Structure

```
Aster/
├── manifest.json              (v2.2: Stable ID via RSA key)
├── content.js                 (~2637 lines: Main extension logic)
├── toolkit.css                (All panel styles, skins, themes)
├── background.js              (Service worker, Quill network boundary)
├── popup.html / popup.js       (Settings window)
├── help.html + help.js         (Help page, opened in new tab)
├── creator-tools-help.html     (Creator tools documentation)
├── lorebook-studio.html + .js  (Lorebook Workshop standalone tool)
├── quill-guide.html            (Quill explainer / setup)
├── dj-bridge.js                (MAIN-world bridge for bot export/import)
├── icons/                      (Icon assets, including sun64.png for collapsed state)
├── dist/
│   ├── Aster.zip              (Full extension, desktop)
│   ├── Aster-Mobile.zip       (Mobile version, Kiwi/Lemur Browser)
│   └── Aster-Pages.zip        (Help pages only)
└── README.md
```

---

## Part 18: Quick Reference

### Trigger Matching

| Scenario | Trigger | Chat Text | Match? |
|----------|---------|-----------|--------|
| Simple word | "cat" | "I have a cat." | YES |
| Multi-word | "shadow mage" | "The shadow mage appears." | YES |
| Underscore wrap | "_cat_" | "The _cat_ sleeps." | NO |
| Underscore wrap | "_cat_" | "The cat sleeps." | YES |
| Accidentally wrapped | "cat" | "The _cat_ sleeps." | NO |
| Case insensitive | "Thalia" | "thalia walks in." | YES |
| Partial word | "imp" | "The imperial empire." | NO (no boundary) |

### Activation Flow

```
User/bot message
    ↓
Direct trigger matches + Pinned entries
    ↓
BFS cascade through descriptions
    ↓
Sort (pinned first, then by weight)
    ↓
Load until 1500-token limit
    ↓
Include/Cut lists
```

### Aster Tool Relationships

```
Load Lorebook Modal
    ↓
    ├→ Message Tester (analyzes static text)
    ├→ Active Chat Scanner (live highlights)
    └→ Active Chat Panel (live token tracking)

Creator Tools
    ├→ Bot Export/Import (react-hook-form bridge)
    └→ Lorebook Workshop
         ├→ Merge (combine multiple lorebooks)
         ├→ Wrap All (underscore-wrap triggers)
         ├→ Format Checker (validate entries)
         └→ Remove Wrapping
```

---

## Part 19: Glossary

| Term | Definition |
|------|-----------|
| **Bot** | An AI persona users create and chat with on DreamJourney |
| **Lorebook** | A JSON file with entries (triggers + descriptions) |
| **Entry** | An object in a lorebook with a name, description, and trigger keys |
| **Trigger / Key** | A word or phrase that activates an entry when found in chat |
| **Direct Hit** | A trigger match in the user or bot's message |
| **Cascade** | An entry activated because a previously activated entry's description contains one of its triggers |
| **Weight** | A numeric priority for an entry (higher = loaded first) |
| **Pinned** | An entry that's always included and never affected by token budget |
| **Token** | A unit of text (roughly 4 characters) used to estimate context size |
| **Word Boundary** | The rule that triggers must be surrounded by non-word characters |
| **Word Character** | Letters, digits, or underscore (a-z, 0-9, _) |
| **Wrapped Trigger** | A trigger enclosed in protective punctuation (_x_, /x/, -x-, <x>) to prevent accidental matches |
| **BFS** | Breadth-first search; the algorithm used for cascades |
| **MV3** | Manifest V3; the modern Chrome extension architecture |
| **SPA** | Single Page Application (React, Vue, etc.); no page reloads between navigations |

---

## Conclusion

This guide covers:
- ✅ DreamJourney platform fundamentals
- ✅ Lorebook structure and mechanics
- ✅ Trigger matching with word boundaries
- ✅ Cascades and token budgeting
- ✅ Wrapping logic and protective conventions
- ✅ Aster's role and features
- ✅ Implementation details (MV3, service workers, etc.)
- ✅ Data storage and persistence
- ✅ Advanced scenarios and workflows

A reader with zero prior knowledge should be able to understand how lorebooks work, why certain formatting matters, and how Aster helps manage them.

---

**Version:** 2.2  
**Last Updated:** June 2026  
**Scope:** Complete technical reference for lorebook mechanics and Aster integration
