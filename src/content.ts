import { Readability } from "@mozilla/readability";
import type { TargetInfo } from "./types";
import * as rangy from "rangy";
import "rangy/lib/rangy-classapplier";

console.log("[ContentScript] Loaded (v0.6.3).");

// Inject CSS for loading animation
const style = document.createElement('style');
style.textContent = `
  @keyframes tipsPulse {
    0% { transform: scale(1); opacity: 1; filter: brightness(1); } /* Normal state */
    50% { transform: scale(1.2); opacity: 0.9; filter: brightness(1.4); } /* Bigger, slightly transparent, brighter */
    100% { transform: scale(1); opacity: 1; filter: brightness(1); } /* Back to normal */
  }

  .tips-icon.tips-loading {
    animation: tipsPulse 1.5s infinite ease-in-out;
  }
`;
document.head.appendChild(style);

// State variables
let tipsIcon: HTMLImageElement | null = null;
let currentSelection: string | null = null;
let currentSelectionRange: Range | null = null;
let isInteractingWithUI = false;
let interactionTimeout: number | null = null;
let tooltipElement: HTMLDivElement | null = null;
let lastIconRect: DOMRect | null = null;
let debounceTimeout: number | null = null;
let lastContextMenuPosition: { x: number; y: number } | null = null;
const DEBOUNCE_DELAY = 250;

// Event Listeners
document.addEventListener("selectionchange", handleSelectionChange);
document.addEventListener("contextmenu", handleContextMenu);

// Initialize rangy
(rangy as any).init();

// Tracks the position of the last right-click.
function handleContextMenu(event: MouseEvent) {
  lastContextMenuPosition = { x: event.clientX, y: event.clientY };
}

// Marks interaction with UI elements to prevent immediate hiding.
function markInteraction() {
  isInteractingWithUI = true;
  if (interactionTimeout) clearTimeout(interactionTimeout);
  interactionTimeout = window.setTimeout(() => {
    isInteractingWithUI = false;
    interactionTimeout = null;
  }, DEBOUNCE_DELAY);
}

// Handles text selection changes, creating/updating the icon.
function handleSelectionChange() {
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }

  debounceTimeout = window.setTimeout(() => {
    if (isInteractingWithUI) return;

    const rangySel = (rangy as any).getSelection();

    if (rangySel && !rangySel.isCollapsed && rangySel.rangeCount > 0) {
      const selectedText = rangySel.toString().trim();

      if (selectedText) {
        const rangyRange = rangySel.getRangeAt(0);
        const nativeRange = rangyRange.nativeRange;

        currentSelection = selectedText;
        currentSelectionRange = nativeRange;
        createOrUpdateInteractionIcon();
      } else {
        hideInteractionIcon();
        resetSelectionState();
      }
    } else {
      hideInteractionIcon();
      resetSelectionState();
    }
  }, DEBOUNCE_DELAY);
}

// Resets the selection state and related variables.
function resetSelectionState() {
  currentSelection = null;
  currentSelectionRange = null;
  lastIconRect = null;
  isInteractingWithUI = false;
  if (interactionTimeout) {
    clearTimeout(interactionTimeout);
    interactionTimeout = null;
  }
}

// Creates or updates the interaction icon next to the selection.
function createOrUpdateInteractionIcon() {
  if (!currentSelectionRange) return;

  // Remove existing icon to avoid state issues
  if (tipsIcon) {
    tipsIcon.remove();
    tipsIcon = null;
  }

  const rangeRect = currentSelectionRange.getBoundingClientRect();
  const iconSize = 20;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Create new icon
  tipsIcon = document.createElement("img");
  tipsIcon.src = chrome.runtime.getURL("icons/icon64.png");
  tipsIcon.alt = "TIPS Icon";
  tipsIcon.classList.add("tips-icon");
  tipsIcon.style.position = "absolute";
  tipsIcon.style.width = `${iconSize}px`;
  tipsIcon.style.height = `${iconSize}px`;
  tipsIcon.style.cursor = "pointer";
  tipsIcon.style.zIndex = "2147483646";
  tipsIcon.style.userSelect = "none";
  tipsIcon.style.transition =
    "opacity 0.2s ease-in-out, transform 0.1s ease-in-out, filter 0.2s ease-in-out";
  tipsIcon.style.opacity = "0";

  tipsIcon.addEventListener("click", handleIconClick);
  tipsIcon.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    markInteraction();
  });
  document.body.appendChild(tipsIcon);

  // Position icon
  const iconX = rangeRect.right + scrollX + 2;
  const iconY = rangeRect.bottom + scrollY - iconSize / 2 - 2;
  tipsIcon.style.left = `${iconX}px`;
  tipsIcon.style.top = `${iconY}px`;
  tipsIcon.style.display = "block";
  tipsIcon.style.filter = "";

  // Fade-in effect
  requestAnimationFrame(() => {
    if (tipsIcon) {
      tipsIcon.style.opacity = "1";
    }
  });

  // Hide any existing tooltip
  hideTooltip(true);

  // Store icon position
  lastIconRect = tipsIcon.getBoundingClientRect();
}

