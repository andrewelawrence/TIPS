import "@anthropic-ai/sdk/shims/web";
import { Anthropic } from "@anthropic-ai/sdk";
import type {
  TargetInfo,
  ContextItem,
  InterpretationData,
  StoredData,
  LogEntry,
  InterpretationReadyMessage,
  InterpretationFailedMessage,
  InterpretationNowLoadingMessage
} from "./types";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, push, set } from "firebase/database";

console.log("[Background] Script Loaded (v0.6.1).");

// --- Constants ---
const ANTHROPIC_MODEL = "claude-3-7-sonnet-20250219";
    // Options: claude-3-7-sonnet-20250219, 
    //          claude-3-5-sonnet-20241022, 
    //          claude-3-5-haiku-20241022.
const MAX_CONTEXT_ITEMS = 10;
const CONTEXT_MENU_ID_INTERPRET = "TIPS_INTERPRET";
const CONTEXT_MENU_ID_ADD_CONTEXT = "TIPS_ADD_CONTEXT";
const CONTEXT_MENU_ID_CLEAR_CONTEXT = "TIPS_CLEAR_CONTEXT";
const SESSION_STORAGE_PREFIX = "TIPS_SID_";
const MAX_IMAGE_SIZE_BYTES = 3.5 * 1024 * 1024;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

// --- Firebase Logging Configuration & Function (NEW) ---
let ENABLE_LOGGING = import.meta.env.VITE_ENABLE_LOGGING === 'true';
const FIREBASE_DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let firebaseApp: any = null;
let database: any = null;

if (ENABLE_LOGGING && FIREBASE_DATABASE_URL) {
  try {
    const firebaseConfig = {
      databaseURL: FIREBASE_DATABASE_URL,
    };
    firebaseApp = initializeApp(firebaseConfig);
    database = getDatabase(firebaseApp);
    console.log("[Background] Firebase logging initialized.");
  } catch (error) {
    console.error("[Background] Firebase initialization failed:", error);
    // Disable logging if init fails
    ENABLE_LOGGING = false; 
  }
} else {
  console.log("[Background] Firebase logging disabled or configuration missing.");
}

async function logToFirebase(logData: Omit<LogEntry, 'timestamp' | 'extensionVersion'>): Promise<void> {
  if (!ENABLE_LOGGING || !database) {
    return; // Logging disabled or Firebase not initialized
  }

  const entry: LogEntry = {
    ...logData,
    timestamp: new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
  };

  try {
    const logRef = ref(database, 'interactions'); // Log to an 'interactions' node
    const newLogRef = push(logRef); // Generate a unique ID
    await set(newLogRef, entry);
    // console.log(`[logToFirebase] Event logged: ${entry.eventType}`);
  } catch (error) {
    console.error('[logToFirebase] Error logging to Firebase:', error);
  }
}

// --- Context Management (using chrome.storage.session) ---
function getContextStorageKey(tabId: number): string {
  return `${SESSION_STORAGE_PREFIX}${tabId}`;
}

async function getContextItems(tabId: number): Promise<ContextItem[]> {
  const key = getContextStorageKey(tabId);
  try {
    const result = await chrome.storage.session.get(key);
    return (result[key] as ContextItem[]) || [];
  } catch (error) {
    console.error(
      `[getContextItems] Error fetching context for tab ${tabId}:`,
      error
    );
    return [];
  }
}

