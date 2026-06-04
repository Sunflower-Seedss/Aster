# 🌻 Aster

**A quality-of-life browser extension for [DreamJourney AI](https://www.dreamjourneyai.com).**
Part of [Sunflower Fields](https://sunflower-seedss.github.io/Sunflower-Seeds-Homebase/index.html) · made by SunflowerS.

Aster adds a friendly on-page panel to your DreamJourney chats and bot pages, with tools for tracking, tidying, writing and building. Everything runs **locally on your device** — nothing is uploaded anywhere (the only exception is Quill, which talks to a model *you* choose and connect).

---

## What it does

### 💬 Chat Tools
- **Session stats** — live count of your messages, the bot's, the total, and your rerolls.
- **Nexus reminder** — a gentle nudge to run a memory check-up, colour-coded as the chat grows.
- **Saved replies** — keeps your regenerated replies so you can flip back to an earlier one.
- **User Input Recovery** — saves your unsent draft and recent sent messages, so a misclick never loses your words.
- **Auto-refresh on Stop** — avoids the double/broken messages that can happen when you stop a generation.
- **Delete thinking** — strips the reasoning block from Nyx / Athena replies once you've read it.
- **Download chat** — save the whole conversation as a `.txt`, plus quick scroll-to-top / bottom buttons.

### 🛠️ Creator Tools (on bot create/edit pages)
- **Export / Import bot** — back up a bot to a `.json` file and restore it, dropdowns and toggles included.
- **Lorebook tools** — load a saved lorebook, test which entries a message triggers, and a live token-budget scanner.
- **Lorebook Workshop** — a full page to merge, wrap and unwrap lorebooks.

### ✒️ Quill (optional — connect your own AI model)
Quill is a writing assistant that connects Aster to a language model **you** choose — a free local one (Ollama, LM Studio, koboldcpp) or a paid API (OpenAI-compatible). **Aster has no AI of its own**; Quill is just the pipe.
- **Improve my message** — polish your chat message, from light grammar fixes up to a full creative rewrite, in your character's voice.
- **Summarize chat** — turn recent messages (or the whole chat) into factual bullet points.
- **Character Lens** — an analytical second read of your bot's files that flags wording a model might misread (it never rewrites your bot for you).
- **Import a character** — convert a SillyTavern card (`.png`/`.json`) or text bot from anywhere into DreamJourney's template.

---

## ⚙️ Settings
Click the Aster icon in your browser bar for the **Settings window**: choose a theme, hide any panel sections you don't use, and set up Quill's model connection (behind a short safety guide).

## 🔒 Privacy
All your data — stats, drafts, saved replies, settings — stays in your browser's local storage on your own device. Quill only sends text to the model endpoint you configure, and only when you press a button.

## 📦 Install (unpacked)
1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open a DreamJourney chat — the panel appears automatically.

---

🌻 **[Visit Sunflower Fields](https://sunflower-seedss.github.io/Sunflower-Seeds-Homebase/index.html)** for more.
