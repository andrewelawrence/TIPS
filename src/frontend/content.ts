import { Readability } from '@mozilla/readability';

console.log("TIPS Content Script Loaded.");

let tipsIcon: HTMLDivElement | null = null;
let actionMenu: HTMLDivElement | null = null;
let currentSelection: string | null = null;
let currentSelectionRange: Range | null = null;
let isInteractingWithUI = false;
let interactionTimeout: number | null = null;
let tooltipElement: HTMLDivElement | null = null;
let lastIconRect: DOMRect | null = null; // Store icon's last position

document.addEventListener('mouseup', handleTextSelection);
document.addEventListener('mousedown', handleMouseDown);

// Helper to mark interaction and reset the flag
function markInteraction() {
    isInteractingWithUI = true;
    if (interactionTimeout) clearTimeout(interactionTimeout);
    interactionTimeout = window.setTimeout(() => {
        isInteractingWithUI = false;
        interactionTimeout = null;
    }, 150);
}

function handleTextSelection(event: MouseEvent) {
  // Ignore if mouseup happens right after interacting with our UI
  if (isInteractingWithUI) return;
  
  setTimeout(() => {
    // Ignore again inside timeout
    if (isInteractingWithUI) return;

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && selection && selection.rangeCount > 0) {
      console.log("Selected text:", selectedText);
      currentSelection = selectedText;
      currentSelectionRange = selection.getRangeAt(0).cloneRange();
      createOrUpdateInteractionUI();
    } else {
        // Only hide if no text is selected AND we didn't just interact with the UI
        if (!isInteractingWithUI) {
            // Check if the selection was lost because user clicked the icon
            const clickedIcon = tipsIcon && event.target === tipsIcon;
            if (!clickedIcon) { // Don't hide immediately if icon was the target
                 hideInteractionUI();
                 currentSelection = null;
                 currentSelectionRange = null;
            }
        }
    }
  }, 50);
}

function handleMouseDown(event: MouseEvent) {
    // Ignore if the interaction flag is set
    if (isInteractingWithUI) return;

    // Hide if clicking outside the icon AND the menu
    const target = event.target as Node;
    const clickedIcon = tipsIcon && (target === tipsIcon || tipsIcon.contains(target));
    const clickedMenu = actionMenu && (target === actionMenu || actionMenu.contains(target));

    if (!clickedIcon && !clickedMenu) {
        hideInteractionUI();
        currentSelection = null;
        currentSelectionRange = null;
    }
}