async function addContextItem(
  tabId: number,
  item: ContextItem
): Promise<boolean> {
  const key = getContextStorageKey(tabId);
//   console.log(
//     `[addContextItem] Adding item to tab ${tabId}. Type: ${item.type}`
//   );
  try {
    let currentItems = await getContextItems(tabId);
    if (!Array.isArray(currentItems)) {
    //   console.warn(
    //     `[addContextItem] Existing data for key ${key} is not an array, resetting.`
    //   );
      currentItems = [];
    }
    currentItems.push(item);

    // Prune oldest items if exceeding max count
    while (currentItems.length > MAX_CONTEXT_ITEMS) {
      currentItems.shift();
    }

    await chrome.storage.session.set({ [key]: currentItems });
    // console.log(
    //   `[addContextItem] Context updated for tab ${tabId}. New count: ${currentItems.length}`
    // );
    // --- Log successful context addition (NEW) ---
    logToFirebase({ eventType: 'addContext', tabId, contextItem: item });
    return true;
  } catch (error) {
    console.error(
      `[addContextItem] Error adding context for tab ${tabId}:`,
      error
    );
    // --- Log failed context addition (NEW) ---
    logToFirebase({ eventType: 'addContextFail', tabId, contextItem: item, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = getContextStorageKey(tabId);
  chrome.storage.session.remove(key);
  // --- Clean up scroll position on tab removal --- REMOVED
  // if (scrollPositions[tabId]) {
  //   delete scrollPositions[tabId];
  //   // console.log(`[Background] Cleaned up saved scroll for closed tab ${tabId}`);
  // }
  // ---
});

// --- Anthropic API Interaction ---
let systemPrompt: string | null = null;

async function loadSystemPrompt(): Promise<string | null> {
  if (systemPrompt) {
    return systemPrompt;
  }
  const promptUrl = chrome.runtime.getURL("INTERPRET.txt");
  try {
    const promptResponse = await fetch(promptUrl);
    if (!promptResponse.ok) {
      throw new Error(
        `Failed to fetch prompt: ${promptResponse.status} ${promptResponse.statusText}`
      );
    }
    systemPrompt = await promptResponse.text();
    // console.log("[loadSystemPrompt] System prompt loaded and cached.");
    return systemPrompt;
  } catch (promptError) {
    console.error(
      "[loadSystemPrompt] CRITICAL: Failed to load system prompt:",
      promptError
    );
    systemPrompt = null;
    return null;
  }
}

// --- Messaging Helpers ---

/** Safely sends a message to a specific tab, handling potential errors. */
async function sendMessageToTab(tabId: number, message: any): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    // console.log(`[sendMessageToTab] Successfully sent ${message.type} to tab ${tabId}`);
    return true;
  } catch (error) {
    // Check if the tab still exists before logging an error
    const tabExists = await chrome.tabs.get(tabId).catch(() => null);
    if (!tabExists) {
      // console.warn(`[sendMessageToTab] Tab ${tabId} closed before message could be sent.`);
    } else {
      console.error(`[sendMessageToTab] Failed to send ${message.type} to tab ${tabId}:`, error);
    }
    return false;
  }
}

/** Notifies the content script and popup that interpretation is ready. */
async function notifyInterpretationReady(tabId: number, interpretationData: InterpretationData): Promise<void> {
  const message: InterpretationReadyMessage = {
    type: "INTERPRETATION_READY",
    interpretation: interpretationData,
  };
  await sendMessageToTab(tabId, message);
  // Also notify popup if open
  chrome.runtime.sendMessage({ type: "INTERPRETATION_READY" }).catch(() => {});
}

/** Notifies the content script that interpretation failed. */
async function notifyInterpretationFailed(tabId: number, errorMessage: string): Promise<void> {
  console.error(`[notifyInterpretationFailed] Tab ${tabId}: ${errorMessage}`);
  const message: InterpretationFailedMessage = {
    type: "INTERPRETATION_FAILED",
    error: errorMessage,
  };
  await sendMessageToTab(tabId, message);
}

// --- End Messaging Helpers ---

// Using chrome.tabs.captureVisibleTab with scrolling to capture the full page
async function getFullPageScreenshot(tabId: number): Promise<string | null> {
  try {
    // console.log(`[getFullPageScreenshot] Capturing full page for tab ${tabId}`);
    
    // Need to get tab info to get window ID
    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;
    
    // --- Restore original scroll handling within this function ---
    // First, save current scroll position so we can restore it later
    const [scrollResult] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        return { 
          scrollX: window.scrollX, 
          scrollY: window.scrollY,
        };
      }
    });
    const originalScroll = scrollResult?.result;

    // Scroll to top for capture (potentially needed?)
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => { window.scrollTo(0, 0); }
    });
    await new Promise(resolve => setTimeout(resolve, 100)); // Short delay for scroll
    // ---
    
    // Capture the visible part of the page
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png"
    });
    
    // --- Restore original scroll handling within this function ---
    // Reset scroll position
    if (originalScroll) {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (originalScrollX, originalScrollY) => {
            window.scrollTo(originalScrollX, originalScrollY);
          },
          args: [originalScroll.scrollX, originalScroll.scrollY]
        });
    }
    // ---

    // console.log(`[getFullPageScreenshot] Screenshot captured successfully`);
    return dataUrl;
  } catch (error) {
    console.error(`[getFullPageScreenshot] Error capturing screenshot:`, error);
    // --- Log screenshot failure (NEW) ---
    logToFirebase({ eventType: 'screenshotFail', tabId, error: error instanceof Error ? error.message : String(error) });
    // ---
    return null;
  }
}

