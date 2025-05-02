import { Readability } from "@mozilla/readability";
import type { TargetInfo } from "./types";
import * as rangy from "rangy";
import "rangy/lib/rangy-classapplier";

console.log("[ContentScript] Loaded (v0.6.1).");

// --- Inject CSS for Loading Animation --- Inject animation styles dynamically
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
let tipsIcon: HTMLDivElement | null = null;
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
document.addEventListener("mousedown", handleMouseDown);
document.addEventListener("contextmenu", handleContextMenu);

// Initialize rangy
(rangy as any).init();

// Track context menu position
function handleContextMenu(event: MouseEvent) {
  lastContextMenuPosition = { x: event.clientX, y: event.clientY };
}

// Mark interaction with UI elements to prevent immediate hiding
function markInteraction() {
  isInteractingWithUI = true;
  if (interactionTimeout) clearTimeout(interactionTimeout);
  interactionTimeout = window.setTimeout(() => {
    isInteractingWithUI = false;
    interactionTimeout = null;
  }, DEBOUNCE_DELAY);
}

// Handle text selection changes
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

// Handle mouse down events
function handleMouseDown(event: MouseEvent) {
  if (isInteractingWithUI) return;
}

// Reset selection state
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

// Create or update the interaction icon
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
  tipsIcon = document.createElement("div");
  tipsIcon.textContent = "💡";
  tipsIcon.classList.add("tips-icon");
  tipsIcon.style.position = "absolute";
  tipsIcon.style.fontSize = `${iconSize}px`;
  tipsIcon.style.lineHeight = "1";
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

// Create an icon at the specified position (for context menu)
function createIconAtPosition(x: number, y: number, isGrayscaled = false) {
  // Remove existing icon to avoid state issues
  if (tipsIcon) {
    tipsIcon.remove();
    tipsIcon = null;
  }

  const iconSize = 20;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Create new icon
  tipsIcon = document.createElement("div");
  tipsIcon.textContent = "💡";
  tipsIcon.classList.add("tips-icon");
  tipsIcon.style.position = "absolute";
  tipsIcon.style.fontSize = `${iconSize}px`;
  tipsIcon.style.lineHeight = "1";
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

  // Apply grayscale if needed
  if (isGrayscaled) {
    tipsIcon.style.filter = "grayscale(80%) brightness(0.7)";
  } else {
    tipsIcon.style.filter = "";
  }

  // Show immediately
  tipsIcon.style.opacity = "1";

  // Store position for tooltip placement
  lastIconRect = tipsIcon.getBoundingClientRect();

  return tipsIcon;
}

// Set icon as grayscaled or normal
function setIconGrayscale(grayscaled: boolean) {
  if (tipsIcon) {
    if (grayscaled) {
      tipsIcon.style.filter = "grayscale(80%) brightness(0.7)";
    } else {
      tipsIcon.style.filter = "";
      // Add a subtle "glow" effect when turning on
      tipsIcon.style.transform = "scale(1.1)";
      setTimeout(() => {
        if (tipsIcon) tipsIcon.style.transform = "scale(1)";
      }, 200);
    }
  }
}

// Hide the interaction icon
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

// Handle icon click
function handleIconClick(event: MouseEvent) {
  event.stopPropagation();
  markInteraction();

  if (!currentSelection || !currentSelectionRange || !tipsIcon) {
    hideInteractionIcon(true);
    resetSelectionState();
    return;
  }

  const currentIcon = tipsIcon; // Use the global icon directly
  // const currentIconId = "tips-icon-" + Date.now(); // Removed ID generation
  // currentIcon.dataset.tipsId = currentIconId; // Removed dataset usage

  lastIconRect = currentIcon.getBoundingClientRect();

  // Set loading state immediately using CSS class
  // currentIcon.textContent = "⏳"; // Removed
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
    // --- Add scroll position to target info --- REMOVED
    // scrollX: currentScrollX,
    // scrollY: currentScrollY,
    // ---
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
        // Revert loading state only if the icon is still the loading one
        if (currentIcon) {
            // currentIcon.textContent = "💡"; // Removed
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
         // Revert loading state only if the icon is still the loading one
         if (currentIcon) {
            // currentIcon.textContent = "💡"; // Removed
            currentIcon.classList.remove("tips-loading"); // Remove loading class
        }
        showTooltipNextToIcon("Error: " + response.error, true);
      }
      // Keep loading class if processing started successfully
    }
  );
}

