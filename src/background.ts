import "@anthropic-ai/sdk/shims/web";
import { Anthropic } from "@anthropic-ai/sdk";
import type {
  TargetInfo,
  ContextItem,
  InterpretationData,
  StoredData,
} from "./types";

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
const NOTIFICATION_TIMEOUT = 2000;

// --- Badge Text Helpers ---
// Wraps setBadgeText to safely ignore errors related to invalid tab IDs
function safeSetBadgeText(details: chrome.action.BadgeTextDetails) {
  try {
    if (typeof details.tabId === "number" && details.tabId >= 0) {
      chrome.action.setBadgeText(details);
    }
  } catch (error) {
    if (!(error instanceof TypeError && error.message.includes("tabId"))) {
      console.error(
        `[safeSetBadgeText] Error setting badge for tabId ${details.tabId}:`,
        error
      );
    }
  }
}

function showActionBadge(tabId: number, emoji: string) {
  safeSetBadgeText({ tabId: tabId, text: emoji });
  chrome.action.setBadgeBackgroundColor({
    tabId: tabId,
    color: [0, 0, 0, 0],
  });
  setTimeout(() => {
    safeSetBadgeText({ tabId: tabId, text: "" });
  }, NOTIFICATION_TIMEOUT);
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
    return true;
  } catch (error) {
    console.error(
      `[addContextItem] Error adding context for tab ${tabId}:`,
      error
    );
    return false;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = getContextStorageKey(tabId);
  chrome.storage.session.remove(key);
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

/** Helper function to send failure message to content script */
async function sendInterpretationFailed(tabId: number, errorMessage: string) {
  console.error(`[sendInterpretationFailed] Tab ${tabId}: ${errorMessage}`);
  showActionBadge(tabId, "⚠️");

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "INTERPRETATION_FAILED",
      error: errorMessage,
      timestamp: Date.now()
    });
  } catch (sendError) {
    const tabExists = await chrome.tabs.get(tabId).catch(() => null);
    if (!tabExists) {
    //   console.warn(
    //     `[sendInterpretationFailed] Tab ${tabId} closed before failure message could be sent.`
    //   );
    } else {
      console.error(
        `[sendInterpretationFailed] Failed to send INTERPRETATION_FAILED message to tab ${tabId}:`,
        sendError
      );
    }
  }
}

