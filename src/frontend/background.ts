import '@anthropic-ai/sdk/shims/web';
import { Anthropic } from "@anthropic-ai/sdk";

console.log("TIPS Background Script Loaded (v0.4.0).");

// --- Interfaces (matching Popup.svelte) ---
interface TargetInfo {
  type: 'selection' | 'image' | 'link' | 'page';
  selectionText?: string;
  srcUrl?: string;
  pageUrl?: string;
  pageTitle?: string; 
}

interface ContextItem {
  type: 'selection' | 'image' | 'link' | 'pageInfo';
  selectionText?: string;
  srcUrl?: string;
  pageUrl?: string;
  pageTitle?: string; 
  timestamp: number; 
}

interface InterpretationData {
  interpretation: string;
  confidence: number;
  tone: string;
  contextSummary: string;
}

interface StoredData {
  interpretation: InterpretationData;
  originalTarget: TargetInfo;
}

// --- Constants ---
const ANTHROPIC_MODEL = "claude-3-7-sonnet-20250219"; 
    // Options: claude-3-7-sonnet-20250219, claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022
const MAX_CONTEXT_ITEMS = 15; 
const CONTEXT_MENU_ID_INTERPRET = "tips_interpret";
const CONTEXT_MENU_ID_ADD_CONTEXT = "tips_add_context";
const CONTEXT_MENU_ID_CLEAR_CONTEXT = "tips_clear_context";
const SESSION_STORAGE_PREFIX = "tips_context_"; 

// --- Context Management (using chrome.storage.session) ---
// Generate the session storage key for a given tab's context.
function getContextStorageKey(tabId: number): string {
  return `${SESSION_STORAGE_PREFIX}${tabId}`;
}

// Retrieves context items for a specific tab from session storage.
async function getContextItems(tabId: number): Promise<ContextItem[]> {
  const key = getContextStorageKey(tabId);
  try {
    const result = await chrome.storage.session.get(key);
    const items = result[key] as ContextItem[] || [];
    console.log(`[getContextItems] Retrieved ${items.length} items for tab ${tabId} under key ${key}:`, items);
    return items;
  } catch (error) {
    console.error(`[getContextItems] Error fetching context for tab ${tabId} using key ${key}:`, error);
    return [];
  }
}

// Adds a new context item for a specific tab to session storage, managing max size.
async function addContextItem(tabId: number, item: ContextItem): Promise<void> {
  const key = getContextStorageKey(tabId);
  console.log(`[addContextItem] Attempting to add item to tab ${tabId} under key ${key}:`, item);
  try {
    const currentItems = await getContextItems(tabId); // Reuse existing getter
    currentItems.push(item);

    // Prune oldest items if exceeding max count
    while (currentItems.length > MAX_CONTEXT_ITEMS) {
      currentItems.shift(); // Remove the oldest item (first in array)
    }

    await chrome.storage.session.set({ [key]: currentItems });
    console.log(`[addContextItem] Successfully added item and updated context for tab ${tabId}. New count: ${currentItems.length}`);

  } catch (error) {
    console.error(`[addContextItem] Error adding context for tab ${tabId} using key ${key}:`, error);
  }
}

// Clears context items for a specific tab when it's closed.
chrome.tabs.onRemoved.addListener((tabId) => {
  const key = getContextStorageKey(tabId);
  chrome.storage.session.remove(key, () => {
    console.log(`[tabs.onRemoved] Cleared context for closed tab ${tabId} (key: ${key})`);
  });
});


// --- Anthropic API Interaction ---
let systemPrompt: string | null = null; // Cache the system prompt

// Fetches the system prompt from the packaged extension file.
async function loadSystemPrompt(): Promise<string | null> {
    if (systemPrompt) {
        console.log("[loadSystemPrompt] Using cached system prompt.");
        return systemPrompt;
    }
    const promptUrl = chrome.runtime.getURL("INTERPRET.txt");
    console.log(`[loadSystemPrompt] Attempting to load prompt from: ${promptUrl}`);
      try {
          const promptResponse = await fetch(promptUrl);
          if (!promptResponse.ok) {
              throw new Error(`Failed to fetch prompt: ${promptResponse.status} ${promptResponse.statusText}`);
          }
          systemPrompt = await promptResponse.text();
        console.log("[loadSystemPrompt] Successfully loaded and cached system prompt.");
        return systemPrompt;
      } catch (promptError) {
        console.error("[loadSystemPrompt] Critical Error: Failed to load system prompt.", promptError);
        systemPrompt = null; 
        return null;
    }
}