// Optimized image resizing function - maintain PNG format for Anthropic
async function resizeImageToFitSizeLimit(
  dataUrl: string,
  maxSizeBytes: number = MAX_IMAGE_SIZE_BYTES
): Promise<string> {
  try {
    // Parse data URL
    const base64Data = dataUrl.split(",")[1];
    const mimeType = dataUrl.split(",")[0].split(":")[1].split(";")[0];
    const estimatedSize = base64Data.length * 0.75; // Bytes
    
    // console.log(`[resizeImage] Original image size: ~${(estimatedSize/1024/1024).toFixed(2)}MB`);
    
    // Skip processing if already under size limit
    if (estimatedSize <= maxSizeBytes) {
    //   console.log(`[resizeImage] Image already under size limit, no resize needed`);
      return dataUrl;
    }
    
    // Create image from data URL
    const bytes = new Uint8Array(atob(base64Data).split("").map(c => c.charCodeAt(0)));
    const blob = new Blob([bytes], { type: mimeType });
    const imageBitmap = await createImageBitmap(blob);
    const origWidth = imageBitmap.width;
    const origHeight = imageBitmap.height;
    
    // console.log(`[resizeImage] Original dimensions: ${origWidth}x${origHeight}`);
    
    // Calculate scale based on target size (reduce dimensions to fit size limit)
    // Target a bit less than the limit to account for encoding overhead
    const sizeRatio = maxSizeBytes / estimatedSize * 0.7; // 30% buffer for PNG overhead
    const scale = Math.sqrt(sizeRatio); // Scale both dimensions equally
    
    // Calculate new dimensions - only downscale, never upscale
    const scaleFactor = Math.min(scale, 1.0);
    const newWidth = Math.max(1, Math.floor(origWidth * scaleFactor));
    const newHeight = Math.max(1, Math.floor(origHeight * scaleFactor));
    
    // console.log(`[resizeImage] Resizing to ${newWidth}x${newHeight} (scale: ${scaleFactor.toFixed(3)})`);
    
    // Draw to canvas
    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get OffscreenCanvas context");
    
    ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
    const resizedBlob = await canvas.convertToBlob({ 
      type: "image/png"  // Maintain PNG format for Anthropic
    });
    
    // Convert blob to data URL
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const resultSize = (result.split(",")[1].length * 0.75) / 1024 / 1024;
        // console.log(`[resizeImage] Final image size: ~${resultSize.toFixed(2)}MB`);
        resolve(result);
      };
      reader.readAsDataURL(resizedBlob);
    });
  } catch (error) {
    console.error("[resizeImage] Error resizing image:", error);
    return dataUrl; // Return original on error
  }
}

// --- API Interaction Helpers ---

