# TIPS Extension Roadmap

This document outlines the development plan for the TIPS (Text Interpretation, Previewing, and Suggestions) Chrome Extension. The goal is to iteratively implement features inspired by the TwIPS research paper, focusing on Interpret, Preview, and Suggest functionalities for web text content. Development follows KISS (Keep It Simple, Stupid) principles.

## Overall Goal

*   Implement the core TwIPS features (Interpret, Preview, Suggest) as a browser extension.
*   Provide AI-powered assistance for understanding and crafting online communication, initially focusing on text.
*   Develop iteratively, prioritizing core functionality and simplicity.

## Current Status

*   **Foundation:** Basic extension structure (manifest, background, content, popup) is functional and loadable.
*   **Text Selection:** Highlighting text on a webpage correctly displays a '💡' icon (`content.ts`).
*   **API Key:** A basic popup UI (`Popup.svelte`) allows users to manually enter and save their Anthropic API key to `chrome.storage.local`.
*   **Core API Call:** Clicking the '💡' icon sends the selected text to the background script (`background.ts`). The background script successfully retrieves the stored API key, initializes the Anthropic client (with necessary shims and browser flags), calls the `messages.create` endpoint, and logs the raw API response object to the **service worker console**.

## Phased Development Plan

### Phase 1: Basic "Interpret" Implementation (Core Logic)

*   **Goal:** Implement the backend logic for the "Interpret" feature, using a dedicated system prompt and basic page context, logging the raw result to the console.
*   **Steps:**
    1.  **UI Trigger (`content.ts`):**
        *   Modify the '💡' icon's `click` event handler (`handleIconClick`).
        *   Upon clicking the icon, display a simple inline menu/tooltip near the icon with clickable options: "Interpret", "Preview", "Suggest".
        *   Clicking the "Interpret" option will trigger the message sending to `background.ts`. ("Preview" and "Suggest" options will be non-functional initially).
    2.  **Context Collection (`content.ts`):**
        *   When "Interpret" is triggered, gather the following data:
            *   `selectedText`: The highlighted text content.
            *   `url`: The URL of the current page (`window.location.href`).
            *   `title`: The title of the current page (`document.title`).
            *   `surroundingText`: Implement best-effort logic to retrieve text content from the immediate preceding and succeeding sibling elements (or relevant parent elements) relative to the selected text's container in the DOM. Handle potential errors gracefully if context cannot be reliably determined.
        *   Package `selectedText`, `url`, `title`, and `surroundingText` (if found) into the message payload sent to `background.ts`. Use a clear message `type`, e.g., `INTERPRET_TEXT`.
    3.  **System Prompt Setup:**
        *   Ensure the directory `.anthropic/prompting/` exists within the extension package (likely under `src/frontend/public` or configured via `vite-plugin-static-copy` to be copied to `dist`).
        *   Create the prompt file: `.anthropic/prompting/interpret_explain.txt` containing the system prompt for the initial explanation and confidence rating (as defined in `README.md`):
            ```
            Explain the meaning of the following portion of content in the webpage in less than 30 words. Then, provide a floating-point value between 0.0 and 1.0 to describe the confidence of your assessment.
            Provide your response as the following JSON structure:
            {
            "text": string
            "confidence": float
            }

            Consider the following additional context to the extracted content:
            { webpage title }
            { website url }
            { surrounding text }
            ```
        Where webpage title, website url, and surrounding text and dynamically loaded into the prompt like fstring in Python.

    4.  **API Call Logic (`background.ts`):**
        *   Modify the `chrome.runtime.onMessage` listener to handle the new `INTERPRET_TEXT` message type and its payload (including context).
        *   When an `INTERPRET_TEXT` message is received:
            *   Fetch/load the system prompt text from `chrome.runtime.getURL('.anthropic/prompting/interpret_explain.txt')`.
            *   Construct the user prompt string for the API call. Clearly delineate the `selectedText` from the context (`url`, `title`, `surroundingText`) provided within the prompt.
            *   Call `anthropicClient.messages.create` using the loaded system prompt, the constructed user prompt, and the configured model (e.g., `claude-3-haiku-20240307`).
    5.  **Output:**
        *   Log the full, raw JSON response object received directly from the Anthropic API call to the **service worker console** using `console.log()`.

### Phase 2: Display Interpretation & Multi-Step Logic

*   **Goal:** Display the initial interpretation result to the user within the popup and implement the secondary "Tone" and "Contextual Meaning" analysis features triggered from the popup.
*   **Steps:**
    1.  **Display Initial Interpretation (`Popup.svelte`, `background.ts`):**
        *   Modify `background.ts`: After receiving a successful API response in Phase 1, store the relevant result (explanation text and confidence) temporarily, perhaps in `chrome.storage.local` under a dedicated key (e.g., `lastInterpretationResult`). Also store the original `selectedText` and context used for the call.
        *   Modify `Popup.svelte`: On opening, attempt to load the `lastInterpretationResult` from storage. Display the explanation text and confidence rating. Add "[Explain Tone]" and "[Explain Context]" buttons below the displayed result.
    2.  **Implement Tone Analysis:**
        *   Create prompt file: `.anthropic/prompting/interpret_tone.txt` with the prompt: `"Provide a 1-word tonal analysis of the following portion of content in the webpage."`
        *   Modify `Popup.svelte`: Clicking "[Explain Tone]" sends a new message (e.g., `ANALYZE_TONE`) to `background.ts`, including the original `selectedText` and context retrieved from storage.
        *   Modify `background.ts`: Handle `ANALYZE_TONE`, load the tone prompt, load the original context from storage, call the API, and send the 1-word result back to the popup using `chrome.runtime.sendMessage`.
        *   Modify `Popup.svelte`: Listen for the response and display the received tone analysis.
    3.  **Implement Contextual Meaning Analysis:**
        *   Create prompt file: `.anthropic/prompting/interpret_context.txt` with the prompt: `"Consider the context surrounding the provided portion of text. Explain the meaning of the message given context in 30 words or less."`
        *   Modify `Popup.svelte`: Clicking "[Explain Context]" sends a new message (e.g., `ANALYZE_CONTEXTUAL_MEANING`) to `background.ts`.
        *   Modify `background.ts`: Handle `ANALYZE_CONTEXTUAL_MEANING`, load the context prompt, load original context, call API, send result back.
        *   Modify `Popup.svelte`: Listen for the response and display the received contextual meaning.

