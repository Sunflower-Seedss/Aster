# Aster (DreamJourney Toolkit) — Developer Context

Made by SunflowerS at DreamJourney AI. QoL browser extension for https://www.dreamjourneyai.com

---

## What this is

A Chromium extension (Manifest V3) that injects a floating panel into DreamJourney AI chat sessions. All data is stored in `chrome.storage.local` keyed by session ID. Nothing is uploaded anywhere.

---

## Architecture

- **content.js** — single content script, injects on `(www.)dreamjourneyai.com/*`. The on-page panel, stats, saved replies, scratchpad, lorebook tools, bot export/import, AND all Quill UI.
- **toolkit.css** — all panel styles, injected alongside content.js
- **background.js** — MV3 service worker. The **network boundary for Quill** (see "Quill" below): a content-script fetch to a local `http://localhost` LLM from the HTTPS DJ page is blocked (mixed content + CORS), so all Quill calls route content.js → `chrome.runtime.sendMessage` → background → fetch. Message contract: `quill.test` / `quill.models` / `quill.chat`.
- **popup.html/js** — the extension-icon **Settings window** (NOT a stats view anymore): Appearance (skin + light/dark), Panel sections (hide/show toggles → `settings.hidden`), and Advanced › Quill connection (gated behind an "I understand" checkbox). Changes apply on **Save**.
- **quill-guide.html** — Quill explainer / setup / safety page, linked from the popup. Reuses help.js for theme/skin.
- **help.html + help.js** — help page opened in new tab (help.js is external because inline scripts are blocked by extension CSP)
- **lorebook-studio.html + lorebook-studio.js** — standalone tabbed tool page (Merge / Wrap All Triggers / Wrap a Snippet / Remove Wrapping / Format Checker), opened from Creator Tools → Tool Pages. Reuses help.js for theme toggle. Logic lives in **lorebook-studio.js** (external file — extension-page CSP blocks inline `<script>`; an inline block here is exactly why only the first tab worked in an earlier build). Wrap/merge behaviors ported verbatim from the original standalone tools (Merger, Cascade Destroyer, Cascade Buster, Recascadanator). Format Checker validates a pasted lorebook against DreamJourney's required shape (top-level + per-entry fields, every entry must have ≥1 `keyText` trigger) and lists issues by entry name.
- **creator-tools-help.html** — plain-language explainer for the in-extension Creator tools (Load Lorebook, Message Tester, Active Chat Scanner, Active Chat Panel) and Lorebook Workshop. Opened from the Creator Tools "? How to use" button. Reuses help.js.
- **dj-bridge.js** — MAIN-world helper injected on bot create/edit pages. Reaches React / react-hook-form to read & write the bot. See "Bot export / import" below.
- **manifest.json** — MV3, matches both `dreamjourneyai.com/*` and `www.dreamjourneyai.com/*`. Name "Aster", version 2.1. `dj-bridge.js` is a `web_accessible_resource`.

DreamJourney is a **Next.js SPA**. Content scripts only inject on real page loads. Route changes are detected by patching `history.pushState/replaceState` + popstate + 500ms polling. The lifecycle has two modes: `activate(sessionId)` for `/app/session/*` (chat panel) and `activateBotMode()` for `/app/create/bot/*` (panel on Creator tab, no chat wiring). `deactivate()` tears either down. `onRouteChange()` routes between them; `botMode` flag distinguishes.

---

## Bot export / import (Creator → Bot Tools)

Lets a user capture a complete, re-importable copy of a bot — every text field **and** the custom dropdowns/toggles (visibility, NSFW, content warnings, category, tags, lorebooks).

**How it works (the key insight):** DreamJourney's bot create/edit form is a **react-hook-form**. Its `control._formValues` holds the entire bot model, and the same component props expose `setValue` / `getValues` / `trigger`. So:
- **Export** = read `getValues()`, keep a whitelist of bot fields (drop `id/userId/createdAt/updatedAt/messageCount/isDraft/user/collaborators/imgsrc`). No DOM scraping.
- **Import** = `setValue(field, value, {shouldDirty,shouldTouch})` per field + `trigger()`. RHF repopulates the visible UI (including dropdowns/toggles) and DreamJourney autosaves it.

