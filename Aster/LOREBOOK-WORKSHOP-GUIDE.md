# Lorebook Organization & Practical Workflows

**For:** Users building, organizing, and testing their own DreamJourney lorebooks  
**Scope:** Step-by-step workflows, best practices, common pitfalls, and Aster tools  
**Level:** Intermediate (assumes familiarity with lorebook basics)

---

## Part 1: Organizing Raw Notes into Lorebooks

### The Challenge

You have scattered notes about your world/characters:
- Scattered descriptions in documents
- Mixed detail levels (some entries huge, some tiny)
- Overlapping information (character description mentions a place)
- Unclear priority (what needs to always load vs. optional lore?)

**Goal:** Transform this into a structured, cascading lorebook.

### Step 1: Audit Your Notes

Before building, list what you have:

```
Character Notes:
- Thalia (mage, silver eyes, tragic backstory)
- Marcus (warrior, from Valdor, leads the Order)
- Elena (assassin, rival to Thalia, mysterious background)

Place Notes:
- The Kingdom of Aldor (major setting, 2000-year history)
- Valdor Forest (dangerous, has ancient ruins)
- The Shadow Tower (Elena's hideout, magical properties)

Lore Notes:
- The Shadowpact (ancient contract between characters)
- Valorian Dynasty (ruling family, mentioned often)
- The Order of Light (Marcus's organization)

Event Notes:
- The Schism (past event that split factions)
- The Coronation (upcoming event)
```

### Step 2: Define Scope (Single Lorebook or Multi-Slot?)

**Single Lorebook:**
- Best if: Relatively contained world, one dominant location, small cast
- Example: A single bot's personal memories + that world's lore

**Multiple Lorebooks:**
- Bot Lorebook 1: Core world/setting lore
- Bot Lorebook 2: Character roster
- Bot Lorebook 3: Factions/organizations + conflicts
- Persona Lorebook: The bot's personal backstory + beliefs

**Aster Advantage:** V2.2 supports all 4 simultaneously, so you can split logically.

### Step 3: Identify Primary Triggers

For each note, what's the **main keyword** users will write?

```
Thalia
  Triggers: "Thalia", "silver eyes" (if unique to her), "the mage"
  Avoid: "_thalia_" (too restrictive), generic words like "mage" alone

The Kingdom of Aldor
  Triggers: "Aldor", "Kingdom of Aldor"
  Avoid: "kingdom" alone (too broad)

Valdor Forest
  Triggers: "Valdor", "Valdor Forest", "forest"
  Avoid: "forest" alone if you have other forests
  Consider: "_Valdor_" if you mention places often and need safety
```

**Rule of thumb:** Primary trigger = the unique, least-ambiguous name.

### Step 4: Write Entry Descriptions

Take your scattered notes and consolidate into structured descriptions.

**Bad (too scattered):**
```
Thalia - A mage. She has silver eyes. She's from somewhere far away. 
Sad past. Can do magic. Knows Marcus somehow. Mysterious.
```

**Good (structured):**
```
Thalia is a powerful mage with distinctive silver eyes, a rare trait 
tied to her ancient Valdorian bloodline. Once the most promising student 
of the Shadow Mage Tower, she was forced to flee after the Schism five 
years ago. She now seeks to rebuild the Order of Light, though she and 
Marcus often clash on methods. Despite her icy demeanor, she harbors 
deep doubts about her choices.
```

**Tips:**
- **Write for the model:** Clear, evocative, third-person preferred
- **Include hooks:** Mention other entries (causes cascades)
- **Show character voice:** If this is a world-building lorebook, stay neutral; if it's persona lore, show personality
- **Avoid repetition:** Don't restate the entry name multiple times
- **Check for triggers:** Does this description mention "Valdor" or "Shadowpact" or "Marcus"? Those are cascade hooks!

### Step 5: Plan Cascades

Map which entries should reference which others:

