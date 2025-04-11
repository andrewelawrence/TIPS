import '@anthropic-ai/sdk/shims/web';
import { Anthropic } from "@anthropic-ai/sdk";

console.log("TIPS Background Script Loaded.");

// --- Message Listener ---
chrome.runtime.onMessage.addListener(
  // Make the listener async
  async (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    console.log("Message received in background:", message);
    console.log("Sender:", sender);

    // --- Handle INTERPRET_TEXT --- 
    if (message.type === "INTERPRET_TEXT") {
      const { text: selectedText, context } = message;
      console.log("Request to interpret text:", selectedText);
      console.log("Received context:", context);

      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      console.log(`API Key retrieved from build: ${apiKey ? 'Found' : 'Not Found'}`); 

      if (!apiKey) {
        console.error("Anthropic API Key not found in build environment variables (VITE_ANTHROPIC_API_KEY). Cannot proceed.");
        return true; // Exit if no API key, keep channel open in case UI needs update
      }

      // 1. Fetch the system prompt
      let systemPrompt: string | null = null; // Initialize as null
      const promptUrl = chrome.runtime.getURL(".anthropic/INTERPRET.txt");
      try {
          const promptResponse = await fetch(promptUrl);
          if (!promptResponse.ok) {
              throw new Error(`Failed to fetch prompt: ${promptResponse.status} ${promptResponse.statusText}`);
          }
          systemPrompt = await promptResponse.text();
          console.log("Successfully loaded system prompt.");
      } catch (promptError) {
          console.error("Critical Error: Failed to load system prompt. Aborting interpretation request.", promptError);
          return true; // Keep channel open in case UI needs update
      }

      // Proceed only if systemPrompt was loaded successfully
      try {
        // 2. Construct the user message including context
        const userMessageContent = `
            Webpage Context:
            URL: ${context.url}
            Title: ${context.title}
            Text Before Selection: ${context.precedingText || 'N/A'}
            Text After Selection: ${context.succeedingText || 'N/A'}

            Selected Text to Analyze:
            ---
            ${selectedText}
            ---
            Please analyze the "Selected Text to Analyze" based on the instructions.
        `;

        // 3. Initialize client and call API
        const anthropicClient = new Anthropic({
          apiKey: apiKey,
          dangerouslyAllowBrowser: true
        });

        console.log("Sending request to Anthropic for interpretation...");
        const response = await anthropicClient.messages.create({
          model : "claude-3-7-sonnet-20250219",
          // model : "claude-3-5-sonnet-20241022",
          // model: "claude-3-5-haiku-20241022",
          max_tokens: 1024, // Adjust as needed
          system: systemPrompt, // Use the loaded system prompt
          messages: [
            { role: "user", content: userMessageContent } // Use the constructed user message
          ],
        });

        // 4. Log the raw JSON response (as required by Phase 1, Step 5)
        console.log("Raw Interpretation Response from Anthropic:", JSON.stringify(response, null, 2));

        // --- Phase 2: Store processed result for Popup ---
        if (response.content && response.content.length > 0 && response.content[0].type === 'text') {
            const responseText = response.content[0].text;
            try {
                const interpretationData = JSON.parse(responseText); // Expected: { text: string, confidence: float }

                if (typeof interpretationData.text === 'string' && typeof interpretationData.confidence === 'number') {
                    const dataToStore = {
                        interpretation: interpretationData,
                        originalSelection: selectedText,
                        originalContext: context // { url, title, precedingText, succeedingText }
                    };
                    await chrome.storage.local.set({ lastInterpretation: dataToStore });
                    console.log("Interpretation result stored successfully:", dataToStore);
                    // Send confirmation back to content script
                    if (sender.tab?.id) {
                        chrome.tabs.sendMessage(sender.tab.id, { type: "INTERPRETATION_READY" });
                    }
                } else {
                    console.error("Parsed interpretation data is not in the expected format:", interpretationData);
                    // TODO: Handle unexpected format - maybe store an error state?
                }
            } catch (parseError) {
                console.error("Error parsing JSON response from Anthropic:", parseError);
                console.error("Raw response text that failed parsing:", responseText);
                // TODO: Handle parsing error - maybe store an error state?
                if (sender.tab?.id) {
                    chrome.tabs.sendMessage(sender.tab.id, { type: "INTERPRETATION_ERROR", error: "Failed to parse AI response." });
                }
            }
        } else {
            console.error("Anthropic response content is missing or not in the expected format:", response);
            // TODO: Handle missing/invalid content - maybe store an error state?
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: "INTERPRETATION_ERROR", error: "Invalid AI response format." });
            }
        }
        // --- End Phase 2 modification ---

        // TODO: (Phase 2) Store and/or send processed result to UI - Handled above by storing in chrome.storage
        // const analysisResult = response.content;
        // console.log("Analysis Result Content:", analysisResult);

      } catch (error) {
        console.error("Error calling Anthropic API for interpretation:", error);
        // TODO: Handle error appropriately
        if (sender.tab?.id) {
            chrome.tabs.sendMessage(sender.tab.id, { type: "INTERPRETATION_ERROR", error: "API request failed." });
        }
      }

      return true; // Keep channel open for potential async response later
    }
    
    // Handle other message types if needed (like the old ANALYZE_TEXT if you haven't removed it yet)
    // Or remove the old handler block completely

    return false; // Return false if message type not handled or no async response needed
  }
);

// Optional: Add listeners for context menus, commands, etc.
// chrome.contextMenus.create(...);
// chrome.commands.onCommand.addListener(...);