// Creates an icon at a specific position (used for context menu actions).
function createIconAtPosition(x: number, y: number) {
  // Remove existing icon to avoid state issues
  if (tipsIcon) {
    tipsIcon.remove();
    tipsIcon = null;
  }

  const iconSize = 20;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Create new icon
  tipsIcon = document.createElement("img");
  tipsIcon.src = chrome.runtime.getURL("icons/icon64.png");
  tipsIcon.alt = "TIPS Icon";
  tipsIcon.classList.add("tips-icon");
  tipsIcon.style.position = "absolute";
  tipsIcon.style.width = `${iconSize}px`;
  tipsIcon.style.height = `${iconSize}px`;
  tipsIcon.style.cursor = "pointer";
  tipsIcon.style.zIndex = "2147483646";
  tipsIcon.style.userSelect = "none";
  tipsIcon.style.transition =
    "opacity 0.2s ease-in-out, transform 0.1s ease-in-out, filter 0.2s ease-in-out";

  document.body.appendChild(tipsIcon);

  // Position icon
  tipsIcon.style.left = `${x + scrollX - iconSize / 2}px`;
  tipsIcon.style.top = `${y + scrollY - iconSize / 2}px`;
  tipsIcon.style.display = "block";
  tipsIcon.style.filter = "";

  // Show immediately
  tipsIcon.style.opacity = "1";

  // Store position for tooltip placement
  lastIconRect = tipsIcon.getBoundingClientRect();

  return tipsIcon;
}

// Hides the interaction icon, optionally immediately.
function hideInteractionIcon(fast = false) {
  if (tipsIcon) {
    tipsIcon.style.filter = "";
    tipsIcon.style.opacity = "0";

    hideTooltip(fast);

    if (!fast) {
      setTimeout(() => {
        if (tipsIcon) tipsIcon.style.display = "none";
      }, 200);
    } else {
      tipsIcon.style.display = "none";
    }
  }
}

// Handles clicks on the interaction icon to trigger interpretation.
function handleIconClick(event: MouseEvent) {
  event.stopPropagation();
  markInteraction();

  if (!currentSelection || !currentSelectionRange || !tipsIcon) {
    hideInteractionIcon(true);
    resetSelectionState();
    return;
  }

  const currentIcon = tipsIcon; // Use the global icon directly

  lastIconRect = currentIcon.getBoundingClientRect();

  // Set loading state immediately using CSS class
  currentIcon.classList.add("tips-loading"); // Add loading class
  currentIcon.style.filter = "";

  const pageUrl = window.location.href;
  const pageTitle =
    document.title ||
    new Readability(document.cloneNode(true) as Document).parse()?.title ||
    "Unknown Title";

  const targetInfo: TargetInfo = {
    type: "selection",
    selectionText: currentSelection,
    pageUrl: pageUrl,
    pageTitle: pageTitle,
  };

  chrome.runtime.sendMessage(
    {
      type: "INTERPRET_TARGET",
      target: targetInfo,
      // targetId: currentIconId, // Removed ID
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[ContentScript] Error sending message:",
          chrome.runtime.lastError
        );
        if (currentIcon) {
            currentIcon.classList.remove("tips-loading"); // Remove loading class
        }
        showTooltipNextToIcon("Error communicating with extension.", true);
        return;
      }

      if (response && response.error) {
        console.error(
          "[ContentScript] Background reported error:",
          response.error
        );
         if (currentIcon) {
            currentIcon.classList.remove("tips-loading"); // Remove loading class
        }
        showTooltipNextToIcon("Error: " + response.error, true);
      }
      // Keep loading class if processing started successfully
    }
  );
}