```
Thalia
  mentions: Marcus (cascade to Marcus entry)
          Valdor Forest (cascade to Valdor entry)
          Shadow Mage Tower (cascade to that entry)

Marcus
  mentions: The Order of Light (cascade)
          Valdor (cascade)
          The Schism (cascade)

The Order of Light
  mentions: Thalia, Elena, Marcus (cascades)
          Shadow Mage Tower (cascade)
```

**Design principle:**
- **Core entries** (high weight, pinned if critical) cascade to specific lore
- **Specific lore** (character details) can be sparse to save tokens
- **Avoid circular cascades:** A → B → C → A creates an infinite loop (prevented by visited set, but wastes tokens)

**Example of good cascade design:**
```
Pinned: "The Kingdom of Aldor" (1000 tokens)
  mentions Valorian Dynasty, Shadow Tower, Valdor Forest

Bot Lorebook 1: World lore
  - High-weight entries (8-10): Aldor, Factions, Major Events
  - Medium-weight (5-7): Locations, Organizations
  - Low-weight (3-4): Minor history, optional details

Bot Lorebook 2: Characters
  - High-weight (8-10): Player character, main allies/rivals
  - Medium-weight (5-7): Supporting cast
  - Low-weight (3-4): NPCs, mention-only characters
```

### Step 6: Assign Weights

Weight strategy:

| Weight | Use Case | Example |
|--------|----------|---------|
| 10 | Critical, always needed | Main character, central conflict |
| 8-9 | Very important | Key allies, major locations, important rules |
| 5-7 | Standard, expected to load | Supporting characters, secondary locations |
| 3-4 | Optional flavor | Minor NPCs, historical details, worldbuilding |
| 1-2 | Rarely relevant | Obscure history, Easter eggs |

**Pinning vs. Weight:**
- **Pin:** "This MUST load, don't even think about token limits"
- **Weight:** "This should load if there's room, higher weight loads first"

**Example:**
```
Pinned:
- The Kingdom of Aldor (world foundation)
- Thalia's Core Personality (she's the PC, always relevant)

Weight 9:
- Marcus (main ally, mentioned often)
- The Order of Light (central to plot)

Weight 7:
- Elena (important rival, but fewer references)
- Valdor Forest (location, but not everywhere)

Weight 5:
- The Shadow Mage Tower (backstory)
- Minor NPCs

Weight 3:
- Obscure historical events
- Optional flavor
```

### Step 7: Consider Hidden Entries

Mark entries as `"hidden": true` if:
- They're important context but visually cluttered (e.g., internal lore notes)
- They're for the model only (e.g., "Never contradict this fact: X is evil")
- You want to avoid spoilers in the UI

**Example:**
```json
{
  "name": "Elena's True Parentage (SPOILER)",
  "description": "Elena is secretly the lost daughter of Valorian III...",
  "keys": [{"keyText": "Elena"}],
  "hidden": true,
  "pinned": true
}
```

When testing in Aster's Message Tester, it won't show this entry expanded, but it will load if triggered.

### Step 8: Protective Wrapping

Use underscore wraps if:
- A trigger is too generic without context
- You want to force mentions of that lore to be intentional

**Example:**
```json
{
  "name": "The Order",
  "description": "...",
  "keys": [
    { "keyText": "Order" },           # Unwrapped, generic
    { "keyText": "_The Order_" }      # Wrapped, only matches explicit reference
  ]
}
```

If a description says "The Order of Chaos" or "in order to survive", it only triggers the unwrapped "Order" key, not the wrapped one.

---

## Part 2: Using Aster's Tools

### Load Lorebook Modal

**Workflow:**

1. **Build your lorebook in a text editor:**
   ```json
   {
     "name": "My World",
     "entries": [...]
   }
   ```

2. **Open Aster's Load Lorebook modal:**
   - Click the Aster sun icon (expanded)
   - Creator Tools → Load Lorebook

3. **4-Slot Interface:**
   - Bot Lorebook 1: Load your world lore
   - Bot Lorebook 2: Load character roster
   - Bot Lorebook 3: (optional) Load factions/organizations
   - Persona Lorebook: (optional) Load PC personal lore

