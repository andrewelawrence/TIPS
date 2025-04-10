// Background service worker for TIPS extension

console.log("TIPS Background Script Loaded");

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background:", message);
  console.log("Sender:", sender);

  if (message.type === "ANALYZE_TEXT") {
    const textToAnalyze = message.text;
    console.log("Request to analyze text:", textToAnalyze);

    // TODO: Get page context (e.g., URL, title) from sender.tab if needed
    // TODO: Call the actual backend API (Lambda function via API Gateway)
    // TODO: Store interaction data (DynamoDB/S3)
    // TODO: Send response back to content script or popup if needed

    // Example of sending an async response (if needed later):
    // sendResponse({ status: "processing", data: textToAnalyze });
    // return true; // Indicates you will send a response asynchronously
  }

  // Return false if not sending an async response
  return false;
});

// Optional: Add listeners for context menus, commands, etc.
// chrome.contextMenus.create(...);
// chrome.commands.onCommand.addListener(...); 