// Shows a tooltip positioned next to the current interaction icon.
function showTooltipNextToIcon(message: string, isError = false, backgroundColor?: string) {
  if (!lastIconRect) return;

  // Always ensure any existing tooltip is completely removed first
  hideTooltip(true);

  // Create a new tooltip with a unique ID
  const tooltipId = `tips-tooltip-${Date.now()}`;
    tooltipElement = document.createElement('div');
    tooltipElement.textContent = message;
    tooltipElement.style.position = 'absolute';
    // Use custom background color if provided, otherwise default based on isError
    tooltipElement.style.background = backgroundColor
      ? backgroundColor
      : isError
      ? 'rgba(220, 53, 69, 0.9)'
      : 'rgba(40, 167, 69, 0.9)';
    tooltipElement.style.color = 'white';
    tooltipElement.style.padding = '5px 10px';
    tooltipElement.style.borderRadius = '4px';
    tooltipElement.style.fontSize = '12px';
    tooltipElement.style.zIndex = '10002'; 
    tooltipElement.style.fontFamily = 'system-ui, sans-serif';
    tooltipElement.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    tooltipElement.style.opacity = '0';
    tooltipElement.style.transition = 'opacity 0.3s ease-in-out';
    tooltipElement.style.pointerEvents = 'none';


  document.body.appendChild(tooltipElement);

  // Calculate position - always to the right of the icon
  const tooltipWidth = tooltipElement.offsetWidth;
  const tooltipHeight = tooltipElement.offsetHeight;

  // Position to the right of the icon
  let tooltipLeft = lastIconRect.right + window.scrollX + 8;
  let tooltipTop =
    lastIconRect.top +
    window.scrollY +
    lastIconRect.height / 2 -
    tooltipHeight / 2;

  // Make sure tooltip is within viewport bounds
  tooltipLeft = Math.max(
    5,
    Math.min(tooltipLeft, window.innerWidth + window.scrollX - tooltipWidth - 5)
  );
  tooltipTop = Math.max(
    5,
    Math.min(
      tooltipTop,
      window.innerHeight + window.scrollY - tooltipHeight - 5
    )
  );

  tooltipElement.style.left = `${tooltipLeft}px`;
  tooltipElement.style.top = `${tooltipTop}px`;

  // Fade in
  requestAnimationFrame(() => {
    if (tooltipElement) tooltipElement.style.opacity = "1";
  });
}

let hideTooltipTimeout: number | null = null;

// Hides the currently displayed tooltip, optionally immediately.
function hideTooltip(fast = false) {
  if (hideTooltipTimeout) {
    clearTimeout(hideTooltipTimeout);
    hideTooltipTimeout = null;
  }

  if (tooltipElement) {
    const elementToRemove = tooltipElement;
    tooltipElement = null;

    if (fast) {
      elementToRemove.remove();
    } else {
      elementToRemove.style.opacity = "0";
      hideTooltipTimeout = window.setTimeout(() => {
        elementToRemove.remove();
        hideTooltipTimeout = null;
      }, 200);
    }
  }
}