// Helper function to find the nearest meaningful block-level parent
function findMeaningfulBlock(node: Node): HTMLElement | null {
    let current: Node | null = node;
    const blockElements = new Set(['DIV', 'P', 'LI', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'TD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    while (current && current !== document.body) {
        if (current.nodeType === Node.ELEMENT_NODE) {
            const element = current as HTMLElement;
            if (blockElements.has(element.tagName)) {
                // Check if it's a significant block (e.g., has substantial content or specific class)
                // Basic check: avoid tiny wrappers
                if (element.offsetHeight > 20 || element.offsetWidth > 100) { 
                    return element;
                }
            }
        }
        current = current.parentNode;
    }
    return null;
}

function createOrUpdateInteractionUI() {
    if (!currentSelectionRange) return; // Need the range for positioning

    const rangeRect = currentSelectionRange.getBoundingClientRect();
    const iconSize = 20; // Approximate size of the icon
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // --- Icon Creation/Update ---
    if (!tipsIcon) {
        tipsIcon = document.createElement('div');
        tipsIcon.textContent = '💡';
        tipsIcon.style.position = 'absolute';
        tipsIcon.style.fontSize = `${iconSize}px`;
        tipsIcon.style.padding = '0px';
        tipsIcon.style.cursor = 'pointer';
        tipsIcon.style.zIndex = '10000'; // Lower z-index than menu/tooltip
        tipsIcon.style.userSelect = 'none';
        tipsIcon.style.transition = 'filter 0.2s ease-in-out, opacity 0.3s ease-in-out'; // Smooth transition for glow/grayscale AND opacity
        tipsIcon.style.opacity = '1'; // Start fully visible
        tipsIcon.addEventListener('click', handleIconClick);
        tipsIcon.addEventListener('mousedown', (e) => { // Prevent mousedown on icon from hiding UI
            e.stopPropagation();
            markInteraction();
        });
        document.body.appendChild(tipsIcon);
    }

    // Position Icon at bottom-right of selection
    const iconX = rangeRect.right + scrollX - (iconSize / 2); // Adjust to be near the corner
    const iconY = rangeRect.bottom + scrollY - (iconSize / 2);
    tipsIcon.style.left = `${iconX}px`;
    tipsIcon.style.top = `${iconY}px`;
    tipsIcon.style.display = 'block';
    tipsIcon.style.filter = ''; // Reset filter on new selection show

    // Hide tooltip if showing from previous interaction
    hideTooltip();
}

function hideInteractionUI() {
    // This function now primarily hides the menu and resets icon state if needed
    // Icon hiding is now tied to the tooltip fade-out
    if (tipsIcon) {
        tipsIcon.style.filter = ''; // Remove any glow/filter
    }
}

// --- New Icon Click Handler (Triggers Action Directly) ---
function handleIconClick(event: MouseEvent) {
    event.stopPropagation(); // Keep this
    markInteraction(); // Keep this

    console.log(`Icon clicked, triggering interpretation...`);

    if (!currentSelection || !currentSelectionRange || !tipsIcon) { // Ensure tipsIcon exists
        console.warn("Icon clicked but no text selected, range, or icon found.");
        hideInteractionUI(); // Hide icon if selection invalid
        return;
    }

    // Store the icon's current position *before* sending the message
    lastIconRect = tipsIcon.getBoundingClientRect();

    // Add a visual cue that something is happening
    tipsIcon.style.filter = 'grayscale(80%)'; // Make it gray while processing

    // --- Context Collection (Copied from original handleActionClick) ---
    const pageUrl = window.location.href;
    let pageTitle = document.title;
    let surroundingText = { preceding: "", succeeding: "" };
    let contextGathered = false;

    // --- Attempt with Readability.js ---
    try {
        if (Readability) {
            const documentClone = document.cloneNode(true) as Document;
            const reader = new Readability(documentClone, {
                 // debug: true,
                 nbTopCandidates: 10,
                 charThreshold: 500
            });
            const article = reader.parse();

            if (article && article.textContent) {
                pageTitle = article.title || pageTitle;
                const mainText = article.textContent;
                const selectionIndex = mainText.indexOf(currentSelection);

                if (selectionIndex !== -1) {
                    const contextWindow = 100;
                    surroundingText.preceding = mainText.substring(Math.max(0, selectionIndex - contextWindow), selectionIndex).trim();
                    surroundingText.succeeding = mainText.substring(selectionIndex + currentSelection.length, Math.min(mainText.length, selectionIndex + currentSelection.length + contextWindow)).trim();
                    console.log("Context Found (Readability):", surroundingText);
                    contextGathered = true;
                } else {
                    console.warn("Selection not found within Readability article text. Falling back.");
                }
            } else {
                console.warn("Readability could not parse article content. Falling back.");
            }
        } else {
             console.warn("Readability library not found or not a function. Falling back.");
        }
    } catch (readabilityError) {
        console.error("Error during Readability processing:", readabilityError);
        // Proceed to fallback if Readability fails
    }

    // --- Fallback to original method if Readability failed or didn't find context ---
    if (!contextGathered) {
        console.log("Using fallback context gathering method.");
        try {
            const range = currentSelectionRange;
            const startNode = range.startContainer;

            const meaningfulBlock = findMeaningfulBlock(startNode);
            console.log("Meaningful Block Found (Fallback):", meaningfulBlock);

            if (meaningfulBlock) {
                const prevBlock = meaningfulBlock.previousElementSibling;
                if (prevBlock) {
                    surroundingText.preceding = prevBlock.textContent?.trim().slice(0, 500) || ""; // Increased limit slightly
                }
                const nextBlock = meaningfulBlock.nextElementSibling;
                if (nextBlock) {
                    surroundingText.succeeding = nextBlock.textContent?.trim().slice(0, 500) || ""; // Increased limit slightly
                }
                 console.log("Context Found (Fallback):", surroundingText);
                 contextGathered = true; // Mark success even on fallback
            } else {
                console.warn("No meaningful block found in fallback.");
            }
        } catch (fallbackError) {
            console.error("Error gathering fallback surrounding context:", fallbackError);
        }
    }

    // --- Send Message Directly (Copied from original handleActionClick INTERPRET_TEXT case) ---
    console.log("Sending INTERPRET_TEXT message to background...");
    chrome.runtime.sendMessage({
        type: "INTERPRET_TEXT",
        text: currentSelection,
        context: {
            url: pageUrl,
            title: pageTitle,
            precedingText: surroundingText.preceding,
            succeedingText: surroundingText.succeeding
        }
    });

    // --- Reset selection state ---
    currentSelection = null;
    currentSelectionRange = null;
    // --- Do NOT hide the icon here anymore, hideTooltip will handle it ---
}

// --- Tooltip Functions ---
function showTooltip(message: string, nearElementRect: DOMRect, isError = false) {
    hideTooltip(); // Remove any existing tooltip

    tooltipElement = document.createElement('div');
    tooltipElement.textContent = message;
    tooltipElement.style.position = 'absolute';
    tooltipElement.style.background = isError ? 'rgba(220, 53, 69, 0.9)' : 'rgba(40, 167, 69, 0.9)'; // Red for error, Green for success
    tooltipElement.style.color = 'white';
    tooltipElement.style.padding = '5px 10px';
    tooltipElement.style.borderRadius = '4px';
    tooltipElement.style.fontSize = '12px';
    tooltipElement.style.zIndex = '10002'; // Above icon/menu
    tooltipElement.style.fontFamily = 'system-ui, sans-serif';
    tooltipElement.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    tooltipElement.style.opacity = '0'; // Start faded out
    tooltipElement.style.transition = 'opacity 0.3s ease-in-out';
    tooltipElement.style.pointerEvents = 'none'; // Prevent interaction

    document.body.appendChild(tooltipElement);

    // Ensure tooltip is positioned correctly before fade-in
    // Recalculate position as offsetHeight might not be ready immediately
    const calculatedTop = nearElementRect.top + window.scrollY + (nearElementRect.height / 2) - (tooltipElement.offsetHeight / 2);
    tooltipElement.style.left = `${nearElementRect.right + window.scrollX + 5}px`; // To the right of the original icon position
    tooltipElement.style.top = `${calculatedTop}px`; 

    // Fade in
    requestAnimationFrame(() => {
        tooltipElement!.style.opacity = '1';
    });

    // Auto-hide after a delay
    setTimeout(hideTooltip, 3000); // Hide after 3 seconds
}

function hideTooltip() {
    if (tooltipElement) {
        tooltipElement.style.opacity = '0';
        // Remove from DOM and hide icon after transition
        setTimeout(() => {
            tooltipElement?.remove();
            tooltipElement = null;
            // --- Hide Icon Concurrently ---
            if (tipsIcon) {
                tipsIcon.style.display = 'none'; // Hide after fade
                tipsIcon.style.opacity = '1'; // Reset opacity for next time
                tipsIcon.style.filter = ''; // Ensure filter is reset
            }
        }, 300); // Match transition duration

        // --- Fade out Icon --- (New logic)
        if (tipsIcon) {
            tipsIcon.style.opacity = '0';
        }
    }
}

// --- Message Listener --- 
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[ContentScript:onMessage] Received message:", message, "From:", sender);

  if (message.type === "INTERPRETATION_READY") {
    console.log("[ContentScript:onMessage] Handling INTERPRETATION_READY.");
    // Reset icon appearance and show tooltip near current icon position
    if (tipsIcon) {
        tipsIcon.style.filter = ''; // Remove grayscale
        const currentIconRect = tipsIcon.getBoundingClientRect(); // Get current position
        if (currentIconRect) {
            showTooltip("Interpretation Ready! Click the extension icon.", currentIconRect, false); 
        } else {
             console.warn("[ContentScript:onMessage] INTERPRETATION_READY: Could not get icon bounds.");
        }
    } else {
        console.warn("[ContentScript:onMessage] INTERPRETATION_READY received, but tipsIcon element not found.");
    }
    // We don't send a response back
    return false;
  }
  
  if (message.type === "SHOW_PROCESSING_ICON") {
    console.log("[ContentScript:onMessage] Handling SHOW_PROCESSING_ICON.");
    if (tipsIcon) {
        tipsIcon.style.filter = 'grayscale(80%)'; // Apply grayscale immediately
    } else {
        console.warn("[ContentScript:onMessage] SHOW_PROCESSING_ICON: tipsIcon element not found.");
    }
    return false; // Indicate synchronous handling
  }

  if (message.type === "INTERPRETATION_FAILED") {
      console.log("[ContentScript:onMessage] Handling INTERPRETATION_FAILED.", message.error);
      if (tipsIcon) {
          tipsIcon.style.filter = ''; // Remove grayscale
          const currentIconRect = tipsIcon.getBoundingClientRect();
          if (currentIconRect) {
                // Use the specified error message and set isError to true
                showTooltip("Interpretation failed, please try again!", currentIconRect, true);
          } else {
              console.warn("[ContentScript:onMessage] INTERPRETATION_FAILED: Could not get icon bounds.");
          }
      } else {
          console.warn("[ContentScript:onMessage] INTERPRETATION_FAILED: tipsIcon element not found.");
      }
      return false; // Indicate synchronous handling
  }

  // Handle other potential message types if needed in the future
  console.log("[ContentScript:onMessage] Message type not handled:", message.type);
  return false; // Indicate synchronous handling for unhandled types
});

console.log("TIPS Content Script event listeners registered.");

// TODO: Consider edge cases like iframes, shadow DOM? (Likely out of scope for now) 