/** Helper function to send failure message to content script */
async function sendInterpretationFailed(tabId: number, errorMessage: string) {
    console.error(`[sendInterpretationFailed] Notifying tab ${tabId} of failure: ${errorMessage}`);
    try {
        await chrome.tabs.sendMessage(tabId, {
            type: "INTERPRETATION_FAILED",
            error: errorMessage
        });
        console.log(`[sendInterpretationFailed] Sent INTERPRETATION_FAILED message to tab ${tabId}`);
    } catch (sendError) {
        console.error(`[sendInterpretationFailed] Failed to send INTERPRETATION_FAILED message to tab ${tabId}:`, sendError);
        // Check if the tab still exists, might have been closed.
        const tabExists = await chrome.tabs.get(tabId).catch(() => null);
        if (!tabExists) {
            console.warn(`[sendInterpretationFailed] Tab ${tabId} no longer exists, cannot send message.`);
        }
    }
}

/** Triggers the interpretation process for a given target and tab. */
async function triggerInterpretation(targetInfo: TargetInfo, tabId: number): Promise<void> {
  console.log(`[triggerInterpretation] Initiating interpretation for target in tab ${tabId}:`, targetInfo);
  const genericErrorMessage = "Interpretation failed, please try again!";

  try {
    // --- Initial Checks ---
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    console.log(`[triggerInterpretation] API Key found: ${!!apiKey}`);
    if (!apiKey) {
      console.error("[triggerInterpretation] Anthropic API Key not found. Aborting.");
      await sendInterpretationFailed(tabId, "API Key not configured."); // Send specific error
      return;
    }

    const currentSystemPrompt = await loadSystemPrompt();
    if (!currentSystemPrompt) {
      console.error("[triggerInterpretation] System prompt not available. Aborting.");
      await sendInterpretationFailed(tabId, "System prompt failed to load."); // Send specific error
      return;
    }

    // --- Notify Content Script (Processing) ---
    try {
        chrome.tabs.sendMessage(tabId, { type: "SHOW_PROCESSING_ICON" });
        console.log(`[triggerInterpretation] Sent SHOW_PROCESSING_ICON message to tab ${tabId}`);
    } catch (msgError) {
        console.warn(`[triggerInterpretation] Failed to send SHOW_PROCESSING_ICON message to tab ${tabId}:`, msgError);
        // Continue interpretation even if this fails
    }

    // --- Prepare Payload ---
    const contextItems = await getContextItems(tabId);
    console.log(`[triggerInterpretation] Using ${contextItems.length} context items for tab ${tabId}.`);

    // Construct the multimodal message payload
    const messagesPayload: any[] = [];
    const userContent: any[] = [];

    // Add image target if applicable
    if (targetInfo.type === 'image' && targetInfo.srcUrl) {
        userContent.push({
            type: "image",
            source: {
                type: "url",
                url: targetInfo.srcUrl
            }
        });
    }

    // Add text describing the target (selection, link, page)
    let targetDescription = "Target Content:\n";
    if (targetInfo.type === 'selection' && targetInfo.selectionText) {
        targetDescription += `Type: Selection\nText: "${targetInfo.selectionText}"\n`;
    } else if (targetInfo.type === 'link' && targetInfo.srcUrl) {
        targetDescription += `Type: Link\nURL: ${targetInfo.srcUrl}\n`;
    } else if (targetInfo.type === 'page' && targetInfo.pageUrl) {
        targetDescription += `Type: Page\nURL: ${targetInfo.pageUrl}\n`;
    } else if (targetInfo.type === 'image') { // Already handled image block above, just add text marker
         targetDescription += `Type: Image (see provided image block)\n`;
    }
    targetDescription += `From Page: ${targetInfo.pageTitle || 'Unknown Title'} (${targetInfo.pageUrl || 'Unknown URL'})\n`;
    userContent.push({ type: "text", text: targetDescription });

    // Add text describing the context items
    let contextDescription = "\n\nContext Items Provided:\n";
    if (contextItems.length > 0) {
        contextItems.forEach((item, index) => {
            contextDescription += `\nItem ${index + 1}:\n`;
            contextDescription += `  Type: ${item.type}\n`;
            if (item.selectionText) {
                contextDescription += `  Text: "${item.selectionText}"\n`;
            }
            if (item.srcUrl) {
                contextDescription += `  URL: ${item.srcUrl}\n`;
            }
            contextDescription += `  From Page: ${item.pageTitle || 'Unknown Title'} (${item.pageUrl || 'Unknown URL'})\n`;
            contextDescription += `  Timestamp: ${new Date(item.timestamp).toLocaleString()}\n`;
        });
    } else {
        contextDescription += "None provided.\n";
    }
    userContent.push({ type: "text", text: contextDescription });

    // Add the main instruction text block
    userContent.push({ type: "text", text: "\nPlease interpret the Target Content based on the Context Items provided above." });

    // Assemble the final message structure
    messagesPayload.push({ role: "user", content: userContent });

    console.log("[triggerInterpretation] Constructed Messages Payload for Anthropic:", JSON.stringify(messagesPayload, null, 2));

    // --- Call API and Process Response ---
    const anthropicClient = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });

    console.log("[triggerInterpretation] Sending request to Anthropic...");
    const response = await anthropicClient.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: currentSystemPrompt,
      messages: messagesPayload,
    });

    const rawResponseContent = response.content;
    console.log("[triggerInterpretation] Raw Response from Anthropic:", JSON.stringify(rawResponseContent, null, 2));

    if (!(rawResponseContent && rawResponseContent.length > 0 && rawResponseContent[0].type === 'text')) {
        console.error("[triggerInterpretation] Anthropic response content is missing or not text:", rawResponseContent);
        await sendInterpretationFailed(tabId, genericErrorMessage);
        return;
    }

    let responseText = rawResponseContent[0].text.trim();
    console.log("[triggerInterpretation] Extracted text content:", responseText);

    let interpretationData: InterpretationData | null = null;
    try {
      // Attempt to clean and parse the JSON response
      if (!(responseText.startsWith('{') && responseText.endsWith('}'))) {
         const jsonMatch = responseText.match(/\{[\s\S]*\}/);
         if (jsonMatch) {
           responseText = jsonMatch[0];
           console.log("[triggerInterpretation] Extracted potential JSON block:", responseText);
         } else {
           console.warn("[triggerInterpretation] No clear JSON block found in response text. Attempting direct parse.");
           // Throw error if no JSON block found, as parsing will likely fail
           throw new Error("Response does not contain a recognizable JSON block.");
         }
      }

      const parsedJson = JSON.parse(responseText);
      console.log("[triggerInterpretation] Attempting to parse JSON:", parsedJson);

      // Validate the structure
      if (
        typeof parsedJson.interpretation === 'string' &&
        typeof parsedJson.confidence === 'number' &&
        typeof parsedJson.tone === 'string' &&
        typeof parsedJson.contextSummary === 'string'
      ) {
        interpretationData = parsedJson as InterpretationData;
        console.log("[triggerInterpretation] Successfully parsed and validated interpretation data:", interpretationData);
      } else {
        console.error("[triggerInterpretation] Parsed JSON data structure is invalid:", parsedJson);
         throw new Error("Parsed JSON structure is invalid."); // Throw to be caught below
      }
    } catch (parseError) {
      console.error("[triggerInterpretation] Error parsing or validating JSON response from Anthropic:", parseError);
      console.error("[triggerInterpretation] Raw response text that failed parsing:", responseText);
      await sendInterpretationFailed(tabId, genericErrorMessage);
      return;
    }

    // --- Store Result and Notify Success ---
    if (interpretationData) { // Should always be true if we reach here due to checks above
      const dataToStore: StoredData = {
        interpretation: interpretationData,
        originalTarget: targetInfo
      };
      console.log("[triggerInterpretation] Preparing to store data in chrome.storage.local:", dataToStore);
      await chrome.storage.local.set({ lastInterpretation: dataToStore });
      console.log("[triggerInterpretation] Interpretation result stored successfully.");

      // Notify content script that data is ready
      try {
          await chrome.tabs.sendMessage(tabId, { type: "INTERPRETATION_READY" });
          console.log(`[triggerInterpretation] Sent INTERPRETATION_READY message to tab ${tabId}`);
      } catch (sendError) {
          console.error(`[triggerInterpretation] Failed to send INTERPRETATION_READY message to tab ${tabId}:`, sendError);
          // Error already logged, storage was successful, nothing more to do here.
      }
    }
     // We should not reach here if interpretationData is null due to earlier return statements.

  } catch (error) {
    // Catch errors from API call, context fetching, or other unexpected issues
    console.error("[triggerInterpretation] Overall error during interpretation process:", error);
    // Send the generic failure message
    await sendInterpretationFailed(tabId, genericErrorMessage);
  }
}