4. **Save to Library (optional):**
   - Paste your lorebook JSON
   - Click "Save & Load"
   - Give it a name (e.g., "World v2.1")
   - Now it's available for quick reuse

### Message Tester

**Purpose:** Test trigger matching and token budgets before going live.

**Workflow:**

1. **Load lorebooks** into the 4 slots
2. **Open Message Tester:**
   - Creator Tools → Load Lorebook button shows "Message Tester" link
   - OR: Creator Tools → use "Full details" button from Active Chat Panel

3. **Test message (option A):**
   - Type a message in the textarea
   - Click "Analyze triggers"
   - See which entries activate and how

4. **Test message (option B):**
   - Click "Use last chat message"
   - Pulls the bot's last response
   - Analyze to see what actually triggered

5. **Read results:**
   - **Highlighted message:** Trigger keys are marked
   - **Badges:** "5 direct, 2 cascade, 1 pinned, 0 cut"
   - **Entries:** List of activated entries with:
     - Entry name + origin badge (Bot 1, Bot 2, Persona)
     - How it was triggered (direct / cascade from / pinned)
     - Token estimate (~X tok)
   - **Token bar:** Visual % of 1500-token budget

**Example:**
```
Message: "Thalia and Marcus finally met at the Shadow Tower."

Results:
- 3 direct hits: Thalia, Marcus, Shadow Tower
- 2 cascades: The Order of Light (via Marcus), Valdor Forest (via Shadow Tower)
- 1 pinned: Kingdom of Aldor
- 0 cut entries
- Total: ~1200 / 1500 tokens ✓ Under budget
```

### Active Chat Scanner

**Purpose:** Live trigger highlighting during a chat.

**Workflow:**

1. **Load lorebooks** into the 4 slots
2. **Open Creator Tools → Active Chat Scanner**
3. **Click "🔆 Active Chat Scanner: On"**
4. **Triggers are now highlighted in the chat** (only last 4 messages for performance)

**Visual:**
- Trigger keys appear with a colored highlight background
- Hover tooltip would show... (actually, no tooltip in CSS Highlight API, just visual)
- Shows total trigger count in toast: "Live scan on: 47 triggers."

**Use case:** Watch the chat and see which parts of your lorebook are being referenced live. Helps you:
- Notice when entries cascade unexpectedly
- See if important triggers are being missed
- Verify your wrapping strategy works

### Active Chat Panel

**Purpose:** Real-time token tracker during chat.

**Workflow:**