// Show tooltip next to the current icon
function showTooltipNextToIcon(message: string, isError = false) {
  if (!lastIconRect) return;

  // Always ensure any existing tooltip is completely removed first
  hideTooltip(true);
  
  // Create a new tooltip with a unique ID
  const tooltipId = `tips-tooltip-${Date.now()}`;
    tooltipElement = document.createElement('div');
    tooltipElement.textContent = message;
    tooltipElement.style.position = 'absolute';
    tooltipElement.style.background = isError ? 'rgba(220, 53, 69, 0.9)' : 'rgba(40, 167, 69, 0.9)';
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

  // Auto-hide after delay
  if (hideTooltipTimeout) {
    clearTimeout(hideTooltipTimeout);
  }
  hideTooltipTimeout = window.setTimeout(() => hideTooltip(false), 3000);
}

// Show tooltip in top-right corner (fallback)
function showTopRightTooltip(message: string, isError = false) {
  hideTooltip(true);

    tooltipElement = document.createElement('div');
    tooltipElement.textContent = message;
    tooltipElement.style.position = 'absolute';
    tooltipElement.style.background = isError ? 'rgba(220, 53, 69, 0.9)' : 'rgba(40, 167, 69, 0.9)';
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

  // Fade in
  requestAnimationFrame(() => {
    if (tooltipElement) tooltipElement.style.opacity = "1";
  });

  // Auto-hide after delay
  setTimeout(() => hideTooltip(false), 3000);
}

let hideTooltipTimeout: number | null = null;

// Hide tooltip
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
      }, 300);
    }
  }
}

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Removed findTargetIcon helper

  // Handle context menu interpretation request
  if (message.type === "CONTEXT_MENU_INTERPRET_STARTED") {
    // console.log("[ContentScript] Context menu interpretation started, creating icon");
    if (lastContextMenuPosition) {
       if (!tipsIcon) { // Only create if it doesn't exist
           createIconAtPosition(
            lastContextMenuPosition.x,
            lastContextMenuPosition.y,
            false // Don't grayscale here
          );
        //   if (tipsIcon) { // Removed dataset assignment
        //       tipsIcon.dataset.tipsId = "context-menu-target"; 
        //   }
      }
      // No need to explicitly set loading here, INTERPRETATION_NOW_LOADING will handle it
    }
    return false;
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
    // console.log(`[ContentScript] Handling INTERPRETATION_READY`);
    const notificationMessage = "Interpretation Complete! Click the badge to view.";

    if (tipsIcon) {
      // tipsIcon.textContent = "💡"; // Removed (already 💡)
      tipsIcon.classList.remove("tips-loading"); // Remove loading class
      tipsIcon.style.filter = ""; 
      
      showTooltipNextToIcon(notificationMessage, false);
      // Removed auto-hide, let user dismiss or interaction hide it
      // setTimeout(() => hideTooltip(false), 3000);
    } else {
      showTopRightTooltip(notificationMessage, false);
       // Removed auto-hide
       // setTimeout(() => hideTooltip(false), 3000);
    }
    return false;
  }

  // Handle interpretation failures
  if (message.type === "INTERPRETATION_FAILED") {
    // console.log(`[ContentScript] Handling INTERPRETATION_FAILED`);
    const errorMessage = message.error || "Unknown Error";
    const notificationMessage = `Failed: ${errorMessage}`;

    if (tipsIcon) { 
       // tipsIcon.textContent = "❗️"; // Removed error icon change
       tipsIcon.classList.remove("tips-loading"); // Remove loading class
       tipsIcon.style.filter = ""; 

      showTooltipNextToIcon(notificationMessage, true);
      
      // No need to revert icon text anymore, just hide tooltip
      setTimeout(() => {
          // if(tipsIcon && tipsIcon.textContent === "❗️") { // Removed check
          //   tipsIcon.textContent = "💡";
          // }
          hideTooltip(false); 
      }, 5000); 
    } else {
      showTopRightTooltip(notificationMessage, true);
       setTimeout(() => hideTooltip(false), 5000); 
    }
     return false;
  }

  // --- Add handler to restore scroll position --- REMOVED
  // if (message.type === "RESTORE_SCROLL_POSITION") {
  //   // console.log(`[ContentScript] Restoring scroll to X: ${message.scrollX}, Y: ${message.scrollY}`);
  //   window.scrollTo(message.scrollX, message.scrollY);
  //   return false; // Indicate async response is not needed
  // }

  return false;
});

console.log("[ContentScript] Initialization complete (v0.6.1).");