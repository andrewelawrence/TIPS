# TIPS: A TwIPS Tool - Text Interpretation, Previewing & Suggestions

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.3.2-blue)]() 

**TIPS is a Chromium browser extension designed to enhance online communication by providing AI-powered interpretations, previews, and suggestions for text content.**

It draws inspiration from the research concepts presented in the TwIPS messaging platform ([arXiv:2407.17760](https://arxiv.org/pdf/2407.17760)).
See the project design document for more information <https://docs.google.com/document/d/1nshcoPpixGUOw4tU8csQm7JQtdqcUCGqiwjO3W1fTMw/edit?usp=sharing>.

## Overview

In online discussions, forums, and social media, the true meaning, tone, and context behind text can often be unclear - especially to neurodivergent users. TIPS aims to bridge this gap by offering users quick AI insights directly within their browser. By selecting text, users can invoke features to understand nuance, anticipate reception, or rephrase messages effectively.

## Current Status

⚠️ **Active Development (Alpha):** This extension is currently under development. While the core "Interpret" feature is functional, expect bugs and ongoing changes.

## Features

### Implemented

*   **Text Selection & UI Trigger:**
    *   Highlighting text on any webpage reveals a '💡' icon near the bottom-right of the selection.
    *   Clicking the icon displays a styled action menu (`I`, `P`, `S`).
*   **Interpret ('I') Feature:**
    *   Clicking 'I' triggers context collection (`content.ts`): selected text, surrounding text (using `@mozilla/readability` and DOM traversal), page URL, and page title.
    *   This data is sent to the background service worker (`background.ts`).
    *   The background script retrieves your Anthropic API key (configured during setup).
    *   It calls the Anthropic Claude API (currently `claude-3-7-sonnet-20250219`) with a specialized system prompt (`.anthropic/INTERPRET.txt`) designed for contextual text interpretation and confidence scoring.
    *   The AI response (JSON containing explanation and confidence) is parsed.
    *   The result is stored temporarily in `chrome.storage.local`.
    *   The content script receives confirmation, showing a tooltip ("Interpretation ready!") and making the page's '💡' icon glow temporarily before fading out.
    *   Clicking the TIPS extension icon in the browser toolbar opens a popup (`Popup.svelte`) which loads and displays the stored interpretation and confidence score in a styled card format.

### Planned

*   **Preview ('P'):** Analyze your own drafted text for tone, clarity, and potential misinterpretation before sending.
*   **Suggest ('S'):** Get alternative phrasings for selected text, focusing on clarity or adjusting tone (e.g., making it softer).
*   **Data Logging:** Store interaction metadata (anonymously, with consent) in MongoDB Atlas for analysis and improvement.
*   **Advanced Features:** Image/GIF analysis, user feedback mechanisms, Google OAuth for personalization (privacy-permitting), refined context gathering.

**(See `roadmap.md` for a detailed development plan.)**

## Technology Stack

*   **Platform:** Chrome Extension (Manifest V3)
*   **Language:** TypeScript
*   **UI (Popup):** Svelte
*   **Build Tool:** Vite
*   **AI:** Anthropic Claude API via `@anthropic-ai/sdk`
*   **Context Extraction:** `@mozilla/readability`, DOM APIs
*   **Styling:** CSS (inline styles in `content.ts`, component styles in Svelte)

## Architecture

The extension follows a standard Manifest V3 structure:

```
[ Content Script (content.ts) ]        <-- User interacts with webpage text
         | (Detects selection, shows icon/menu)
         | (Sends INTERPRET_TEXT message)
         v
[ Background Service Worker (background.ts) ]
         | (Receives message, retrieves API key)
         | (Calls Anthropic API) --> [ Anthropic API ]
         | (Parses response, stores in chrome.storage)
         | (Sends INTERPRETATION_READY/ERROR message back)
         v
[ Content Script (content.ts) ]        <-- Shows tooltip/icon effect
         |
         | (User Clicks Toolbar Icon)
         v
[ Popup (Popup.svelte / main.ts) ]
         | (Loads data from chrome.storage.local on open)
         | (Displays interpretation)
```

## Program Flow: "Interpret" Feature

1.  **User:** Selects text on a webpage.
2.  **`content.ts`:** Detects `mouseup`, gets selection range.
3.  **`content.ts`:** Creates/shows '💡' icon at selection bottom-right.
4.  **User:** Clicks '💡' icon.
5.  **`content.ts`:** Shows styled `I P S` menu below the icon.
6.  **User:** Clicks 'I' button.
7.  **`content.ts`:** Hides `I P S` menu. Gathers `selectedText` and `context` (URL, title, surrounding text via Readability/DOM). Sends `{ type: 'INTERPRET_TEXT', ... }` message to background.
8.  **`background.ts`:** Receives message. Reads `VITE_ANTHROPIC_API_KEY` from environment. Fetches system prompt (`.anthropic/INTERPRET.txt`). Constructs user prompt with selection and context.
9.  **`background.ts`:** Calls `anthropicClient.messages.create(...)`.
10. **Anthropic API:** Processes request, returns JSON interpretation.
11. **`background.ts`:** Parses response. Stores `{ interpretation, originalSelection, ... }` in `chrome.storage.local.set({ lastInterpretation: ... })`. Sends `{ type: 'INTERPRETATION_READY' }` message back to content script tab.
12. **`content.ts`:** Receives `INTERPRETATION_READY`. Gets icon's last position. Applies glow effect to icon. Shows "Interpretation ready!" tooltip near icon position. Starts tooltip fade-out timer.
13. **`content.ts`:** Tooltip finishes fading -> Hides tooltip and '💡' icon.
14. **User:** Clicks TIPS extension icon in toolbar.
15. **`popup/main.ts` & `Popup.svelte`:** Popup loads. `onMount` fetches `lastInterpretation` from `chrome.storage.local.get(...)`.
16. **`Popup.svelte`:** Renders the interpretation text and confidence score in the styled card.

## Development Setup

1.  **Prerequisites:**
    *   Node.js (LTS version recommended) and npm.
    *   Git.
2.  **Clone Repository:**
    ```bash
    git clone <https://github.com/andrewelawrence/TIPS>
    cd TIPS
    ```
3.  **Install Frontend Dependencies:**
    ```bash
    cd src/frontend
    npm install
    ```
4.  **Configure API Key:**
    *   Obtain an API key from [Anthropic](https://console.anthropic.com/).
    *   In the `src/frontend` directory, create a file named `.env.local`.
    *   Add your API key to this file exactly as follows:
        ```dotenv
        VITE_ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY_HERE
        ```
    *   **Important:** This file is included in `.gitignore` and should **never** be committed to version control.
5.  **Build the Extension:**
    ```bash
    # Still inside src/frontend
    npm run build
    ```
    This compiles the TypeScript/Svelte code and copies necessary files (manifest, icons, prompts) into the `dist/frontend` directory.
6.  **Load in Chrome:**
    *   Open Chrome and navigate to `chrome://extensions/`.
    *   Enable "Developer mode" (usually a toggle in the top-right).
    *   Click "Load unpacked".
    *   Select the `dist/frontend` directory (the one created by the build process).
7.  **Usage:** Navigate to a webpage, select text, and use the '💡' icon that appears. Click the extension's toolbar icon to see results after interpretation.

## Acknowledgements

*   Inspired by the [TwIPS](https://arxiv.org/pdf/2407.17760) research paper.
*   [Tip Icon](https://icons8.com/icon/12244/idea) by [Icons8](https://icons8.com).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details (or add LICENSE file if not present).