1. **Load lorebooks** into the 4 slots
2. **Creator Tools → Lorebook Tools → "Active Chat Panel" button**
3. **Panel appears inline** showing:
   - Token count (~X / 1500)
   - Token bar (% of budget, red if over)
   - Badges (# direct, # cascade, # pinned, # cut)
   - Entries (activated entries with origin badges)

4. **Refreshes automatically:**
   - 500ms after new messages arrive
   - 30s fallback if chat is idle

**Use case:** During a live chat, see what lore is actually being loaded. Answers:
- "Is my important entry loading?"
- "Am I over token budget?"
- "Did that cascade actually happen?"

---

## Part 3: Workflow: Building a Complete Lorebook

### Scenario: Creating a Multiverse Lorebook

**Goal:** Create a complex lorebook with multiple characters, locations, and cascading references.

**Raw notes:**
```
CHARACTERS:
- Aria: Dimension-hopping thief, scarred face, from the Void
- Kael: Her partner, tech user, from Earth Prime
- The Architect: Mysterious entity controlling dimensions

PLACES:
- Earth Prime: Modern Earth
- The Void: Chaotic dimension, dangerous
- The Nexus: Hub between dimensions, neutral ground

LORE:
- The Incursion: When dimensions started colliding
- Breach Pacts: Rules governing dimension travel
```

### Step-by-Step Build

**1. Design the structure:**
```
Bot Lorebook 1: World/Dimensions
  - Earth Prime (weight 8, pinned)
  - The Void (weight 7)
  - The Nexus (weight 7)
  - The Incursion (weight 6)

Bot Lorebook 2: Characters
  - Aria (weight 9, pinned if she's the PC)
  - Kael (weight 8)
  - The Architect (weight 5, mysterious)

Bot Lorebook 3: Rules/Systems
  - Breach Pacts (weight 7, pinned)
  - Dimension Collapse (weight 5)
  - Void Corruption (weight 4)
```

**2. Write descriptions with cascade hooks:**

```json
{
  "name": "Earth Prime",
  "description": "A fully industrialized dimension with advanced technology. Kael's origin dimension. Protected by ancient Breach Pacts that prevent outsider interference.",
  "keys": [
    { "keyText": "Earth Prime" },
    { "keyText": "Earth" }
  ],
  "weight": 8,
  "pinned": true,
  "type": "place"
}
```

(Mentions: Kael, Breach Pacts → cascades)

**3. Cross-reference in descriptions:**

```json
{
  "name": "Aria",
  "description": "A scarred dimension-hopper from the Void, known for stealing artifacts across dimensions. She seeks Kael's help to prevent the Architect from collapsing all realities. Aria despises the Breach Pacts that limit her freedom.",
  "keys": [
    { "keyText": "Aria" },
    { "keyText": "scarred thief" }
  ],
  "weight": 9,
  "pinned": true,
  "type": "character"
}
```

(Mentions: Void, Kael, Architect, Breach Pacts → cascades)

**4. Test in Message Tester:**

Paste message: "Aria and Kael arrived at the Nexus, worried the Architect might cause another Incursion."

Expected results:
```
Direct hits: Aria, Kael, Nexus, Architect, Incursion
Cascades:
  - Breach Pacts (via Aria mention)
  - Earth Prime (via Kael mention)
  - The Void (via Aria mention)
```

**5. Verify token budget:**
```
Pinned (always load):
  - Earth Prime (~500 tokens)
  - Aria (~400 tokens)
  - Breach Pacts (~300 tokens)
  = 1200 tokens

From message analysis:
  - Kael (~350 tokens) would be added, but 1200 + 350 > 1500
  - So Kael is CUT (over budget)
```

**Solution:** Reduce pinned entries or increase weight priorities.

### Iteration

**First draft results:** Too many cascades, too many entries cut.

**Revision:**
```
Change Aria's description to NOT mention Breach Pacts directly.
Instead, Earth Prime's description mentions it.

Now:
- Earth Prime pinned (500 tokens) + mentions Breach Pacts
- Aria pinned (400 tokens) + mentions Kael, Void, Architect
- Breach Pacts cascades (300 tokens)

Total: 1200. Room for cascaded entries from Aria's references.
```

**Second iteration:** Better balance.

---

## Part 4: Best Practices

### Naming Conventions

**Entry names** should be:
- Unique (don't have two "The Order" entries in the same lorebook)
- Descriptive (not just "Character1")
- Consistent in case (use "The Kingdom of Aldor", not "the kingdom of aldor")

**Trigger keys** should be:
- Concise (shorter is better for matching)
- Unambiguous (avoid "time" if you have "Timeless Realm")
- Full names when relevant ("Thalia Valorian" if she's often called by full name)

**Good example:**
```json
{
  "name": "Princess Elara of House Valorian",
  "keys": [
    { "keyText": "Elara" },
    { "keyText": "Princess Elara" },
    { "keyText": "House Valorian" }  // Cascades to the dynasty entry
  ]
}
```

### Token Management

**Signs of token bloat:**
- Your descriptions are >1500 characters (>375 tokens individually)
- Many entries are getting "cut" in the Message Tester
- Cascades seem to load everything

**Solutions:**
1. **Split into multiple lorebooks:** World lore (Bot 1), characters (Bot 2), etc.
2. **Reduce description length:** Aim for 300-500 tokens per entry
3. **Be selective with cascades:** Don't mention every related entry in every description
4. **Reduce pinned entries:** Only pin the absolutely critical lore
5. **Use weight strategically:** Low-weight entries load last and are first to cut

**Example reduction:**

**Before (600 tokens):**
```
Thalia is a powerful mage with silver eyes, descended from an ancient Valdorian bloodline. 
Once the most promising student at the Shadow Mage Tower, she was expelled following 
the catastrophic Schism five years ago. She now leads the reconstructed Order of Light 
against the machinations of the Architect. Despite her icy demeanor and centuries of 
magical study, she harbors deep doubts about her choices and harbors secret sympathy 
for Elena's perspective. She knows Marcus from childhood and has complex feelings about 
their current partnership. Her greatest fear is repeating the Schism's mistakes.
```

**After (350 tokens):**
```
Thalia is a powerful mage with silver eyes and an ancient Valdorian bloodline. Exiled 
from the Shadow Mage Tower during the Schism five years ago, she now leads the Order 
of Light. Despite her icy exterior, she doubts her choices and sympathizes with Elena's 
perspective. She and Marcus have complex history.
```

Key info preserved, tokens reduced by ~50%.

### Cascade Safety

**Avoid unintended cascades:**

**Bad:**
```json
{
  "name": "War",
  "description": "War is a state of armed conflict. It causes death, destruction, 
  and suffering. War was fought in many kingdoms. War can be political or personal.",
  "keys": [{ "keyText": "war" }]
}
```

(Word "war" appears 4 times; any entry mentioning "war" will cascade here. Probably not desired.)

**Good:**
```json
{
  "name": "The Great War of Valorian Succession",
  "description": "The conflict that shattered the Valorian Dynasty lasted 50 years and 
  killed millions...",
  "keys": [
    { "keyText": "Great War" },
    { "keyText": "Valorian Succession War" },
    { "keyText": "_war_" }  // Wrapped, only explicit references
  ]
}
```

**Guideline:** Avoid single generic words as triggers unless you intentionally want broad cascades.

### Character-Specific vs. World Lore

**Character-specific (Persona Lorebook):**
- PC background, motivations, secrets
- Personal beliefs and biases
- Internal conflicts
- Things the PC knows but others might not
- Weight: Heavily weighted (8-10) or pinned, since it's always relevant to that character

**World Lore (Bot Lorebook 1):**
- Setting, history, rules
- Other characters' public knowledge
- Factions, locations, events
- General knowledge anyone might reference
- Weight: More varied (3-10) based on importance

### Testing Before Going Live

**Checklist:**
- [ ] All entries have at least one trigger key
- [ ] Entry names are unique
- [ ] Descriptions make sense when cascaded (no circular logic)
- [ ] Token budget is under 1500 when fully loaded
- [ ] Important entries aren't accidentally cut
- [ ] Wrapping is consistent (all use `_trigger_` or all unwrapped)
- [ ] Hidden entries are intentional (not accidental)
- [ ] No typos in trigger keys

**Test with Message Tester:**
1. Paste expected dialogue that should trigger your lore
2. Verify the right entries load
3. Check token count
4. Look for unexpected cascades
5. Check origin badges to ensure entries are from the right slot

---

## Part 5: Common Mistakes and Fixes

### Mistake 1: Too Many Cascade Hooks

**Problem:**
```json
{
  "name": "The Schism",
  "description": "The Schism was a catastrophic event involving Thalia, Marcus, 
  Elena, the Shadow Mage Tower, the Order of Light, and the Valorian Dynasty. 
  It caused the dimensional collapse..."
}
```

This entry cascades to 6 other entries. If those entries also mention other things, you could activate your entire lorebook from one trigger.

**Fix:**
```json
{
  "name": "The Schism",
  "description": "A catastrophic magical event fifty years ago that fractured reality itself. 
  Its causes remain contested, but its consequences—the Void Incursions—shaped all three dimensions."
}
```

Reduced cascades; less detail, but entries about specific people/places provide those details when they cascade.

### Mistake 2: Oversized Descriptions

**Problem:**
```json
{
  "name": "Thalia",
  "description": "Thalia was born in..." (2000 characters, ~500 tokens)
}
```

One entry uses 1/3 of the entire budget. If 2-3 others load, nothing else fits.

**Fix:**
- Split into `"Thalia: Backstory"` (500 tokens, hidden, pinned) and `"Thalia: Current"` (200 tokens, visible)
- Or: Write once and put in Persona Lorebook (so it's only loaded for that bot)

### Mistake 3: Ambiguous Trigger Keys

**Problem:**
```json
{
  "keys": [
    { "keyText": "The" },      // Matches any sentence
    { "keyText": "and" },      // Matches any compound sentence
    { "keyText": "time" }      // Matches "sometimes", "anytime", etc.
  ]
}
```

**Fix:**
- Use unique, specific triggers
- Avoid function words and common nouns
- Example: `"keyText": "Timeless Realm"` instead of `"time"`

### Mistake 4: Forgetting Hidden Entries in Persona Lorebooks

**Problem:**
```json
{
  "name": "PC Secret: I'm the Architect",
  "description": "I'm actually the malevolent Architect, disguised as human...",
  "hidden": false
}
```

Visible in the Message Tester UI, spoiling the twist.

**Fix:**
```json
{
  "hidden": true,
  "pinned": true
}
```

### Mistake 5: Inconsistent Wrapping

**Problem:**
```json
"keys": [
  { "keyText": "Thalia" },           // Unwrapped
  { "keyText": "_Thalia_" },         // Wrapped
  { "keyText": "the mage" },         // Unwrapped
  { "keyText": "_the mage_" }        // Wrapped
]
```

Inconsistent strategy leads to confused cascading.

**Fix:**
- Pick one strategy (usually: specific names unwrapped, generic descriptions wrapped)
- Example:
  ```json
  "keys": [
    { "keyText": "Thalia" },         // Specific, always safe
    { "keyText": "the silver-eyed mage" }  // Specific enough, unwrapped
  ]
  ```

---

## Part 6: Advanced: Multi-Bot Lore Sharing

### Scenario

You have multiple bots in the same world. You want:
- Shared world lorebook (same across all bots)
- Shared character roster (same across all bots)
- Unique persona lore (different for each bot)

### Solution: Organize in Slots

**All bots:**
- Bot Lorebook 1: `world-v2.1.json` (shared)
- Bot Lorebook 2: `characters-v2.1.json` (shared)
- Bot Lorebook 3: `factions-v2.1.json` (shared)

**Per-bot:**
- Persona Lorebook: `pc-{botName}-v1.0.json` (unique)

### Workflow

1. **Create shared lorebooks once** (world, characters, factions)
2. **Save them to Aster's library**
3. **For each bot:**
   - Create a unique Persona Lorebook with PC-specific lore
   - Load the 3 shared lorebooks into Bot 1/2/3
   - Load the PC-specific into Persona slot
   - Test with Message Tester

### Version Control

**Naming convention for shared:**
```
world-v2.1.json
characters-v2.1.json
factions-v2.1.json
```

When you update, increment version:
```
world-v2.2.json (new features, bug fixes)
```

Don't modify the old version; create a new one. This way:
- Old bots can stay on v2.1 if you want
- You can test v2.2 on new bots
- Easy to revert if v2.2 causes issues

---

## Part 7: Migration: Moving Lore Between Bots

### Copy Existing Lorebook

**Scenario:** You have a working lorebook on Bot A, want to use it on Bot B.

**In Aster:**
1. On Bot A, open Message Tester
2. Ctrl+A to select all in the results (or manually in the Library)
3. Go to Bot B
4. Open Load Lorebook modal
5. Load from the saved library (the lorebook was auto-saved)

OR:

1. On Bot A, open Load Lorebook → Library
2. Right-click the lorebook, "Copy JSON"
3. Go to Bot B
4. Open Load Lorebook → Paste area
5. Paste and Load

### Update an Entry Across Multiple Bots

**Scenario:** You update an entry's description. Want to propagate to all bots using that lorebook.

**Manual:**
1. Export the updated lorebook from one bot
2. Load it into all other bots

**With Aster Library:**
1. Update the lorebook in the Library (delete old, save new version)
2. Load the new version on each bot

**Recommendation:** Use Bot Lorebook 1/2/3 for shared world lore, Persona Lorebook for unique stuff. This way, you only update shared lore once.

---

## Part 8: Troubleshooting

### Issue: Entry Not Triggering

**Symptoms:** You expect an entry to activate, but it doesn't show in Message Tester.

**Checks:**
1. Is the trigger key spelled correctly? (Check for typos)
2. Is the trigger key disabled? (`"disabled": true`)
3. Does the chat text have the trigger? (Check Message Tester shows it highlighted)
4. Does the trigger have valid boundaries? (Type in Message Tester to test)
5. Is the entry's keys array not empty?

**Debug:**
- Type the trigger manually in Message Tester
- If it still doesn't match, check word boundary issues

Example:
```
Trigger: "imp"
Chat: "The imperial realm"
Match? NO (because "imp" is followed by "erial", a word character)

Trigger: "imperial"
Chat: "The imperial realm"
Match? YES
```

### Issue: Cascades Not Happening

**Symptoms:** You expect an entry to cascade, but it doesn't.

**Checks:**
1. Does the first entry's description actually mention the trigger? (Review description text)
2. Is the trigger in the second entry's keys list? (Check keys array)
3. Is the second entry disabled? (Check `"disabled": false`)
4. Is the trigger wrapped in the first entry? (Cascades skip wrapped triggers)

**Debug:**
```
Entry A (activated): "The Architect is controlling dimensions."
Entry B: keys include "Architect"
Expected: Cascade to B

But if Entry A's description says "_Architect_" instead, cascade won't happen 
(wrapped trigger).
```

### Issue: Over Token Budget

**Symptoms:** Too many entries are "cut" in Message Tester.

**Fixes (in order):**
1. Reduce description lengths (target: 200-400 tokens each)
2. Reduce number of pinned entries (only pin the critical)
3. Reduce cascade hooks (mention fewer related entries)
4. Split into multiple lorebooks (Bot 1 for world, Bot 2 for characters)
5. Lower weights on less-important entries

### Issue: Unexpected Cascades

**Symptoms:** An entry cascades when it shouldn't.

**Cause:** Its description contains a trigger key.

**Fix:**
- Review description for unwanted mentions
- Wrap the trigger key if mentioned casually: `_architect_` instead of "architect"
- Or: Remove the trigger from that entry's keys array (if it's intentional, fine)

---

## Part 9: Quick Checklist for Launch

Before putting a lorebook "live" on a bot:

- [ ] **Format validation:** Paste in Lorebook Workshop → Format Checker. No errors?
- [ ] **Token budget:** Message Tester shows <1500 tokens when fully loaded
- [ ] **Critical entries:** They're pinned or weight 8+
- [ ] **Cascades tested:** Message Tester shows expected cascades
- [ ] **No circular cascades:** Entries don't create infinite loops
- [ ] **Wrapping consistent:** All strategy or no strategy, not mixed
- [ ] **Hidden entries intentional:** Not accidentally hidden
- [ ] **Naming clear:** Other future-yous won't be confused
- [ ] **Version labeled:** Named with version number (e.g., "world-v2.1")
- [ ] **Saved to library:** In Aster's library for easy reuse
- [ ] **Tested live:** Loaded on bot, chat a bit, checked Active Chat Panel

---

## Conclusion

This guide covered:
- ✅ Organizing raw notes into structured lorebooks
- ✅ Using Aster's tools (Load Modal, Message Tester, Scanner, Panel)
- ✅ Designing cascades strategically
- ✅ Managing token budgets
- ✅ Best practices and naming conventions
- ✅ Common mistakes and fixes
- ✅ Multi-bot lore sharing
- ✅ Troubleshooting

You're now equipped to build, test, and organize complex lorebooks with confidence.

---

**Version:** 2.2  
**Last Updated:** June 2026  
**Scope:** Practical guide for building and testing lorebooks