/** Prepares the content payload for the Anthropic API call. */
function prepareApiPayload(
  targetInfo: TargetInfo,
  contextItems: ContextItem[],
  screenshotDataUrl: string | null,
  captureErrorOccurred: boolean
): Anthropic.Messages.MessageParam["content"] {
  const userContent: Anthropic.Messages.MessageParam["content"] = [];

  // 1. Add Screenshot Image Block
  if (screenshotDataUrl) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: screenshotDataUrl.split(",")[1],
      },
    });
    userContent.push({
      type: "text",
      text: "Context: The above screenshot shows the page where the target content was found.",
    });
  } else if (captureErrorOccurred) {
    userContent.push({
      type: "text",
      text: "Context: Screenshot capture failed. Relying on text context only.",
    });
  }

  // 2. Add Target Content Description
  let targetDescription = "\n\nTarget Content:\n";
  switch (targetInfo.type) {
    case "image":
      targetDescription += `Type: Image\nURL: ${
        targetInfo.srcUrl || "Unknown URL"
      }\n`;
      break;
    case "selection":
      targetDescription += `Type: Selection\nText: \"${
        targetInfo.selectionText || ""
      }\"\n`;
      break;
    case "link":
      targetDescription += `Type: Link\nURL: ${
        targetInfo.srcUrl || "Unknown URL"
      }\n`;
      break;
    case "page":
      targetDescription += `Type: Page\nURL: ${
        targetInfo.pageUrl || "Unknown URL"
      }\n`;
      break;
  }
  targetDescription += `Source Page: ${
    targetInfo.pageTitle || "Unknown Title"
  } (${targetInfo.pageUrl || "Unknown URL"})`;
  userContent.push({ type: "text", text: targetDescription });

  // 3. Add Manual Context Items Description
  if (contextItems.length > 0) {
    let manualContextDescription =
      "\n\nManually Added Context Items (Most recent first):\n";
    for (let i = contextItems.length - 1; i >= 0; i--) {
      const item = contextItems[i];
      manualContextDescription += `\nItem ${contextItems.length - i}:\n`;
      manualContextDescription += `  Type: ${item.type}\n`;
      if (item.selectionText) {
        manualContextDescription += `  Text: \"${item.selectionText}\"\n`;
      }
      if (item.srcUrl) {
        manualContextDescription += `  URL: ${item.srcUrl}\n`;
      }
      manualContextDescription += `  Added From: ${
        item.pageTitle || "Unknown Title"
      } (${item.pageUrl || "Unknown URL"})\n`;
    }
    userContent.push({ type: "text", text: manualContextDescription });
  }

  // 4. Add the main instruction text block
  userContent.push({
    type: "text",
    text: "\nPlease interpret the Target Content based on the screenshot (if available) and the Manually Added Context Items provided above (if any).",
  });

  return userContent;
}

/** Calls the Anthropic API with the prepared payload. */
async function callAnthropicApi(
  apiKey: string,
  systemPrompt: string,
  userContent: Anthropic.Messages.MessageParam["content"]
): Promise<Anthropic.Messages.Message> {
  const anthropicClient = new Anthropic({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
  });

  const messagesPayload: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userContent },
  ];

  console.log(
    "[callAnthropicApi] Sending request to Anthropic model:",
    ANTHROPIC_MODEL
  );

  const response = await anthropicClient.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: messagesPayload,
  });

  if (!response.content || response.content.length === 0 || response.content[0].type !== "text") {
    console.error(
      "[callAnthropicApi] Anthropic response content is missing or not text:",
      response.content
    );
    throw new Error("Invalid response format received from API.");
  }

  // Log token usage
  if (response.usage) {
    // console.log(
    //   `[callAnthropicApi] Anthropic Usage: Input ${response.usage.input_tokens}, Output ${response.usage.output_tokens} tokens.`
    // );
  }

  return response; 
}

/** Parses and validates the JSON data from the Anthropic API response. */
function parseAndValidateApiResponse(responseText: string): InterpretationData {
  try {
    let jsonData = responseText.trim();
    // Attempt to find JSON block even if there's surrounding text
    if (!(jsonData.startsWith("{") && jsonData.endsWith("}"))) {
      const jsonMatch = jsonData.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonData = jsonMatch[0];
        // console.log(
        //   "[parseAndValidateApiResponse] Extracted JSON block from response."
        // );
      } else {
        throw new Error(
          "Response does not contain a recognizable JSON block."
        );
      }
    }
    const parsedJson = JSON.parse(jsonData);

    // Validate required fields
    if (
      typeof parsedJson.interpretation === "string" &&
      typeof parsedJson.confidence === "number" &&
      typeof parsedJson.tone === "string" &&
      typeof parsedJson.contextSummary === "string"
    ) {
      // console.log(
      //   "[parseAndValidateApiResponse] Successfully parsed and validated interpretation data."
      // );
      return parsedJson as InterpretationData;
    } else {
      throw new Error(
        "Parsed JSON structure is invalid or missing required fields."
      );
    }
  } catch (parseError) {
    console.error(
      "[parseAndValidateApiResponse] Error parsing or validating JSON response:",
      parseError
    );
    console.error(
      "[parseAndValidateApiResponse] Raw response text that failed validation:",
      responseText
    );
    // Re-throw a more specific error for the caller
    throw new Error(
      "Failed to parse or validate interpretation from API response."
    );
  }
}

