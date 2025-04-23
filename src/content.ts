import { Readability } from "@mozilla/readability";
import type { TargetInfo } from "./types";
import * as rangy from "rangy";
import "rangy/lib/rangy-classapplier";

console.log("[ContentScript] Loaded (v0.6.1).");

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
    // console.warn("[ContentScript] Icon clicked but required state is missing.");
    hideInteractionIcon(true);
    resetSelectionState();
    return;
  }

  lastIconRect = tipsIcon.getBoundingClientRect();

  setIconGrayscale(true);

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

//   console.log(
//     "[ContentScript] Sending INTERPRET_TARGET message to background script."
//   );
  chrome.runtime.sendMessage(
    {
      type: "INTERPRET_TARGET",
      target: targetInfo,
    },
    (response) => {
      // Handle both success and error in the callback
      if (chrome.runtime.lastError) {
        console.error(
          "[ContentScript] Error sending message:",
          chrome.runtime.lastError
        );
        showTooltipNextToIcon("Error communicating with extension.", true);
        setIconGrayscale(false);
        return;
      }

      // Optional response handling
      if (response && response.error) {
        console.error(
          "[ContentScript] Background reported error:",
          response.error
        );
        showTooltipNextToIcon("Error: " + response.error, true);
        setIconGrayscale(false);
      }
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
  // Handle context menu interpretation request
  if (message.type === "CONTEXT_MENU_INTERPRET_STARTED") {
    // console.log("[ContentScript] Context menu interpretation started, creating icon");
    if (lastContextMenuPosition) {
      // Create grayscaled icon at context menu position
      createIconAtPosition(
        lastContextMenuPosition.x,
        lastContextMenuPosition.y,
        true
      );
    }
    return false;
  }

  // Handle interpretation results with clearer messaging
  if (message.type === "INTERPRETATION_READY") {
    // console.log(`[ContentScript] Handling interpretation success`);
    
    const notificationMessage = "Interpretation Complete! Click extension icon.";
    
    // If we have an icon, show tooltip next to it and turn off grayscale
    if (tipsIcon && lastIconRect) {
      setIconGrayscale(false);
      showTooltipNextToIcon(notificationMessage, false);
      return false;
    }
    
    // Fallback to top-right corner
    showTopRightTooltip(notificationMessage, false);
  }
  
  // Handle interpretation failures
  if (message.type === "INTERPRETATION_FAILED") {
    // console.log(`[ContentScript] Handling interpretation failure`);
    
    const errorMessage = message.error || "Unknown Error";
    const notificationMessage = `Interpretation failed: ${errorMessage}`;
    
    // If we have an icon, show tooltip next to it and turn off grayscale
    if (tipsIcon && lastIconRect) {
      setIconGrayscale(false);
      showTooltipNextToIcon(notificationMessage, true);
      return false;
    }
    
    // Fallback to top-right corner
    showTopRightTooltip(notificationMessage, true);
  }

  return false;
});

console.log("[ContentScript] Initialization complete (v0.6.1).");