// --- Context Menu Setup and Handling ---

chrome.runtime.onInstalled.addListener(() => {
  console.log("[onInstalled] Setting up context menus...");

  // Remove existing menus to avoid duplicates during development/reloads
  chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
          console.warn("[onInstalled] Error removing existing context menus:", chrome.runtime.lastError.message);
        } else {
           console.log("[onInstalled] Existing context menus removed.");
      }

      // Create "Interpret" Menu
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID_INTERPRET,
        title: "Interpret Selection",
        contexts: ["selection", "image", "link", "page"], // All relevant contexts
      });
      console.log(`[onInstalled] Created '${CONTEXT_MENU_ID_INTERPRET}' menu.`);

      // Create "Add to Context" Menu
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID_ADD_CONTEXT,
        title: "Add to TIPS Context",
        contexts: ["selection", "image", "link"], // Can add page later if needed
      });
      console.log(`[onInstalled] Created '${CONTEXT_MENU_ID_ADD_CONTEXT}' menu.`);

      // Create "Clear Context" Menu
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID_CLEAR_CONTEXT,
        title: "Clear TIPS Context",
        contexts: ["page", "frame", "selection", "link", "image", "video", "audio"], // Apply everywhere
      });
      console.log(`[onInstalled] Created '${CONTEXT_MENU_ID_CLEAR_CONTEXT}' menu.`);
  });

   // Open Welcome Page on first install or update during development
   chrome.runtime.onInstalled.addListener(details => {
        if (details.reason === "install" || details.reason === "update") {
            const welcomeUrl = chrome.runtime.getURL("welcome.html"); 
            chrome.tabs.create({ url: welcomeUrl });
            console.log(`[onInstalled] Opened welcome page (${details.reason}): ${welcomeUrl}`);
        }
        if (details.reason === "update") {
             console.log(`[onInstalled] Extension updated to version ${chrome.runtime.getManifest().version}`);
             loadSystemPrompt(); 
        }
    });


});

