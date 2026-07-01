# 🌻 Aster

DreamJourney AI quality-of-life Chromium browser extension.
Part of [Sunflower Fields](https://sunflower-seedss.github.io/Sunflower-Seeds-Homebase/index.html) · made by SunflowerS.

       ₊˚ ✧ ━━━━⊱⋆⊰━━━━ ✧ ₊˚

Aster adds a friendly on-page panel to your DreamJourney chats and bot pages — for tracking, tidying, writing and building. All data is stored locally on your device; nothing is uploaded anywhere (the only exception is the optional **Quill** assistant, which talks to a language model *you* choose and connect).

> The extension lives in the `Aster/` folder. See its [README](./Aster/README.md) for the full breakdown, or the [**Aster info page**](https://sunflower-seedss.github.io/Sunflower-Seeds-Homebase/aster.html) for the full tour.

       ₊˚ ✧ ━━━━⊱⋆⊰━━━━ ✧ ₊˚

## ⬇️ Get it

Clone or download this repo and load it unpacked (see [Install](#-install-unpacked) below). Ready-made zips, when posted, live on the [**Releases**](../../releases) page.

       ₊˚ ✧ ━━━━⊱⋆⊰━━━━ ✧ ₊˚

## 💬 Chat Tools

**Stats + Nexus reminder** — tracks your message counts and rerolls per chat, and shows how many messages have passed since your last Nexus check. Turns orange then red as you get further from it.

**Save regenerations** — saves previous bot replies before they disappear when you regen. Browse them and swap one back in with one click.

**User Input Recovery** — autosaves what you're typing, and keeps your last 5 sent messages, so a crash, timeout, or Stop-Generation never loses your words.

**Auto-refresh on Stop** — a 3-second countdown to refresh after stopping a generation, clearing the duplicate/missing-message errors that can cause.

**Delete Thinking** *(Nyx and Athena only)* — removes the thinking block from a message once you're done with it.

**Download chat** — exports the full conversation as a .txt with the character's name on each message.

**Rebuild Nexus from Chat** — replace a chat's Memory Nexus with a clean version distilled by your own LLM (copy the built-in prompt, run it on your chat export, paste the result back). It backs up the old Nexus first with one-click restore, and can lock every imported memory so the auto-Nexus stops overwriting them.

**Thinking Template Override** — use your own thinking template instead of the bot's, saved per chat and loaded automatically when you switch chats. Save favourites as presets.

**Hide from AI** — hide a single message from the AI's context in a chat (like a bugged duplicate you can't delete) without removing it. It collapses to a small bar and is stripped from what the model sees.

## 🛠️ Creator Tools

**Export / Import bot** — back up a bot to JSON and restore it, dropdowns and toggles included.
**Lorebook tools** — load saved lorebooks, test which entries a message triggers, and watch a live token budget.
**Lorebook Workshop** — merge, wrap and unwrap lorebooks in one page.

## ✒️ Quill *(optional — bring your own model)*

Quill connects Aster to a language model **you** choose — local (Ollama, LM Studio, koboldcpp) or a paid OpenAI-compatible API. **Aster has no AI of its own**; Quill is just the pipe.

- **Improve my message** — light grammar fixes up to a full in-character rewrite.
- **Summarize chat** — recent messages (or the whole chat) into factual bullet points.
- **Character Lens** — an analytical second read of your bot's files (never rewrites them for you).
- **Import a character** — convert a SillyTavern card (`.png`/`.json`) or text bot into DreamJourney's template.

       ₊˚ ✧ ━━━━⊱⋆⊰━━━━ ✧ ₊˚

## 📦 Install (unpacked)

1. Download / clone this repo.
2. Go to `chrome://extensions` and enable **Developer mode**.
3. **Load unpacked** → select the `Aster` folder.
4. Open a DreamJourney chat — the panel appears automatically. Click the Aster icon in your browser bar for settings.

## 🖥️ Browser support

Works on Chrome, Edge, Brave, and any other Chromium-based browser.
Firefox is not recommended: manually-installed extensions reset when the browser closes, so stats and saved data won't carry over.

**Mobile:** use a Chromium-for-Android browser that supports extensions — **[Kiwi Browser](https://kiwibrowser.com)** or **Lemur Browser** — and load it unpacked the same way. The core tools work the same as desktop. **Quill on mobile only supports an API connection** — local backends (Ollama, LM Studio, koboldcpp) need a computer, so they aren't reachable from a phone.

       ₊˚ ✧ ━━━━⊱⋆⊰━━━━ ✧ ₊˚

🌻 **[Visit Sunflower Fields](https://sunflower-seedss.github.io/Sunflower-Seeds-Homebase/index.html)**