// Handles notifications triggered by context menu actions (Add/Clear Context).
function handleContextNotification(messageText: string, color: string, messageType: string) {
  if (lastContextMenuPosition) {
    // Hide any existing icon and its tooltip immediately
    hideInteractionIcon(true);

    // Create a new temporary icon at the click position
    const tempIcon = createIconAtPosition(lastContextMenuPosition.x, lastContextMenuPosition.y);

    if (tempIcon) {
      // Update lastIconRect for tooltip positioning
      lastIconRect = tempIcon.getBoundingClientRect();

      // Show the tooltip next to the new temporary icon
      showTooltipNextToIcon(messageText, false, color);

      // Schedule removal of the temporary icon and its tooltip
      const iconToRemove = tempIcon;
      const HIDE_DELAY_MS = 3300;
      setTimeout(() => {
        // Check if the icon to remove is still the current one
        if (tipsIcon === iconToRemove && document.body.contains(iconToRemove)) {
            hideInteractionIcon(false); // Fade out both

            // Reset state if this was indeed the icon we were removing
            if (tipsIcon === iconToRemove) {
                tipsIcon = null;
                lastIconRect = null;
            }
        }
      }, HIDE_DELAY_MS);
    } else {
        console.warn(`[handleContextNotification] Failed to create temporary icon for ${messageType}.`);
    }
  } else {
    // This case should ideally not happen if contextmenu listener works.
    console.warn(`[handleContextNotification] Cannot show notification for ${messageType} - lastContextMenuPosition is unknown.`);
    // Do not show top-left tooltip as per previous requirement.
  }
}

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Removed findTargetIcon helper

  // Handle context menu interpretation request
  if (message.type === "CONTEXT_MENU_INTERPRET_STARTED") {
    if (lastContextMenuPosition) {
       // Interpretation should start fresh at the click location.
       // Hide any existing icon (and its tooltip) immediately.
       hideInteractionIcon(true);

       // Create the new icon specifically for this interpretation task.
       // createIconAtPosition updates the global `tipsIcon`.
       createIconAtPosition(
        lastContextMenuPosition.x,
        lastContextMenuPosition.y
      );
      // The `INTERPRETATION_NOW_LOADING` message (sent shortly after this one
      // by background.ts) will find this new `tipsIcon` and add the
      // `tips-loading` class to make it pulsate.
    } else {
        console.warn("[CONTEXT_MENU_INTERPRET_STARTED] No last context menu position known.");
    }
    return false; // Indicate synchronous handling
  }

  // Handle start of interpretation loading
  if (message.type === "INTERPRETATION_NOW_LOADING") {
    // console.log(`[ContentScript] Handling INTERPRETATION_NOW_LOADING`);
    if (tipsIcon) {
      // tipsIcon.textContent = "⏳"; // Removed
      tipsIcon.classList.add("tips-loading"); // Add loading class
      tipsIcon.style.filter = ""; 
      hideTooltip(true);
    } else {
        // console.warn("[ContentScript] INTERPRETATION_NOW_LOADING received, but no icon found.");
    }
    return false;
  }

  // Handle interpretation results
  if (message.type === "INTERPRETATION_READY") {
    const notificationMessage = "Interpretation Complete! Click the badge to view.";
    const triggerSource = message.triggerSource;

    // Always show tooltip next to the icon
    if (tipsIcon) {
         // Stop pulsing
         tipsIcon.classList.remove("tips-loading");
         tipsIcon.style.filter = "";
         // Recalculate rect before showing tooltip
         lastIconRect = tipsIcon.getBoundingClientRect();
         showTooltipNextToIcon(notificationMessage, false);

         // If triggered by context menu, hide icon after delay
         if (triggerSource === 'contextMenu') {
             setTimeout(() => {
                 hideInteractionIcon(false);
                 resetSelectionState();
             }, 1500);
         }
         // If triggered by icon click, icon remains visible
    } else {
        // Should not happen if CONTEXT_MENU_INTERPRET_STARTED created icon
        console.warn("[INTERPRETATION_READY] No icon found to show tooltip next to.");
    }
    return false;
  }

  // Handle interpretation failures
  if (message.type === "INTERPRETATION_FAILED") {
    const errorMessage = message.error || "Unknown Error";
    const notificationMessage = `Failed: ${errorMessage}`;

    // Always show tooltip next to the icon
    if (tipsIcon) {
        tipsIcon.classList.remove("tips-loading");
        tipsIcon.style.filter = "";
        // Recalculate rect before showing tooltip
        lastIconRect = tipsIcon.getBoundingClientRect();
        showTooltipNextToIcon(notificationMessage, true); // Show as error

        // If triggered by context menu, hide icon after delay
        if (message.triggerSource === 'contextMenu') {
             setTimeout(() => {
                 hideInteractionIcon(false);
                 resetSelectionState();
             }, 3000);
         } else {
            // If triggered by icon click, auto-hide tooltip after a delay, keep icon
            setTimeout(() => {
                hideTooltip(false);
            }, 5000);
         }
    } else {
         // Should not happen if CONTEXT_MENU_INTERPRET_STARTED created icon
         console.warn("[INTERPRETATION_FAILED] No icon found to show tooltip next to.");
    }
     return false;
  }

  // Add handlers for context notifications
  if (message.type === "CONTEXT_ADDED_NOTIFICATION") {
    handleContextNotification("Added!", 'rgba(255, 193, 7, 0.9)', message.type);
    return false;
  }

  if (message.type === "CONTEXT_CLEARED_NOTIFICATION") {
    handleContextNotification("Cleared!", 'rgba(108, 117, 125, 0.9)', message.type);
    return false;
  }

  return false;
});

console.log("[ContentScript] Initialization complete (v0.6.3).");