// --- Context Menu Click Handler ---
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) {
    console.error("[contextMenus.onClicked] Received click event without valid tab information:", info);
    return;
  }
  const tabId = tab.id;
  console.log(`[contextMenus.onClicked] Menu item '${info.menuItemId}' clicked in tab ${tabId}. Info:`, info);

  const pageUrl = info.pageUrl || tab.url; // Use tab.url as fallback
  const pageTitle = tab.title;

  // --- Handle "Add to Context" ---
  if (info.menuItemId === CONTEXT_MENU_ID_ADD_CONTEXT) {
    let contextItem: ContextItem | null = null;
    const timestamp = Date.now();

    if (info.selectionText) {
      contextItem = { type: 'selection', selectionText: info.selectionText, pageUrl, pageTitle, timestamp };
    } else if (info.mediaType === "image" && info.srcUrl) {
      contextItem = { type: 'image', srcUrl: info.srcUrl, pageUrl, pageTitle, timestamp };
    } else if (info.linkUrl) {
      contextItem = { type: 'link', srcUrl: info.linkUrl, pageUrl, pageTitle, timestamp };
    }
     // Could add page context automatically here?
     // else if (info.pageUrl) { ... type: 'pageInfo' ... }

    if (contextItem) {
      console.log("[contextMenus.onClicked] Preparing to add context item:", contextItem);
      addContextItem(tabId, contextItem);
    } else {
      console.warn("[contextMenus.onClicked] 'Add to Context' clicked, but no relevant data found in info:", info);
    }
  }

  // --- Handle "Interpret" ---
  else if (info.menuItemId === CONTEXT_MENU_ID_INTERPRET) {
    let targetInfo: TargetInfo | null = null;

    if (info.selectionText) {
      targetInfo = { type: 'selection', selectionText: info.selectionText, pageUrl, pageTitle };
      console.log("[contextMenus.onClicked] 'Interpret' target identified as selection.");
    } else if (info.mediaType === "image" && info.srcUrl) {
      targetInfo = { type: 'image', srcUrl: info.srcUrl, pageUrl, pageTitle };
       console.log("[contextMenus.onClicked] 'Interpret' target identified as image.");
    } else if (info.linkUrl) {
      targetInfo = { type: 'link', srcUrl: info.linkUrl, pageUrl, pageTitle };
       console.log("[contextMenus.onClicked] 'Interpret' target identified as link.");
    } else if (info.pageUrl) {
      // This case handles clicking the context menu on the page itself
      targetInfo = { type: 'page', pageUrl: info.pageUrl, pageTitle };
      console.log("[contextMenus.onClicked] 'Interpret' target identified as page.");
    }

    if (targetInfo) {
      console.log("[contextMenus.onClicked] Triggering interpretation for target:", targetInfo);
      triggerInterpretation(targetInfo, tabId);
    } else {
      console.error("[contextMenus.onClicked] 'Interpret' clicked, but failed to identify target data from info:", info);
    }
  }

  // --- Handle "Clear Context" ---
  else if (info.menuItemId === CONTEXT_MENU_ID_CLEAR_CONTEXT) {
    const key = getContextStorageKey(tabId);
    chrome.storage.session.remove(key, () => {
      if (chrome.runtime.lastError) {
        console.error(`[contextMenus.onClicked] Error clearing context for tab ${tabId} (key: ${key}):`, chrome.runtime.lastError.message);
      } else {
        console.log(`[contextMenus.onClicked] Cleared context for tab ${tabId} (key: ${key})`);
        // Optional: Briefly notify user context was cleared
        chrome.action.setBadgeText({ tabId: tabId, text: 'CLR' });
        chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#FFA500' }); // Orange color
        setTimeout(() => {
            chrome.action.setBadgeText({ tabId: tabId, text: '' });
            chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#00000000' }); // Reset or use default
        }, 1500);
      }
    });
  }
});