// --- End API Interaction Helpers ---

/** Triggers the interpretation process for a given target and tab. */
async function triggerInterpretation(
  targetInfo: TargetInfo,
  tabId: number,
  triggerSource: 'iconClick' | 'contextMenu'
): Promise<void> {
  // console.log(
  //   `[triggerInterpretation] Received request for tab ${tabId}. Target type: ${targetInfo.type}, Trigger: ${triggerSource}`
  // );

  // --- Save scroll position if provided --- REMOVED
  // if (targetInfo.scrollX !== undefined && targetInfo.scrollY !== undefined) {
  //   scrollPositions[tabId] = { scrollX: targetInfo.scrollX, scrollY: targetInfo.scrollY };
  //   // console.log(`[Background] Saved scroll for tab ${tabId}:`, scrollPositions[tabId]);
  // } else if (scrollPositions[tabId]) {
  //     // Clean up any stale scroll position if the new target doesn't have one
  //     delete scrollPositions[tabId];
  // }
  // ---

  try {
    // --- Initial Checks ---
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API Key not configured.");
    }

    const currentSystemPrompt = await loadSystemPrompt();
    if (!currentSystemPrompt) {
      throw new Error("System prompt failed to load.");
    }

    // --- Capture Screenshot ---
    // console.log(`[triggerInterpretation] Capturing screenshot for tab ${tabId}...`);
    let screenshotDataUrl: string | null = null;
    let captureErrorOccurred = false;
    try {
      // Request screenshot from debugger API
      const rawDataUrl = await getFullPageScreenshot(tabId);

      if (rawDataUrl) {
        // Further processing to ensure API compatibility
        // console.log(`[triggerInterpretation] Processing screenshot for API transmission...`);
        screenshotDataUrl = await resizeImageToFitSizeLimit(rawDataUrl);
      } else {
        throw new Error("Screenshot capture returned no data");
      }
    } catch (captureError) {
    //   console.warn(
    //     `[triggerInterpretation] Failed to capture screenshot:`,
    //     captureError
    //   );
      // --- Log screenshot failure (NEW) ---
      logToFirebase({ 
          eventType: 'screenshotFail', 
          tabId, 
          targetInfo, 
          error: captureError instanceof Error ? captureError.message : String(captureError) 
      });
      captureErrorOccurred = true; // Mark error, but continue
    }

    // --- Fetch Manual Context ---
    const contextItems = await getContextItems(tabId);

    // --- Log interpretation start (NEW) ---
    logToFirebase({ 
        eventType: 'interpretStart', 
        tabId, 
        targetInfo, 
        contextItemsCount: contextItems.length,
        trigger: triggerSource
    });

    // --- Prepare Payload using Helper ---
    const userContent = prepareApiPayload(targetInfo, contextItems, screenshotDataUrl, captureErrorOccurred);

    // --- Call API and Process Response using Helpers ---
    const response = await callAnthropicApi(apiKey, currentSystemPrompt, userContent);
    
    // Ensure the response block is of type TextBlock before parsing
    if (response.content[0].type !== 'text') {
        throw new Error("API response content was not text as expected.");
    }
    const interpretationData = parseAndValidateApiResponse(response.content[0].text);
    const apiUsage = response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : null;

    // --- Store Result and Notify Success ---
    if (interpretationData) {
      const dataToStore: StoredData = {
        interpretation: interpretationData,
        originalTarget: targetInfo,
      };
      await chrome.storage.local.set({ lastInterpretation: dataToStore });
    //   console.log(
    //     "[triggerInterpretation] Interpretation result stored successfully."
    //   );

      // --- Use new helper function for notification ---
      await notifyInterpretationReady(tabId, interpretationData);
      // --- End Use new helper ---

      // --- Log successful interpretation (NEW) ---
      logToFirebase({
          eventType: 'interpretSuccess',
          tabId,
          targetInfo,
          contextItemsCount: contextItems.length,
          interpretationData,
          apiUsage,
          trigger: triggerSource
      });
    }
  } catch (error: any) {
    console.error(
      `[triggerInterpretation] Interpretation failed for tab ${tabId}:`,
      error
    );
    // --- Use new helper function for failure notification ---
    await notifyInterpretationFailed(
      tabId,
      error?.message || "An unknown interpretation error occurred."
    );
    // ---
    // --- Log failed interpretation (NEW) ---
    logToFirebase({
        eventType: 'interpretFail',
        tabId,
        targetInfo: targetInfo,
        contextItemsCount: (await getContextItems(tabId))?.length ?? 0,
        error: error?.message || "An unknown interpretation error occurred.",
        trigger: triggerSource
    });
  } finally {
    // console.log(
    //   `[triggerInterpretation] Finished processing for tab ${tabId}.`
    // );
  }
}

