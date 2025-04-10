// Content script for TIPS extension

console.log("TIPS Content Script Loaded");

let tipsIcon: HTMLDivElement | null = null;
let currentSelection: string | null = null;

document.addEventListener('mouseup', handleTextSelection);
document.addEventListener('mousedown', handleMouseDown); // To hide icon on new click

function handleTextSelection(event: MouseEvent) {
  // Debounce or delay slightly to avoid firing on simple clicks
  setTimeout(() => {
    const selectedText = window.getSelection()?.toString().trim();

    if (selectedText) {
      console.log("Selected text:", selectedText);
      currentSelection = selectedText;
      createOrUpdateIcon(event.clientX, event.clientY);
    } else {
      hideIcon();
      currentSelection = null;
    }
  }, 50); // Small delay
}

function handleMouseDown(event: MouseEvent) {
  // Hide icon immediately if user clicks away, unless clicking the icon itself
  if (tipsIcon && event.target !== tipsIcon && !tipsIcon.contains(event.target as Node)) {
    hideIcon();
    currentSelection = null;
  }
}

function createOrUpdateIcon(x: number, y: number) {
  if (!tipsIcon) {
    tipsIcon = document.createElement('div');
    tipsIcon.textContent = '💡'; // Simple placeholder icon
    tipsIcon.style.position = 'absolute';
    tipsIcon.style.background = '#eee';
    tipsIcon.style.border = '1px solid #ccc';
    tipsIcon.style.borderRadius = '50%';
    tipsIcon.style.padding = '2px 5px';
    tipsIcon.style.cursor = 'pointer';
    tipsIcon.style.zIndex = '9999';
    tipsIcon.style.fontSize = '14px';
    tipsIcon.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    tipsIcon.style.display = 'none'; // Start hidden
    tipsIcon.addEventListener('click', handleIconClick);
    document.body.appendChild(tipsIcon);
  }

  // Position near mouse cursor, adjusting for scroll
  tipsIcon.style.left = `${x + window.scrollX + 5}px`;
  tipsIcon.style.top = `${y + window.scrollY + 5}px`;
  tipsIcon.style.display = 'block';
}

function hideIcon() {
  if (tipsIcon) {
    tipsIcon.style.display = 'none';
  }
}

function handleIconClick() {
  if (currentSelection) {
    console.log("Sending message to background for text:", currentSelection);
    chrome.runtime.sendMessage({ type: "ANALYZE_TEXT", text: currentSelection });

    // TODO: Handle potential response from background script if needed
  }
  hideIcon(); // Hide after click
  currentSelection = null;
}

// Optional: Add listener for key presses if hotkeys are desired later
// document.addEventListener('keydown', handleKeyDown);

// TODO: Add logic to detect text selection and show interaction element 