// Pre-load system prompt on startup
loadSystemPrompt();

// --- Message Listener (Handles INTERPRET_TEXT from content script icon click) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[onMessage] Received message:", message, "From:", sender);

  if (message.type === "INTERPRET_TEXT") {
    console.log("[onMessage] Handling INTERPRET_TEXT.");
    const { text: selectedText, context } = message;

    if (!selectedText) {
        console.error("[onMessage] INTERPRET_TEXT received without selected text.");
        // We don't send a response back, but content script should handle this state.
        return false; 
    }

    if (!sender.tab || !sender.tab.id) {
        console.error("[onMessage] INTERPRET_TEXT received without valid sender tab ID.");
        return false;
    }
    const tabId = sender.tab.id;
    
    // Construct TargetInfo from the message payload
    // Ensure context and sender.tab potentially exist before accessing properties
    const pageUrl = context?.url || sender.tab?.url || "unknown_url";
    const pageTitle = context?.title || sender.tab?.title || "unknown_title";

    const targetInfo: TargetInfo = {
        type: 'selection',
        selectionText: selectedText,
        pageUrl: pageUrl,
        pageTitle: pageTitle 
    };
    console.log("[onMessage] Constructed TargetInfo for interpretation:", targetInfo);

    // Trigger the same interpretation logic used by the context menu
    triggerInterpretation(targetInfo, tabId);

    // Return false because we are not sending a response back to the content script.
    // triggerInterpretation handles the results asynchronously by storing them.
    return false; 
  }

  // Handle other potential message types in the future if needed
  console.log("[onMessage] Message type not handled:", message.type);
  return false; // Indicate synchronous handling for unhandled types
});


console.log("TIPS Background Script initialization complete.");