// --- Context Menu Setup and Handling ---
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
    //   console.warn(
    //     "[setupContextMenus] Error removing existing menus (may be expected on reload):",
    //     chrome.runtime.lastError.message
    //   );
    }

    // Create interpretation menu item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID_INTERPRET,
      title: "Interpret",
      contexts: ["selection", "image"],
    });

    // Create context addition menu item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID_ADD_CONTEXT,
      title: "Add to Context",
      contexts: ["selection", "image", "link"],
    });

    // Create context clearing menu item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID_CLEAR_CONTEXT,
      title: "Clear Tab Context",
      contexts: ["all"],
    });

    // console.log("[setupContextMenus] Context menus created.");
  });
}

// --- Extension Lifecycle Listeners ---
chrome.runtime.onInstalled.addListener((details) => {
  console.log(
    `[onInstalled] Event: ${details.reason}. Version: ${
      chrome.runtime.getManifest().version
    }`
  );

  // Always setup menus on install/update
  setupContextMenus();
  // Always try to load/reload prompt on install/update
  loadSystemPrompt();

  // Handle welcome page only on initial install
  if (details.reason === "install") {
    const welcomeUrl = chrome.runtime.getURL("welcome.html");
    chrome.tabs.create({ url: welcomeUrl }).catch((err) => {
      console.error(
        `[onInstalled] Error opening welcome page (${welcomeUrl}):`,
        err
      );
    });
  }
});

// Pre-load system prompt on browser startup (in addition to install/update)
loadSystemPrompt();

// --- Context Menu Click Handler ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || typeof tab.id !== "number") {
    console.error("[contextMenus.onClicked] Invalid tab context:", tab);
    return;
  }
  const tabId = tab.id;
//   console.log(
//     `[contextMenus.onClicked] Item '${info.menuItemId}' clicked in tab ${tabId}.`
//   );

  // Use tab info if pageUrl isn't directly available in `info` (e.g., for 'page' context if added)
  const pageUrl = info.pageUrl || tab.url || "Unknown URL";
  const pageTitle = tab.title || "Unknown Title";

  // --- Handle "Add to Context" ---
  if (info.menuItemId === CONTEXT_MENU_ID_ADD_CONTEXT) {
    let contextItem: ContextItem | null = null;
    const timestamp = Date.now();

    if (info.selectionText) {
      contextItem = {
        type: "selection",
        selectionText: info.selectionText,
        pageUrl,
        pageTitle,
        timestamp,
      };
    } else if (info.mediaType === "image" && info.srcUrl) {
      contextItem = {
        type: "image",
        srcUrl: info.srcUrl,
        pageUrl,
        pageTitle,
        timestamp,
      };
    } else if (info.linkUrl) {
      contextItem = {
        type: "link",
        srcUrl: info.linkUrl,
        pageUrl,
        pageTitle,
        timestamp,
      };
    }

    if (contextItem) {
      const success = await addContextItem(tabId, contextItem);
      if (success) {
        // showActionBadge(tabId, "✨");
      }
    } else {
      // console.warn(
      //   "[contextMenus.onClicked] 'Add to Context' clicked, but no relevant data found in info:",
      //   info
      // );
    }
  }

  // --- Handle "Interpret" ---
  else if (info.menuItemId === CONTEXT_MENU_ID_INTERPRET) {
    let targetInfo: TargetInfo | null = null;

    if (info.selectionText) {
      targetInfo = {
        type: "selection",
        selectionText: info.selectionText,
        pageUrl,
        pageTitle,
      };
    } else if (info.mediaType === "image" && info.srcUrl) {
      targetInfo = { type: "image", srcUrl: info.srcUrl, pageUrl, pageTitle };
    }
    // Note: 'page' or 'link' interpretation isn't directly supported by this menu item's contexts

    if (targetInfo) {
      // Send a message to create the icon immediately
      chrome.tabs
        .sendMessage(tabId, { 
          type: "CONTEXT_MENU_INTERPRET_STARTED",
          timestamp: Date.now()
        })
        .catch((err) =>
          console.warn(
            "[contextMenus.onClicked] Failed to notify content script (initial):",
            err
          )
        );

        // --- Use new helper function for loading message ---
        const loadingMessage: InterpretationNowLoadingMessage = { type: "INTERPRETATION_NOW_LOADING" };
        await sendMessageToTab(tabId, loadingMessage);
        // ---

      triggerInterpretation(targetInfo, tabId, 'contextMenu');
    } else {
      // console.error(
      //   "[contextMenus.onClicked] 'Interpret' clicked, but failed to identify target data from info:",
      //   info
      // );
    }
  }

  // --- Handle "Clear Context" ---
  else if (info.menuItemId === CONTEXT_MENU_ID_CLEAR_CONTEXT) {
    const key = getContextStorageKey(tabId);
    chrome.storage.session.remove(key, () => {
      if (chrome.runtime.lastError) {
        console.error(
          `[contextMenus.onClicked] Error clearing context for tab ${tabId} (key: ${key}):`,
          chrome.runtime.lastError.message
        );
      } else {
        // console.log(
        //   `[contextMenus.onClicked] Cleared context for tab ${tabId}.`
        // );
        // showActionBadge(tabId, "🗑️");
        // --- Log context clear (NEW) ---
        logToFirebase({ eventType: 'clearContext', tabId });
      }
    });
  }
});

