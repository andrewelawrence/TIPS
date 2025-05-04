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

console.log("[Background] Script Loaded (v0.6.3).");

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
const CAPTURE_SCROLL_DELAY_MS = 150;

// --- Firebase Logging Configuration & Function ---
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

// Logs an interaction event to Firebase if enabled.
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
    const logRef = ref(database, 'interactions');
    const newLogRef = push(logRef);
    await set(newLogRef, entry);
  } catch (error) {
    console.error('[logToFirebase] Error logging to Firebase:', error);
  }
}

// --- Context Management (using chrome.storage.session) ---
// Generates the session storage key for a given tab's context.
function getContextStorageKey(tabId: number): string {
  return `${SESSION_STORAGE_PREFIX}${tabId}`;
}

// Retrieves context items for a specific tab from session storage.
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

// Adds a context item for a specific tab, pruning old items if necessary.
async function addContextItem(
  tabId: number,
  item: ContextItem
): Promise<boolean> {
  const key = getContextStorageKey(tabId);
  try {
    let currentItems = await getContextItems(tabId);
    if (!Array.isArray(currentItems)) {
      currentItems = [];
    }
    currentItems.push(item);

    // Prune oldest items if exceeding max count
    while (currentItems.length > MAX_CONTEXT_ITEMS) {
      currentItems.shift();
    }

    await chrome.storage.session.set({ [key]: currentItems });

    // Log successful context addition
    logToFirebase({ eventType: 'addContext', tabId, contextItem: item });
    sendMessageToTab(tabId, { type: "CONTEXT_ADDED_NOTIFICATION", timestamp: Date.now() }).catch(() => {});
    return true;
  } catch (error) {
    console.error(
      `[addContextItem] Error adding context for tab ${tabId}:`,
      error
    );
    // Log failed context addition
    logToFirebase({ eventType: 'addContextFail', tabId, contextItem: item, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

// Removes tab-specific context when a tab is closed.
chrome.tabs.onRemoved.addListener((tabId) => {
  const key = getContextStorageKey(tabId);
  chrome.storage.session.remove(key);
});

// --- Anthropic API Interaction ---
let systemPrompt: string | null = null;

// Loads the system prompt text from the packaged file.
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

// Safely sends a message to a specific tab, handling potential errors.
async function sendMessageToTab(tabId: number, message: any): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (error) {
    // Check if the tab still exists before logging an error
    const tabExists = await chrome.tabs.get(tabId).catch(() => null);
    if (!tabExists) {
    } else {
      console.error(`[sendMessageToTab] Failed to send ${message.type} to tab ${tabId}:`, error);
    }
    return false;
  }
}

// Notifies the content script and popup that interpretation is ready.
async function notifyInterpretationReady(tabId: number, interpretationData: InterpretationData, triggerSource: 'iconClick' | 'contextMenu'): Promise<void> {
  const message: InterpretationReadyMessage = {
    type: "INTERPRETATION_READY",
    interpretation: interpretationData,
    triggerSource: triggerSource
  };
  await sendMessageToTab(tabId, message);

  chrome.runtime.sendMessage({ type: "INTERPRETATION_READY" }).catch(() => {});
}

// Notifies the content script that interpretation failed.
async function notifyInterpretationFailed(tabId: number, errorMessage: string): Promise<void> {
  console.error(`[notifyInterpretationFailed] Tab ${tabId}: ${errorMessage}`);
  const message: InterpretationFailedMessage = {
    type: "INTERPRETATION_FAILED",
    error: errorMessage,
  };
  await sendMessageToTab(tabId, message);
}


// --- Capture the page screenshot (stitching method) ---
/**
 * Captures a screenshot of the relevant portion of the page by stitching together 
 * multiple viewport captures, scrolling from the top down to the original scroll position.
 * @param tabId The ID of the tab to capture.
 * @returns A data URL of the stitched PNG image, or null if capture failed.
 */
async function getStitchedPageScreenshot(tabId: number): Promise<string | null> {
  let originalScroll: { x: number; y: number } | null = null;
  let capturedDataUrls: string[] = [];
  let viewHeight: number = 0;
  let totalHeight: number = 0;
  let viewWidth: number = 0;

  try {
    // Get initial scroll position and page dimensions
    const [pageInfoResult] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        return {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          viewHeight: window.innerHeight,
          totalHeight: document.body.scrollHeight,
          viewWidth: window.innerWidth,
        };
      },
    });

    if (!pageInfoResult?.result) {
      throw new Error("Failed to get page dimensions and scroll info.");
    }
    originalScroll = { x: pageInfoResult.result.scrollX, y: pageInfoResult.result.scrollY };
    viewHeight = pageInfoResult.result.viewHeight;
    totalHeight = pageInfoResult.result.totalHeight;
    viewWidth = pageInfoResult.result.viewWidth;

    if (viewHeight <= 0 || totalHeight <= 0 || viewWidth <= 0) {
      throw new Error(`Invalid page dimensions: vH=${viewHeight}, tH=${totalHeight}, vW=${viewWidth}`);
    }

    // Determine the maximum height to capture (up to original scroll position + one viewport)
    const captureUntilY = Math.min(originalScroll.y + viewHeight, totalHeight);
    let currentScrollY = 0;

    // Scroll to top
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => window.scrollTo(0, 0),
    });

    await new Promise(resolve => setTimeout(resolve, CAPTURE_SCROLL_DELAY_MS));

    // Iterative capture
    while (currentScrollY < captureUntilY) {
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !tab.windowId) {
          throw new Error(`Could not find tab or windowId for tabId: ${tabId}`);
      }
      const windowId = tab.windowId;

      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      if (!dataUrl) {
        console.warn(`[getStitchedScreenshot] captureVisibleTab returned null at scrollY ${currentScrollY}. Skipping.`);
        // Attempt to continue, might result in gaps
      } else {
          capturedDataUrls.push(dataUrl);
      }

      currentScrollY += viewHeight;

      // Scroll down for the next capture, but don't exceed total height
      const nextScroll = Math.min(currentScrollY, totalHeight - viewHeight); 
      if (nextScroll > (currentScrollY - viewHeight)) {
           await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (y) => window.scrollTo(0, y),
                args: [nextScroll]
           });
           await new Promise(resolve => setTimeout(resolve, CAPTURE_SCROLL_DELAY_MS)); // Wait
      } else {
          break;
      }

       // Safety break for very tall pages / potential loops - adjust limit as needed
       if (capturedDataUrls.length > 30) {
         console.warn("[getStitchedScreenshot] Exceeded maximum captures (30). Stopping capture.");
         logToFirebase({ eventType: 'screenshotFail', tabId, error: 'Stitch method: Exceeded 30 captures' });
         break;
       }
    }

    if (capturedDataUrls.length === 0) {
        throw new Error("No screenshots were captured.");
    }
    if (capturedDataUrls.length === 1) {
        return capturedDataUrls[0];
    }


    // Stitching the images 
    const canvas = new OffscreenCanvas(viewWidth, Math.min(captureUntilY, totalHeight));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get OffscreenCanvas context for stitching");

    let currentY = 0;
    for (let i = 0; i < capturedDataUrls.length; i++) {
      const dataUrl = capturedDataUrls[i];
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const imageBitmap = await createImageBitmap(blob);

        // Calculate draw height: normally viewport height, but could be less for the last segment
        const remainingCanvasHeight = canvas.height - currentY;
        const drawHeight = Math.min(imageBitmap.height, viewHeight, remainingCanvasHeight);

        if (drawHeight <= 0) continue;

        // Draw the segment
        ctx.drawImage(imageBitmap, 0, 0, imageBitmap.width, drawHeight, 0, currentY, viewWidth, drawHeight);

        currentY += drawHeight;
        imageBitmap.close();

        if (currentY >= canvas.height) break; 

      } catch (imgError) {
          console.error(`[getStitchedScreenshot] Error processing image segment ${i}:`, imgError);
      }
    }

    const stitchedBlob = await canvas.convertToBlob({ type: "image/png" });
    const stitchedDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(stitchedBlob);
    });

    return stitchedDataUrl;

  } catch (error) {
    console.error(`[getStitchedScreenshot] Error capturing stitched screenshot:`, error);
    logToFirebase({ eventType: 'screenshotFail', tabId, error: `Stitch method: ${error instanceof Error ? error.message : String(error)}` });
    return null; 
  } finally {
    // Restore original scroll position
    if (originalScroll) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (x, y) => window.scrollTo(x, y),
          args: [originalScroll.x, originalScroll.y],
        });
      } catch (restoreError) {
        console.warn(`[getStitchedScreenshot] Failed to restore scroll position:`, restoreError);
      }
    }
  }
}