// Using chrome.tabs.captureVisibleTab with scrolling to capture the full page
async function getFullPageScreenshot(tabId: number): Promise<string | null> {
  try {
    // console.log(`[getFullPageScreenshot] Capturing full page for tab ${tabId}`);
    
    // Need to get tab info to get window ID
    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;
    
    // First, save current scroll position so we can restore it later
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        return { 
          scrollX: window.scrollX, 
          scrollY: window.scrollY,
          pageWidth: Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
            document.documentElement.clientWidth
          ),
          pageHeight: Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
            document.documentElement.clientHeight
          ),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        };
      }
    });
    
    // Capture the visible part of the page
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png"
    });
    
    // Reset scroll position
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (originalScrollX, originalScrollY) => {
        window.scrollTo(originalScrollX, originalScrollY);
      },
      args: [0, 0] // Replace with saved scroll position
    });
    
    // console.log(`[getFullPageScreenshot] Screenshot captured successfully`);
    return dataUrl;
  } catch (error) {
    console.error(`[getFullPageScreenshot] Error capturing screenshot:`, error);
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

/** Triggers the interpretation process for a given target and tab. */
async function triggerInterpretation(
  targetInfo: TargetInfo,
  tabId: number
): Promise<void> {
//   console.log(
//     `[triggerInterpretation] Starting for tab ${tabId}. Target type: ${targetInfo.type}`
//   );

  showActionBadge(tabId, "⌛");

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
      captureErrorOccurred = true; // Mark error, but continue
    }

    // --- Fetch Manual Context ---
    const contextItems = await getContextItems(tabId);

    // --- Prepare Payload ---
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
      // Inform the model screenshot failed if it was attempted and failed
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
        targetDescription += `Type: Selection\nText: "${
          targetInfo.selectionText || ""
        }"\n`;
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
      // Iterate in reverse to show most recent first to the AI
      for (let i = contextItems.length - 1; i >= 0; i--) {
        const item = contextItems[i];
        manualContextDescription += `\nItem ${contextItems.length - i}:\n`;
        manualContextDescription += `  Type: ${item.type}\n`;
        if (item.selectionText) {
          manualContextDescription += `  Text: "${item.selectionText}"\n`;
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

    // Assemble the final message structure
    const messagesPayload: Anthropic.Messages.MessageParam[] = [
      { role: "user", content: userContent },
    ];

    // console.log(
    //   "[triggerInterpretation] Payload constructed. User message content items:",
    //   userContent.length
    // );

    // --- Call API and Process Response ---
    const anthropicClient = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    });

    console.log(
      "[triggerInterpretation] Sending request to Anthropic model:",
      ANTHROPIC_MODEL
    );
    const response = await anthropicClient.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: currentSystemPrompt,
      messages: messagesPayload,
    });

    // Log token usage
    if (response.usage) {
    //   console.log(
    //     `[triggerInterpretation] Anthropic Usage: Input ${response.usage.input_tokens}, Output ${response.usage.output_tokens} tokens.`
    //   );
    }

    const responseBlock = response.content[0]; // Expecting one block

    if (!responseBlock || responseBlock.type !== "text") {
      console.error(
        "[triggerInterpretation] Anthropic response content is missing or not text:",
        response.content
      );
      throw new Error("Invalid response format received from API.");
    }

    let responseText = responseBlock.text.trim();

    let interpretationData: InterpretationData | null = null;
    try {
      // Attempt to find JSON block even if there's surrounding text
      if (!(responseText.startsWith("{") && responseText.endsWith("}"))) {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          responseText = jsonMatch[0];
        //   console.log(
        //     "[triggerInterpretation] Extracted JSON block from response."
        //   );
        } else {
          throw new Error(
            "Response does not contain a recognizable JSON block."
          );
        }
      }
      const parsedJson = JSON.parse(responseText);

      // Validate required fields
      if (
        typeof parsedJson.interpretation === "string" &&
        typeof parsedJson.confidence === "number" &&
        typeof parsedJson.tone === "string" &&
        typeof parsedJson.contextSummary === "string"
      ) {
        interpretationData = parsedJson as InterpretationData;
        // console.log(
        //   "[triggerInterpretation] Successfully parsed and validated interpretation data."
        // );
      } else {
        throw new Error(
          "Parsed JSON structure is invalid or missing required fields."
        );
      }
    } catch (parseError) {
      console.error(
        "[triggerInterpretation] Error parsing or validating JSON response:",
        parseError
      );
      console.error(
        "[triggerInterpretation] Raw response text that failed validation:",
        responseText
      );
      throw new Error(
        "Failed to parse or validate interpretation from API response."
      );
    }

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

      showActionBadge(tabId, "✅");

      // Notify content script & popup
      try {
        await chrome.tabs.sendMessage(tabId, { 
          type: "INTERPRETATION_READY",
          timestamp: Date.now()
        });
        chrome.runtime
          .sendMessage({ type: "INTERPRETATION_READY" })
          .catch(() => {});
      } catch (sendError) {
        // console.warn(
        //   `[triggerInterpretation] Failed to send INTERPRETATION_READY message to tab ${tabId}`
        // );
      }
    }
  } catch (error: any) {
    console.error(
      `[triggerInterpretation] Interpretation failed for tab ${tabId}:`,
      error
    );
    // Use the standardized failure handler
    sendInterpretationFailed(
      tabId,
      error?.message || "An unknown interpretation error occurred."
    );
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
        showActionBadge(tabId, "✨");
      }
    } else {
    //   console.warn(
    //     "[contextMenus.onClicked] 'Add to Context' clicked, but no relevant data found in info:",
    //     info
    //   );
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
            "[contextMenus.onClicked] Failed to notify content script:",
            err
          )
        );

      triggerInterpretation(targetInfo, tabId); // Call the main function
    } else {
    //   console.error(
    //     "[contextMenus.onClicked] 'Interpret' clicked, but failed to identify target data from info:",
    //     info
    //   );
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
        showActionBadge(tabId, "🗑️");
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

    // Start interpretation asynchronously
    triggerInterpretation(message.target, tabId).catch((error) => {
      console.error("Error during interpretation:", error);
    });

    // Important: Return false to indicate we won't use sendResponse later
    sendResponse({ status: "Processing started" });
    return false;
  }

  // Other message handlers...
  return false; // Always return false if not using sendResponse asynchronously
});

console.log("[Background] Script initialization complete (v0.6.1).");