// --- Message Listener (Handles INTERPRET_TARGET from content script icon click) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "INTERPRET_TARGET") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ error: "Invalid tab context" });
      return false; // Not using async response
    }
    
    // Send loading message confirmation (no targetId needed)
    const loadingMessage: InterpretationNowLoadingMessage = { type: "INTERPRETATION_NOW_LOADING" };
    sendMessageToTab(tabId, loadingMessage)
        .catch(err => console.warn("[onMessage INTERPRET_TARGET] Failed to send loading confirmation:", err));

    // Start interpretation asynchronously
    // Ensure message.target exists and is of type TargetInfo before passing
    if (message.target && typeof message.target === 'object') {
        triggerInterpretation(message.target as TargetInfo, tabId, 'iconClick').catch((error) => {
            console.error("Error during interpretation triggered by icon click:", error);
        });
    } else {
         console.error("[onMessage INTERPRET_TARGET] Invalid or missing target data in message.");
         // Send failure back immediately if target data is bad
         // --- Use new helper function for failure notification ---
         notifyInterpretationFailed(tabId, "Invalid target data received.");
         // ---
    }

    // Important: Return false to indicate we won't use sendResponse later
    sendResponse({ status: "Processing started" }); // Keep original ack response
    return false;
  }

  // Handle context menu interpretation request (EXISTING)
  if (message.type === "CONTEXT_MENU_INTERPRET_STARTED") {
      // This path might be redundant if context menu now sends INTERPRETATION_NOW_LOADING
      // Keeping for now in case it's used elsewhere or needed for UI setup
      console.log("[onMessage] Received CONTEXT_MENU_INTERPRET_STARTED (may be legacy)");
      // Let content script handle UI based on INTERPRETATION_NOW_LOADING / INTERPRETATION_READY / FAILED
      return false;
  }

  // Handle interpretation results (EXISTING)
  if (message.type === "INTERPRETATION_READY") {
      // Background script doesn't typically receive this back, sent TO content script
      console.warn("[onMessage] Received INTERPRETATION_READY unexpectedly.");
      return false;
  }

  // Handle interpretation failures (EXISTING)
  if (message.type === "INTERPRETATION_FAILED") {
       // Background script doesn't typically receive this back, sent TO content script
       console.warn("[onMessage] Received INTERPRETATION_FAILED unexpectedly.");
      return false;
  }

  // Default for unhandled types
  console.log("[onMessage] Message type not handled:", message.type);
  return false; // Indicate synchronous handling for unhandled types
});

console.log("[Background] Script initialization complete (v0.6.1).");