**Why a MAIN-world bridge:** content scripts run in an isolated world and can't see the page's React fiber (`__reactFiber$…` expandos). `dj-bridge.js` is injected into the page's MAIN world (`<script src=getURL(...)>`); content.js talks to it via `window.postMessage` (`source:'djt-cs'` ⇄ `source:'djt-bridge'`, matched by `reqId`). Bridge actions: `detect`, `export`, `import`.

**Legacy requirement:** the feature only works in **Legacy** mode, where the form is one long scrolling page with every field mounted. Modern is a 5-step wizard that unmounts other steps, so `setValue`/the fiber walk can't reach all fields. `detect` reports `legacyReady` (checks `textarea[name=context]` + `textarea[name=authorNote]` + `input[name=name]` all present); if not, `openLegacyPrompt()` tells the user to flip the toggle.

**New & existing bots are the same code path:** typing into `/app/create/bot/new` makes DreamJourney mint a draft and redirect to `/app/create/bot/<uuid>` — identical form/model to editing an existing bot.

**Rolling local backup:** while on a bot page, `startBotAutosave()` snapshots `export` to `chrome.storage.local` under `djt:botbackup:<botId>` every 5s and shows "Backed up locally ✓ HH:MM" in the card.

**Field shapes (for reference):** `tags` = array of UUID strings; `lorebooks` = `[{id}]`; `lorebookIds` = array of numbers; `categoryId`/`visibility` = strings; `contentWarnings` = string array; `nsfw`/`pinned` = booleans; `img_link` = CDN URL (re-import sets the link, but DreamJourney may still require re-picking the image file since `imgsrc`/the File blob can't be serialized).

---

## Verified DOM selectors (live-inspected June 2026)

```
Scroll container:     .scrollchatmessages
Messages:             [id^="message-"] — each id appears on TWO elements (outer wrapper + inner action row). getMessages() deduplicates keeping the first (outer wrapper).
Bot message:          has img[alt="@shadcn"] — hover-independent, reliable
User message:         no avatar
Regenerate button:    [aria-label="Regenerate response"] — hover-only, use event delegation
Edit bot message:     [aria-label="Edit assistant message"]
Edit textarea:        textarea[placeholder="Edit your message..."]
Composer textarea:    textarea[placeholder="Send your message..."]
Send button:          [aria-label="Send message"]
Stop button:          [aria-label="Stop generating response"]
Nexus button:         [aria-label="Open Memory Nexus"]
Character name:       document.querySelector('[aria-label="Go back to main app"]')
                        ?.parentElement?.querySelector('p[class*="font-bold"]')?.innerText
Page has no <h1>.     Document title is generic. Character name is ONLY in the above element.
```

---

## Key decisions and why

> ### 🔒 HARD-LOCKED: pulse-based scroll-to-top
> **Do NOT modify `scrollToTop`, `doScrollToTop`, the 900ms pulse timing, the `stable >= 6 && firstIsBot` termination, OR `isBot` (the stop condition calls it).** This was tuned to a fine art against DreamJourney's lazy-loader and is extremely sensitive. Changing `isBot` — even for an unrelated feature like the stats counter — changes the scroll stop condition and has caused regressions. If you need a different message-type check elsewhere, write a SEPARATE helper; never repurpose `isBot` or the scroll functions. Every chat opens with a bot message, so `firstIsBot` is the correct "reached the true top" signal. Touch this only with an explicit request to change scrolling itself, and re-test on a 300+ message chat.

**Pulse-based scroll (scrollToTop):**
DreamJourney uses an IntersectionObserver on a sentinel element at the top of `.scrollchatmessages` to lazy-load older message batches. Setting `scrollTop = 0` every 900ms triggers each batch. CRITICAL: do NOT add scroll event listeners that fight back — this was tried and it blocked the IntersectionObserver from firing, stopping loads at ~150 messages. The current approach (pulse every 900ms, let DJ bounce naturally between pulses) reliably loads all messages on a 371-message chat.

Termination: `stable >= 6 && firstIsBot` — height hasn't changed for 5.4s AND the first message in the DOM is a bot message (`isBot`, via the `@shadcn` avatar). Chats always open with a bot message, so this reliably means the true top. This double-check prevents stopping during a brief network stall mid-load.

**Scroll verification modal (CRITICAL):**
After scrolling completes, `doScrollToTop()` displays a `confirmVerifyFirstModal()` showing the first loaded message and asking "Is this the first message?" with hint text "If not, please check the help section." This is essential because: (1) the scroll termination check can occasionally stop on a user message if the chat is structured unexpectedly; (2) the user MUST verify they're at the actual top before downloading, otherwise the export will be incomplete; (3) the modal gives users actionable guidance (check help) if they're stuck. **Removing this modal breaks functionality** — users lose the ability to confirm they reached the top and cannot recover if the scroll stops early. The 900ms pulse timing + verification modal together ensure reliable scroll-to-top behavior.

**`djtMutating` flag:**
`refreshThinkingButtons()` injects/removes elements inside `.scrollchatmessages`, which is watched by `containerObserver`. Without this flag, injecting triggers the observer, which calls refreshThinkingButtons again, which injects again — infinite loop that freezes the page entirely. Always wrap our own DOM mutations with `djtMutating = true/false`.

**characterData removed from containerObserver:**
Only `childList: true, subtree: true`. Adding `characterData: true` fires on every streamed character during generation — massive overhead that made the extension noticeably heavy on slower machines.

**bodyObserver replaced with setInterval:**
Watching `document.body` with subtree:true fires on every React re-render (constant on DJ). Even cheap callbacks at that rate caused lag. Replaced with a 3-second `setInterval` for scratchpad hook checks.

**Regen save uses anchor-based lookup:**
When a message is regenerated, its DOM element is replaced with a new one (new ID). Index-based lookup (`ms[idx]`) breaks. Instead: on regen click, record the **preceding user message ID** (`regenAnchorUserId`) which is stable. In `settleRegen`, find the first bot message after that anchor. This correctly identifies the regenerated message every time.

**Settle timer is 900ms, not instant:**
`settleRegen` fires 900ms after the last mutation while `regenPending = true`. But if the new message is still empty/short/already-in-history, it reschedules (keeps `regenPending = true`). This handles slow server responses where the placeholder element appears before content streams in.

**deleteThinking defaults to OFF:**
Only applies to Nyx and Athena models. Defaulting it ON would confuse users on all other models.

---

## DreamJourney platform quirks

- **Scroll snap**: DJ's "stick to bottom" handler fires whenever new content loads above the viewport. This is what our 900ms pulse approach works around.
- **Message IDs**: Each message element has the same ID on two DOM elements (outer wrapper + action row, both children). Always deduplicate with a Set.
- **Regen replaces the element**: On regeneration, the old message element is completely destroyed and a new one with a new ID is created. IDs are not stable across regens.
- **No `<h1>` on the page**: The character name is only in the header near the back button. See selector above.
- **SPA navigation**: Page doesn't reload between chats. Must watch `pushState`/`replaceState` to detect session changes.
- **Thinking models**: Nyx and Athena output thinking blocks inside the message content as ` ```<thinking>...</thinking>``` `. The delete thinking feature regex-strips these via the edit flow.

---

## Storage structure

**NOTE:** keys keep the `djt:` prefix even after the Aster rename — renaming them would orphan every user's saved data. Don't change them.

```js
// Per-session store (key: 'djt:{sessionId}')
{
  rerolls: 0,
  sinceNexus: 0,
  regenHistory: { versions: [], current: 0 },
  scratch: '',           // current unsent draft
  scratchHistory: [],    // last 5 sent messages (newest first)
  countsSnapshot: { user: 0, bot: 0, total: 0 },
  quillPersona: ''       // per-chat "who Quill writes as" (max 500 chars)
}

// Global settings (key: 'djt:settings')
{
  theme: 'dark', skin: 'dreamjourney',
  saveRegens: true, stats: true, nexus: true,
  scratchpad: true, autoRefresh: true, deleteThinking: false,
  panelPos: null, panelSize: null, activeTab: 'chat',
  cardCollapsed: {}, scanActive: false, lorebookLibrary: [],
  hidden: {},            // section-id -> true when hidden from the panel (Settings window)
  quill: {               // Quill connection (deep-merged on load)
    enabled: false, ack: false, backend: 'ollama',
    ollamaUrl, ollamaModel, lmstudioUrl, lmstudioModel,
    koboldUrl, openaiBaseUrl, openaiModel, apiKey
  }
}
```

---

## V2 panel structure

- **Two tabs**: Chat Tools / Creator Tools. Active tab saved in `settings.activeTab`.
- **Collapsible cards**: click the card header to collapse/expand. State saved in `settings.cardCollapsed` (object keyed by card key). CSS hides `.djt-card-body` when `.djt-card-collapsed` is on the card.
- **Card keys**: `stats`, `regen`, `scratch`, `features`, `quillchat` (Chat Tools); `bottools`, `lorebook`, `toolpages`, `quillcreator`, `quillimport` (Creator Tools).
- **3 download buttons**: (1) Scroll to first message — runs pulse scroll with verification modal confirming first message loaded; sets `hasScrolledToTop = true` only if user confirms; (2) Download chat — shows "Is this the first message?" modal with the loaded message, user must confirm before download; (3) Back to bottom — `scrollTop = scrollHeight`. `hasScrolledToTop` resets on `deactivate()`.
- **Creator Tools tab**: Bot Tools (export/import — IMPLEMENTED, see "Bot export / import"), Lorebook Tools (Load Lorebook, Message Tester, Active Chat Scanner, + inline Active Chat Panel card), Tool Pages (link to lorebook-studio.html / "Lorebook Workshop"), and the two Quill cards (Character Lens, Import a character). Tab always visible regardless of URL.
- **Active Chat Panel**: Inline card within Lorebook Tools, toggled by "Active Chat Panel" button (`toggleActiveChatPanel`). Analyzes the last 4 messages combined and shows summary badges, a 1500-token bar, and per-entry rows (with direct/cascade "via" detail). Refreshes on new messages (500ms debounce via `panelDebounce`) plus a 30s fallback (`panelUpdateTo`). A "Full details" button pops out the Message Tester pre-filled with the recent text. Keeps users in the panel instead of floating/external modals.
- **Pinned-entry budget note**: lives on the creator-tools-help page (intro `<p class="intro">`), not in the panel — keeps the panel uncluttered.
- **Panel width**: 240px (up from 220px to accommodate tab labels).

## Load Lorebook modal + Message Tester (share `#djt-lb-overlay`)

- Both build `#djt-lb-overlay` (centered modal, fixed/inset:0) and guard with `if (document.getElementById('djt-lb-overlay')) return;` — only one open at a time. Removed on `deactivate()` and close/backdrop click.
- **Load Lorebook** (`openLoadLorebookModal`): saved-library list (Use/×) + paste area with Load / Save & Load / Cancel. Library in `chrome.storage.local` under `djt:lb-library`; active lorebook under `djt:lorebook`.
- **Message Tester** (`openLorebookTester`, opened via `openMessageTester`): always renders the analyze box; shows an inline `#djt-lb-nolb` banner if no lorebook is stored. Analyze a typed message or pull the latest via "Use last chat message" (`lastBot()` + `msgText()`).
- **Analysis logic** (`lbAnalyze`): collapses blank lines (`\n{2,}`→`\n`) → direct trigger matches (word-boundary, case-insensitive) → BFS cascade through activated entries' bodies, skipping wrapped triggers (`_w_` `/w/` `-w-` `<w>`) → sort pinned-first then weight desc → estimate tokens (`length/4`) and cut anything past the **1500** token budget.
- Overlay CSS is self-contained (own `--lb-*` theme tokens) since it lives outside `#djt-panel`.
- **Token limit is 1500** (per the June 2026 dev update), NOT 2000 as the older written guides say. Pinned entries consume this budget too.

## Active Chat Scanner (live trigger highlighting)

- Toggled from Creator Tools → "🔆 Active Chat Scanner" button. State persists in `settings.scanActive`; on `activate()` it auto-resumes via `maybeStartScanner()` if a lorebook is stored.
- Reuses the active lorebook (`djt:lorebook`). If none is loaded, it toasts and opens the Load Lorebook modal.
- **Uses the CSS Custom Highlight API** (`new Highlight()` + `CSS.highlights.set('djt-scan', …)` + `::highlight(djt-scan)` in toolkit.css). This is deliberate: it paints over chat trigger words WITHOUT mutating the DOM, so there are no React conflicts AND it does not retrigger `containerObserver` (no `djtMutating` juggling needed). Rebuilt by `runChatScan()` on observer settle (400ms debounce).
- **Scans only the 4 most recent messages** (2 bot, 2 user) — `runChatScan()` walks those message elements, not the whole container. Same recent-window logic as the Active Chat Panel (`recentChatText()`).
- `buildScanRegex()` makes one combined alternation of all trigger keys (escaped, longest-first) with `(?<![A-Za-z0-9])…(?![A-Za-z0-9])` boundaries. Capped at 8000 ranges. No floating UI (the old `#djt-scan-bar` badge was removed). Cleared on `deactivate()`.
- Requires Chrome 105+ (Highlight API). Falls back with a toast if unsupported.

## Download buttons

- 3 buttons share the `djt-dl-btn` class for a matched look (no more odd-one-out primary button): Scroll to first message / Download chat / Back to bottom.

## Nexus thresholds

- `n <= 20`: green
- `n <= 40`: orange
- `n > 40`: red
- Warning banner shows at `>= 50`
- Same in content.js (`nexusClass`) and popup.js

---

## Panel

- Default position: `top: 68px; right: 14px`
- When dragged: converts to `left/top` absolute positioning, saved to `settings.panelPos`
- Collapsed state: 48px circle showing the sun icon (`icons/icon48.png`, must be in `web_accessible_resources`). Collapsed dims are `!important` so an inline resized width/height can't stop it shrinking to the circle.
- Collapse: click `–` button → adds `.djt-collapsed` class, `stopPropagation()` required to prevent panel click listener from immediately re-expanding
- Expand: click anywhere on the circle (panel click listener) OR tap on mobile. After expanding, `clampPanelIntoView()` runs so the now-wider panel can't spill off the right/bottom edge.
- **Z-index: 2147483647** (true 32-bit max). Bumped from `…640` so DJ's sidebar/overlays can't render on top and steal clicks.
- **Dragging** (`initDrag`): a 4px movement threshold separates a click (expand) from a drag. `e.preventDefault()` on mousedown stops the browser's native image-drag on the sun `<img>` (which made the collapsed bubble "stick" to the cursor); the icon also has `draggable="false"`. `.djt-no-anim` is added during drag to drop the width/height transitions so it tracks the cursor 1:1.
- **Resizing** (`initResize`): `#djt-resize` handle bottom-right. Drag adjusts panel width (200–520px, capped to viewport) and `#djt-body` height (120px–85vh). Saved to `settings.panelSize` `{width, bodyHeight}` and restored on build.

---

## Themes / skins

- Two skin families, selected from the **shared "Advanced" footer** (one block rendered once after both tab panes, so it shows under whichever tab is active — avoids duplicate IDs). Buttons: **DreamJourney** (default) and **Sunflowers** (matches sunflower-seedss.github.io branding).
- Skin stored in `settings.skin` (`'dreamjourney'|'sunflowers'`), applied via `setSkin()` → `data-djt-skin` attribute on `#djt-panel`. Independent of light/dark, which stays on `data-djt-theme`. So there are 4 combos.
- **toolkit.css**: base `#djt-panel` = DreamJourney dark; `[data-djt-theme="light"]` = DJ light; `[data-djt-skin="sunflowers"]` = Sunflowers dark; `[data-djt-skin="sunflowers"][data-djt-theme="light"]` = Sunflowers light. Each block redefines the full `--djt-*` token set. Lorebook overlay (`#djt-lb-overlay`) mirrors this with `--lb-*` tokens; overlays get `data-djt-skin` set at creation.
- **Primary buttons** use `--djt-primary` / `--djt-primary-hover` / `--djt-on-primary` (and the overlay's `--lb-primary` / `--lb-on-primary`), defined per skin. The `on-*` token keeps button text readable on each accent (e.g. white on Sunflowers' dark-green light-mode primary). Before this, `.djt-mini-btn.primary` was hardcoded indigo and never changed with the skin — that was the visible bug.
- **Body-child overlays don't inherit `#djt-panel` vars.** The four `--djt-*` token blocks therefore also list `.djt-modal-overlay`, and the confirm dialogs set `data-djt-theme`/`data-djt-skin` on creation. Buttons *inside* `#djt-lb-overlay` are themed by `#djt-lb-overlay .djt-mini-btn{…}` rules using `--lb-*` (the panel's `--djt-*` don't reach there). Two deliberate exceptions stay self-contained because they're injected into the chat DOM with no skin context: `.djt-del-thinking` and `::highlight(djt-scan)`.
- **Sunflowers palette**: forest green accent (`#4E6E3C` light / `#9DC47A` dark), warm cream/brown bg, gold + sage. Sourced from the site's `:root` block.
- **Primary buttons** use dedicated tokens, not `--djt-accent`, so text contrast is correct in every combo: `--djt-primary` / `--djt-primary-hover` / `--djt-on-primary` (panel) and `--lb-primary` / `--lb-on-primary` (overlay). Earlier these were hardcoded indigo and didn't repaint for Sunflowers. The four `--djt-*` token blocks also cover `.djt-modal-overlay` (a body-child confirm dialog that sets `data-djt-theme/skin` but isn't a panel descendant), so it themes too. Overlay (`.djt-mini-btn`/`.djt-btn`) buttons are re-scoped under `#djt-lb-overlay` to use `--lb-*`. Remaining hardcoded purples (`.djt-del-thinking`, `::highlight(djt-scan)`) are injected into the chat DOM where panel vars can't reach — left intentionally.
- **HTML pages** (help / creator-tools-help / lorebook-studio): each defines `[data-skin="sunflowers"]` + `[data-skin="sunflowers"][data-theme="light"]` variable blocks plus retints for hardcoded hero/card/footer surfaces, and hides the DJ `body::before` bg image. **help.js** reads `djt:settings.skin` from `chrome.storage.local` and applies `data-skin` (cached in `localStorage` as `djt-help-skin`), so the pages match whatever skin is active in the panel.
- **Cross-page nav**: each HTML page has a `.page-nav` bar linking to the other two (current page shown as a non-link "here" chip).