// --- Image resizing function for Anthropic ---
/**
 * Resizes an image data URL if it exceeds the specified size limit.
 * Uses OffscreenCanvas for resizing.
 * @param dataUrl The original image data URL.
 * @param maxSizeBytes The maximum allowed size in bytes.
 * @returns A data URL of the resized image (or the original if already small enough or on error).
 */
async function resizeImageToFitSizeLimit(
  dataUrl: string,
  maxSizeBytes: number = MAX_IMAGE_SIZE_BYTES
): Promise<string> {
  try {
    // Parse data URL
    const base64Data = dataUrl.split(",")[1];
    const mimeType = dataUrl.split(",")[0].split(":")[1].split(";")[0];
    const estimatedSize = base64Data.length * 0.75; // Bytes
    
    
    // Skip processing if already under size limit
    if (estimatedSize <= maxSizeBytes) {
      return dataUrl;
    }
    
    // Create image from data URL
    const bytes = new Uint8Array(atob(base64Data).split("").map(c => c.charCodeAt(0)));
    const blob = new Blob([bytes], { type: mimeType });
    const imageBitmap = await createImageBitmap(blob);
    const origWidth = imageBitmap.width;
    const origHeight = imageBitmap.height;
    
    
    // Calculate scale based on target size (reduce dimensions to fit size limit)
    // Target a bit less than the limit to account for encoding overhead
    const sizeRatio = maxSizeBytes / estimatedSize * 0.7; // 30% buffer for PNG overhead
    const scale = Math.sqrt(sizeRatio); // Scale both dimensions equally
    
    // Calculate new dimensions - only downscale, never upscale
    const scaleFactor = Math.min(scale, 1.0);
    const newWidth = Math.max(1, Math.floor(origWidth * scaleFactor));
    const newHeight = Math.max(1, Math.floor(origHeight * scaleFactor));
        
    // Draw to canvas
    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get OffscreenCanvas context");
    
    ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
    const resizedBlob = await canvas.convertToBlob({ 
      type: "image/png" 
    });
    
    // Convert blob to data URL
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const resultSize = (result.split(",")[1].length * 0.75) / 1024 / 1024;
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
/**
 * Prepares the content payload for the Anthropic API call,
 * combining screenshot, target info, and manual context.
 * @param targetInfo Information about the user's target (selection, image, etc.).
 * @param contextItems Manually added context items.
 * @param screenshotDataUrl Resized screenshot data URL (or null).
 * @param captureErrorOccurred Whether an error occurred during screenshot capture.
 * @returns The content array for the Anthropic API messages.
 */
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
      text: "Context: The above image is a rendering of the page content down to where the user had scrolled.",
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

/**
 * Calls the Anthropic API with the prepared system prompt and user content.
 * @param apiKey The Anthropic API key.
 * @param systemPrompt The system prompt text.
 * @param userContent The prepared user content payload.
 * @returns The parsed API response message.
 */
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

  return response; 
}

/**
 * Parses the JSON data from the Anthropic API response text and validates its structure.
 * Attempts to extract JSON even if surrounded by other text.
 * @param responseText The raw text content from the API response.
 * @returns The validated InterpretationData object.
 * @throws Error if parsing or validation fails.
 */
function parseAndValidateApiResponse(responseText: string): InterpretationData {
  try {
    let jsonData = responseText.trim();
    // Attempt to find JSON block even if there's surrounding text
    if (!(jsonData.startsWith("{") && jsonData.endsWith("}"))) {
      const jsonMatch = jsonData.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonData = jsonMatch[0];
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

/**
 * Orchestrates the entire interpretation process:
 * loading config, capturing screenshot, fetching context, calling API, 
 * handling results, and notifying the content script.
 * @param targetInfo Information about the user's target.
 * @param tabId The ID of the relevant tab.
 * @param triggerSource Indicates whether initiated by icon click or context menu.
 */
async function triggerInterpretation(
  targetInfo: TargetInfo,
  tabId: number,
  triggerSource: 'iconClick' | 'contextMenu'
): Promise<void> {

  try {
    // Initial Checks
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API Key not configured.");
    }

    const currentSystemPrompt = await loadSystemPrompt();
    if (!currentSystemPrompt) {
      throw new Error("System prompt failed to load.");
    }

    // Capture Screenshot
    let screenshotDataUrl: string | null = null;
    let captureErrorOccurred = false;
    try {
      // Use the new stitching function
      const rawDataUrl = await getStitchedPageScreenshot(tabId);

      if (rawDataUrl) {
        screenshotDataUrl = await resizeImageToFitSizeLimit(rawDataUrl);
      } else {
        throw new Error("Screenshot capture returned no data");
      }
    } catch (captureError) {
      logToFirebase({ 
          eventType: 'screenshotFail', 
          tabId, 
          targetInfo, 
          error: captureError instanceof Error ? captureError.message : String(captureError) 
      });
      captureErrorOccurred = true;
    }

    // --- Fetch Manual Context ---
    const contextItems = await getContextItems(tabId);

    // --- Log interpretation start ---
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

      // Notify Success
      await notifyInterpretationReady(tabId, interpretationData, triggerSource);

      // Log successful interpretation
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
    console.error("[triggerInterpretation] Interpretation failed:", error);
    const errorMessage = error?.message || "An unknown error occurred during interpretation.";
    await notifyInterpretationFailed(tabId, errorMessage);
    logToFirebase({
        eventType: 'interpretFail',
        tabId,
        targetInfo: targetInfo,
        contextItemsCount: (await getContextItems(tabId))?.length ?? 0,
        error: error?.message || "An unknown interpretation error occurred.",
        trigger: triggerSource
    });
  }
}

// --- Context Menu Setup and Handling ---
// Sets up the extension's context menus.
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn(
        "[setupContextMenus] Error removing existing menus (may be expected on reload):",
        chrome.runtime.lastError.message
      );
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

  // Use tab info if pageUrl isn't directly available in `info` (e.g., for 'page' context if added)
  const pageUrl = info.pageUrl || tab.url || "Unknown URL";
  const pageTitle = tab.title || "Unknown Title";

  // Handle "Add to Context"
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
    }
  }

  // Handle "Interpret"
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

      // Send loading message
      const loadingMessage: InterpretationNowLoadingMessage = { type: "INTERPRETATION_NOW_LOADING" };
      await sendMessageToTab(tabId, loadingMessage);

      triggerInterpretation(targetInfo, tabId, 'contextMenu');
    } else {
      console.error(
        "[contextMenus.onClicked] 'Interpret' clicked, but failed to identify target data from info:",
        info
      );
    }
  }

  // Handle "Clear Context"
  else if (info.menuItemId === CONTEXT_MENU_ID_CLEAR_CONTEXT) {
    const key = getContextStorageKey(tabId);
    chrome.storage.session.remove(key, () => {
      if (chrome.runtime.lastError) {
        console.error(
          `[contextMenus.onClicked] Error clearing context for tab ${tabId} (key: ${key}):`,
          chrome.runtime.lastError.message
        );
      } else {
        logToFirebase({ eventType: 'clearContext', tabId });
        sendMessageToTab(tabId, { type: "CONTEXT_CLEARED_NOTIFICATION", timestamp: Date.now() }).catch(() => {});
      }
    });
  }
});

// Message Listener (Handles INTERPRET_TARGET from content script icon click)
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
         notifyInterpretationFailed(tabId, "Invalid target data received.");
    }

    // Important: Return false to indicate we won't use sendResponse later
    sendResponse({ status: "Processing started" }); // Keep original ack response
    return false;
  }

  // Default for unhandled types
  if (message.type !== "INTERPRET_TARGET") {
    console.log("[onMessage] Message type not handled:", message.type);
  }
  return false; // Indicate synchronous handling for unhandled types
});

console.log("[Background] Script initialization complete (v0.6.3).");
