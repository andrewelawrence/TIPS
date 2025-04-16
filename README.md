# TIPS: A TwIPS Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.4.1-blue)]() 
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)]()

**TIPS is a Chromium browser extension designed to enhance online communication by providing AI-powered interpretations, previews, and suggestions for text content.**

It draws inspiration from the research concepts presented in the TwIPS messaging platform ([arXiv:2407.17760](https://arxiv.org/pdf/2407.17760)).
See the project [design document](https://docs.google.com/document/d/1nshcoPpixGUOw4tU8csQm7JQtdqcUCGqiwjO3W1fTMw/edit?usp=sharing) for more information.

## Overview

In online discussions, forums, and social media, the true meaning, tone, and context behind text can often be unclear - especially to neurodivergent users. TIPS aims to bridge this gap by offering users quick AI insights directly within their browser. By selecting text, users can invoke features to understand nuance, anticipate reception, or rephrase messages effectively.

## Current Status

⚠️ **Active Development (Alpha - v0.4.1):** This extension is currently under development, focusing on the core "Interpret" and "Context" features via the right-click menu. Expect bugs and ongoing changes.

## Features

### Core Functionality

*   **Interpretation:**
    *   Users can click on the '💡' icon or select `Interpret Selection` from the context menu to trigger analysis of the selected content.
    *   Doing so sends the target content and any user-added context (see below) to the background service worker.
    *   The background script calls the Anthropic Claude API with a specialized system prompt (`src/frontend/public/INTERPRET.txt`) designed for contextual interpretation, confidence scoring, and tone analysis.
    *   The AI response is parsed and the result (interpretation, original content reference, context used) is stored and displayed in the popup (`src/frontend/public/Popup.svelte`).
*   **Context Menu:**
    *   Right-clicking on selected text, images, links, or the page itself reveals context menu options: `Interpret` `Add to Context` and `Clear Context`.
    *   Selecting "Add to Context" from the context menu saves a reference to the right-clicked element (text snippet, image URL, link URL) to a temporary list associated with the current tab.
    *   This list of context items is included with subsequent "Interpret" requests for that tab, allowing users to guide the AI's understanding. Context is automatically cleared when the tab is closed or navigated away.
*   **Popup Display:**
    *   The popup shows the element that was interpreted, displaying the AI's interpretation text below the element.
*   **Welcome Page:**
    *   Upon first installation, the extension opens a local `welcome.html` page explaining the features and basic usage.

### Future Features

*   **Preview ('P'):** Analyzing own drafted text. (Removed for simplification).
*   **Suggest ('S'):** Getting alternative phrasings. (Removed for simplification).

See the [Road Map](ROADMAP.md) for more details.

## Technology Stack

*   **Platform:** Chrome Extension (Manifest V3)
*   **Language:** TypeScript
*   **UI (Popup):** Svelte
*   **Build Tool:** Vite
*   **AI:** Anthropic Claude API via `@anthropic-ai/sdk`
*   **Styling:** CSS (component styles in Svelte)

## Architecture

The extension follows a standard Manifest V3 structure:

```
[ Content Script (content.ts) ]        <-- User interacts with page (selection, right-click)
         | (Detects selection -> shows icon)
         | (Manages icon click -> sends INTERPRET_TEXT to background)
         | (Receives confirmation -> shows tooltip)
         |
         |-----> [ Right-Click Event ] ---> [ Background Script (background.ts) ] <-- User adds context / interprets
                     | (Context Menu Click: Interpret / Add to Context)
                     | (Info about clicked element: selectionText, srcUrl, linkUrl, pageUrl)
                     v
[ Background Service Worker (background.ts) ]
         | (Handles context menu clicks)
         | (Manages context list per tab in chrome.storage/memory)
         | (Receives INTERPRET_TEXT message OR context menu interpret click)
         | (Retrieves API key, context list)
         | (Calls Anthropic API with target + context) --> [ Anthropic API ]
         | (Parses response, stores interpretation in chrome.storage.local)
         | (Sends confirmation to content script if applicable)
         | (Handles chrome.runtime.onInstalled for welcome page)
         v
[ Popup (Popup.svelte / main.ts) ]   <-- User Clicks Toolbar Icon
         | (Loads last interpretation data from chrome.storage.local on open)
         | (Displays interpreted element, interpretation, tone, confidence)
```

## Development Setup

1.  **Prerequisites:** Ensure you have [Node.js](https://nodejs.org/) (LTS version recommended) and [Git](https://git-scm.com/) installed.

2.  **Clone & Navigate:**
    ```bash
    git clone https://github.com/andrewelawrence/TIPS.git
    cd TIPS/src/frontend
    ```

3.  **Install Dependencies:**
    ```bash
    # Ensure you are in the src/frontend directory
    npm install
    ```

4.  **Configure API Key:**
    *   Get an API key from [Anthropic](https://console.anthropic.com/).
    *   Create a file named `.env.local` in the `src/frontend` directory.
    *   Add your key to the file: `VITE_ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY_HERE`
    *   *(Note: `.env.local` is in `.gitignore` and should not be committed.)*

5.  **Build the Extension:**
    ```bash
    # Still in src/frontend
    npm run build
    ```
    *   This compiles the code and outputs the necessary files to the `dist/` directory at the project root.

6.  **Load in Chrome:**
    *   Open Chrome and go to `chrome://extensions/`.
    *   Enable "Developer mode".
    *   Click "Load unpacked".
    *   Select the `dist/` directory (the one created by the build process).

7.  **Usage:**
    *   The extension should now be active. Right-click elements or select text and click the 💡 icon to use TIPS.
    *   (Optional: A welcome page _should_ open on first load/update, but if not, simply open `public/welcome.html` in your preferred browser).

## Acknowledgements

*   Inspired by the [TwIPS](https://arxiv.org/pdf/2407.17760) research paper.
*   [Tip Icon](https://icons8.com/icon/12244/idea) by [Icons8](https://icons8.com).

## License

This project is licensed under the MIT License. (LICENSE file incoming.)

_Last edit by Andrew Lawrence 04/16/2025_