## Data manager (Advanced footer → "🗄️ Manage saved data")

`openDataManager()` opens a modal (reuses `#djt-lb-overlay`) that lists everything the toolkit has in `chrome.storage.local`, grouped by category with item counts and byte sizes, and offers **per-item delete + per-category Clear all**. Categories are derived from key prefixes: `djt:<sessionId>` → Session data (rerolls/stats/scratchpad), `djt:botbackup:<botId>` → Bot backups, `djt:lb-library` → Lorebook library (per-item = array index), `djt:lorebook` → Active lorebook, `djt:settings` → Toolkit settings (Reset-to-defaults only, never auto-deleted). Clicks are delegated on `#djt-dm-body` (`onDataManagerClick`) so the listener survives re-renders; destructive actions confirm() first. Styles are `.djt-dm-*` (scoped under the overlay, using `--lb-*` tokens).

Each **bot backup** row also has a **Restore** button (`restoreBackup`): it closes the manager first (so `botGuard()`'s Legacy prompt can show), runs the same guard as Export/Import, then `bridgeRequest('import', backup.bot)` to populate the open bot form — i.e. the autosave snapshots are recoverable, and restoring backup B onto bot A's page is effectively a clone.

**Esc closes overlays** (global keydown): `#djt-lb-overlay` is removed; the `.djt-modal-overlay` confirm dialog has its Cancel clicked (so its pending promise resolves rather than dangling). Bot-backup rows also have a **Restore** button (`restoreBackup`) that runs `botGuard()` then `bridgeRequest('import', bot)` to populate the open bot form from the snapshot.

**Esc closes modals:** a single document `keydown` listener (added once at init) removes any open `#djt-lb-overlay`, or clicks the confirm dialog's Cancel (so its awaiting promise resolves).

## CSP constraints (extension pages)

Extension pages (help.html etc.) run under MV3 CSP. This means:
- **No inline `<script>` tags** — must use external .js files (hence help.js)
- **No external font imports** — Google Fonts @import is blocked
- **Images in web_accessible_resources** — any image injected into a webpage via content script must be listed there, otherwise the browser blocks it with a broken image

---

## V2.1 UI/UX improvements (June 2026)

- **Removed scan bar clutter**: Deleted the fixed-position bottom-left "Live scan on" badge. Scanner still works (paints highlights on chat), just no external UI cluttering the page.
- **Fixed modal centering**: Removed CSS that was breaking load modal positioning (`position: static`). All modals now center properly using `position: fixed; inset: 0`.
- **Active Chat Panel internalized**: Moved from floating modal (`djt-panel-overlay`) to inline collapsible card within Lorebook Tools. Users stay in the panel instead of opening separate windows.
- **Event-driven panel refresh**: Active Chat Panel now refreshes 500ms after a new message lands (via `containerObserver`), with a 30s fallback. No more blind polling.
- **Recent-window focus**: Both the scanner and the panel only consider the last 4 messages (2 bot, 2 user) via `recentChatText()` / `runChatScan()`.
- **Em dashes purged**: All user-facing copy and tooltips use plain punctuation (no `—`).

## Fixed in V2.1 (was: known issues)

- **DJ sidebar overlap** — fixed by bumping panel z-index to `2147483647`.
- **Sun icon dragging / collapsed bubble sticking** — fixed with `e.preventDefault()` + `draggable="false"` (kills native image-drag) and a 4px click-vs-drag threshold.
- **Expand pushing panel off-screen** — fixed with `clampPanelIntoView()` after expand.
- **Panel resizing** — added `#djt-resize` handle (`initResize`), persisted in `settings.panelSize`.

## Quill (optional local-LLM / API assistant) — added in Aster

Quill connects the toolkit to a model the **user** supplies (local or API). The extension has no AI of its own. Network always goes through **background.js** (see Architecture).

- **Settings window (popup)** configures it: enable, backend (`ollama`/`lmstudio`/`kobold`/`openai`/`api`), per-backend URL+model, optional API key. Gated behind an "I understand" checkbox (`quill.ack`) + a link to `quill-guide.html`. "Test connection" pings `quill.test`; non-localhost API hosts trigger an `optional_host_permissions` request on the user gesture.
- **Chat tab** (`runQuillImprove`, `runQuillSummarize`): improve-my-message (strength 1-5, tone, length, 500-char custom + presets, per-session `quillPersona`), and summarize (5/10/15/20 or "from start" behind a confirm). Reads the composer textarea + `lastBot()` for context.
- **Creator tab — Character Lens** (`runQuillReview`): reads the bot files via `bridgeRequest('export')` and gives an analytical review of a creator's stated concern. System prompt forbids user-bias agreement and forbids rewriting the bot.
- **Creator tab — Import a character** (`runQuillImport`): parses a SillyTavern card (PNG `tEXt`/`iTXt` `chara`/`ccv3` chunk → base64 JSON via `extractPngTextChunks`/`decodeCharaText`) or `.json`/`.txt`, maps known card fields, asks Quill (JSON mode) to reorganize into the DJ template, then offers Download `.json` (via `botEnvelope`) or Apply-to-bot-page (`bridgeRequest('import')`).
- All Quill system prompts live in content.js (`quillImproveSystem`, `quillSummarizeSystem`, `quillReviewSystem`, `quillImportSystem`). `quillChat(system, user, opts)` is the shared call; `opts.json` sets Ollama `format:json` / OpenAI `response_format`.

## Hide/show panel sections (Settings window)

`settings.hidden[key]` hides a section from the on-page panel. Honored by `applyVisibility()` in content.js (a section shows only if its feature toggle is on AND it isn't hidden), and can hide either tab (`tab:chat`/`tab:creator`, never both). The popup's `VIS_SECTIONS` mirrors content.js's `HIDEABLE` registry. Saved on the Settings "Save" button; applied live via `chrome.storage.onChanged`.

## Mobile

Same codebase, loaded on **Kiwi Browser or Lemur Browser** (Chromium for Android, from a zip). Touch drag/resize already built in. On mobile, **Quill only works with an API backend** (local servers need a computer). Packaged in `../dist/Aster-Mobile.zip`.

## Live test results (100-message chat, 2026-06-04)

Full QA run as a user (persona "Hailey") vs the "Hideo" bot, model unslopnemo, 50/50 = 100 on the counter, 3 rerolls. Everything driven through the live panel via the Chrome MCP.

**Confirmed working:**
- **Hard-refresh freeze fix — PASSED on a real chat.** After a mid-chat reload: 30/30/60, NOT frozen N/0/N; bot detection survived hydration; rerolls persisted. The bug that started this project is genuinely fixed.
- **Reroll ×3:** counter incremented each time, saved-replies panel populated (2/2), regenerated text differed, recovered a character-break misfire. The previously-intermittent Rerolls counter was rock-solid. The greeting/duplicate-node bug did NOT reproduce.
- **Live stats** matched the DOM exactly on every check.
- **Quill improve:** works; persona injection excellent (rewrites pulled the persona's hazel eyes/freckles). Strength 5 = full rewrite; strength 2 = preserves POV + grammar cleanup. "Use this" → send round-trip works.
- **Quill summarize (count=20):** excellent, structured, accurate, no invention. "From the start" confirm-modal warning works.
- **Per-session persona** loads and feeds Quill correctly.

**Findings / limitations to fix (NONE are crashes — Aster is solid):**
1. **Counter is DOM-based + DJ virtualizes.** During an active session it accumulates fine, but DJ unmounts older messages, so a refresh re-bases the count down and on long chats "total" reflects the loaded window, not a lifetime tally. Document this and/or scroll-to-load before counting.
2. **Quill "from the start" only saw the loaded window** — on the 100-msg chat it summarized only the recent section and MISSED the early scenes (virtualization had unmounted them). FIX: reuse the existing scroll-to-top loader to mount the full history before summarizing/counting.
3. **Extension ID changes on reload-from-new-path** (it did, after the folder rename: new id `bjknlj…`), which broke `OLLAMA_ORIGINS` → Quill HTTP 403. FIX: add a stable `"key"` to manifest.json so the ID is fixed regardless of path. (After adding the key, update OLLAMA_ORIGINS to the new stable ID once and it never breaks again.)
4. **Quill improve defaults to first-person present** (clashes with third-person-past chats) and mistral-nemo sometimes wraps output in stray quotes. FIX: optional POV/tense control + defensively strip leading/trailing quotes from improve output.
5. **Local-model summaries are slow** (~90s on a 12B). UI handled it gracefully (persistent status). An API backend would be far snappier.

## Open / known issues (NOT yet fixed)

- **Reroll / greeting-as-option + intermittent Rerolls counter:** DJ renders each message as two same-id nodes (2nd lacks the avatar) and rerolling appends a new-id node instead of replacing in place, so `findRegenTarget()` can read the old (unchanged) reply → duplicate-guard skips capture. Candidate fix: harden `isBot`/`getMessages` against duplicate nodes + make regen capture robust to the new-id behavior. **Did NOT reproduce in the 2026-06-04 100-message run** (all 3 rerolls behaved correctly) — may be model/timing specific.
- **Use button feedback**: Lorebook library "Use" button shows no visual feedback during load.

## Release state

First release shipped as **Aster** (was Sunny's DJ Toolkit V1.2 → V2.1). Repo: github.com/Sunflower-Seedss/Aster (private). Packaged zips in `../dist/`. See `../README.md` and the Downloads `Aster-Next-Session-Prompt.md` for the full handoff.