### Phase 3: Basic Data Logging (Console)

*   **Goal:** Log structured interaction data to the service worker console for debugging and schema validation before integrating a database.
*   **Steps:**
    1.  **Define Schema:** Define a clear JavaScript object structure for logging `Interpret` events. Include fields like: `timestamp`, `url`, `title`, `selectedText`, `surroundingText` (or flags indicating if found), `feature` ('Interpret-Explain', 'Interpret-Tone', 'Interpret-Context'), `aiResponseText`, `aiConfidence` (if applicable), `modelVersion`, `requestDuration` (optional).
    2.  **Log Data (`background.ts`):** After each successful "Interpret" API call (initial, tone, context), construct the log object according to the defined schema and output it using `console.log()` in the service worker console.

### Phase 4: Data Storage (MongoDB)

*   **Goal:** Persist interaction data to MongoDB Atlas for future analysis and potential personalization.
*   **Steps:**
    1.  **Setup:** Create a MongoDB Atlas free tier cluster, database, and collection. Obtain connection credentials (e.g., connection string or Data API key/endpoint).
    2.  **Integration:** Choose an integration method (e.g., Atlas Data API using `fetch`, or potentially a lightweight MongoDB client library if feasible and secure in the background script).
    3.  **Store Credentials Securely:** Determine a secure way to store connection credentials (potentially requesting them via the popup/options page and storing in `chrome.storage.local`, although this has risks).
    4.  **Implement Storage Logic (`background.ts`):** Replace the console logging from Phase 3 with logic to send the structured log object to the MongoDB collection via the chosen integration method. Handle potential network errors.
    5.  **User Consent:** Implement a clear notice and consent mechanism (e.g., in the popup or a dedicated options page) regarding anonymous data collection *before* enabling storage.

### Phase 5: Implement "Preview" Feature

*   **Goal:** Allow users to analyze their own text (e.g., in a text box) for likely recipient reaction and tone clarity.
*   **Steps:** (High-level)
    1.  Define system prompt for "Preview" (focus on tone, clarity, potential misinterpretation).
    2.  Implement UI trigger (e.g., the "P" button from Phase 1 menu, potentially adapting to work on editable text areas).
    3.  Implement API call logic in `background.ts`.
    4.  Implement display logic (e.g., in the popup).
    5.  Implement data logging/storage for "Preview" events.

### Phase 6: Implement "Suggest" Feature

*   **Goal:** Allow users to get alternative phrasings for their selected text, typically aiming for a softer or clearer tone.
*   **Steps:** (High-level)
    1.  Define system prompt for "Suggest" (preserving intent, modifying tone).
    2.  Implement UI trigger (e.g., the "S" button from Phase 1 menu).
    3.  Implement API call logic in `background.ts`.
    4.  Implement display logic (e.g., showing suggestions in the popup).
    5.  Implement data logging/storage for "Suggest" events.

### Future Enhancements (Post-Core Features)

*   **Google OAuth:** Implement user authentication via Google Sign-In (`chrome.identity`) for user profiling and potentially linking data (requires careful privacy considerations and consent).
*   **User Feedback:** Add "Helpful" / "Not Helpful" / "Inaccurate" buttons to AI responses and log this feedback.
*   **Image/GIF Analysis:** Integrate multi-modal capabilities for interpreting visual content (requires different API calls/models, potentially file handling/storage).
*   **Context Refinement:** Improve the logic for gathering surrounding text and page context in `content.ts`.
*   **Personalization:** Explore using stored interaction data and feedback to tailor prompts or AI behavior (advanced).
*   **Options Page:** Create a dedicated `chrome://extensions` options page for managing settings, API keys, data consent, etc.
*   **UI/UX Polish:** Refine the appearance and usability of the inline menu, popup, and any other UI elements based on user testing.

## Key Decisions & Considerations

*   **API Key Management:** Manual input via the popup will be used initially for simplicity (KISS). Google OAuth integration is deferred.
*   **Data Storage:** Console logging will be implemented first for validation, followed by MongoDB Atlas integration. File storage for images/GIFs is deferred.
*   **Page Context:** Initial implementation will focus on URL, title, and best-effort surrounding text. More advanced context analysis will be considered later.
*   **System Prompts:** Prompts will be stored as text files within the extension package (e.g., in `public/` or similar) and fetched using `chrome.runtime.getURL()` and `fetch()` at runtime in `background.ts`.
*   **Output Display:** Initial AI results will be logged to the service worker console. User-facing display will be implemented iteratively, starting with the extension popup. More integrated UI (overlays) is deferred.
