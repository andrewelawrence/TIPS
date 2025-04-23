<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface TargetInfo {
    type: 'selection' | 'image' | 'link' | 'page';
    selectionText?: string;
    srcUrl?: string;
    pageUrl?: string;
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

  let isFirstVisit = true;
  let isLoading = true;
  let interpretationData: InterpretationData | null = null;
  let originalTarget: TargetInfo | null = null;
  let errorLoading: string | null = null; 
  let imageLoadError = false; 
  let showContextSummary = false; 
  let isMounted = false;

  /* Helper to get confidence class based on score */
  function getConfidenceClass(score: number): string {
    const level = Math.floor(score * 10); 
    const adjustedLevel = Math.min(level, 9);
    return `confidence-${adjustedLevel}`;
  }

  function handleImageError() {
    console.warn("[Popup] Image failed to load:", originalTarget?.srcUrl);
    imageLoadError = true;
  }

  function handleAnalyzeContext() {
      console.log("[Popup] Analyze Context button clicked.");
      showContextSummary = !showContextSummary; 
  }

  // Function to load interpretation data from storage
  async function loadInterpretationData() {
    if (!isMounted) {
      console.log("[Popup] loadInterpretationData called but component not mounted. Aborting.");
      return;
    }
    console.log("[Popup] Attempting to load interpretation data...");
    // Reset state variables before loading
    isLoading = true;
    errorLoading = null;
    imageLoadError = false;
    showContextSummary = false;

    try {
      const result = await chrome.storage.local.get('lastInterpretation');
      console.log("[Popup] Raw data from storage:", result);

      if (result.lastInterpretation) {
        const storedData = result.lastInterpretation as StoredData;
        console.log("[Popup] Parsed storedData:", storedData);

        // More robust validation
        if (
          storedData &&
          storedData.interpretation &&
          typeof storedData.interpretation.interpretation === 'string' &&
          typeof storedData.interpretation.confidence === 'number' &&
          typeof storedData.interpretation.tone === 'string' &&
          storedData.originalTarget &&
          typeof storedData.originalTarget.type === 'string' &&
          typeof storedData.interpretation.contextSummary === 'string'
        ) {
          interpretationData = storedData.interpretation;
          originalTarget = storedData.originalTarget;
          console.log("[Popup] Successfully loaded interpretation:", interpretationData);
          console.log("[Popup] Original target:", originalTarget);
          errorLoading = null;
        } else {
          console.warn("[Popup] Stored data structure is invalid or incomplete:", storedData);
          errorLoading = "Data format invalid.";
          interpretationData = null;
          originalTarget = null;
        }
      } else {
        console.log("[Popup] No interpretation data found in storage.");
        errorLoading = null;
        interpretationData = null;
        originalTarget = null;
      }
    } catch (e: any) {
      console.error("[Popup] Error loading interpretation from storage:", e);
      errorLoading = `Storage access failed: ${e.message || 'Unknown error'}`;
      interpretationData = null;
      originalTarget = null;
    } finally {
       if (isMounted) {
         isLoading = false;
       }
      console.log("[Popup] Data loading finished. isLoading:", isLoading, "errorLoading:", errorLoading, "HasData:", !!interpretationData);
    }
  }

  // Define listener handlers
  const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, namespace: string) => {
    if (!isMounted) {
      console.log("[Popup] handleStorageChange called but component not mounted.");
      return;
    }
    console.log("[Popup] Storage change detected:", namespace, changes);
    if (namespace === 'local' && changes.lastInterpretation) {
      console.log("[Popup] lastInterpretation changed in storage, reloading data");
      loadInterpretationData();
    }
  };

  // Add function to check if first visit
  async function checkFirstVisit() {
    try {
      const result = await chrome.storage.local.get('hasVisitedBefore');
      isFirstVisit = !result.hasVisitedBefore;
      
      if (isFirstVisit) {
        chrome.storage.local.set({ hasVisitedBefore: true });
      }
    } catch (e) {
      console.error("[Popup] Error checking first visit status:", e);
      isFirstVisit = false; 
    }
  }

  onMount(() => {
    console.log("[Popup] Component mounted. Adding storage listener.");
    isMounted = true;
    
    // Check if first visit before loading data
    checkFirstVisit().then(() => {
      // Load interpretation data after checking visit status
      loadInterpretationData();
    });
  });

  onDestroy(() => {
    console.log("[Popup] Component destroying. Removing storage listener.");
    isMounted = false;
    // Remove ONLY storage listener
    // chrome.storage.onChanged.removeListener(handleStorageChange);
  });

</script>

<main>
  {#if isLoading}
    <p class="loading-message">Loading interpretation...</p>
  {:else if errorLoading}
    <div class="error-container">
        <p class="error">⚠️ Error: {errorLoading}</p>
        <p class="error-suggestion">Please try again.</p>
    </div>
  {:else if interpretationData && originalTarget}
    <div class="result-card">
        <!-- Display Original Target -->
        <div class="original-target">
            {#if originalTarget.type === 'selection' && originalTarget.selectionText}
                <div class="original-text">
                    "{originalTarget.selectionText}"
                </div>
            {:else if originalTarget.type === 'image' && originalTarget.srcUrl}
                <div class="original-image">
                    {#if imageLoadError}
                        <p class="image-error">🖼️ Could not load image.</p>
                    {:else}
                        <img 
                            src={originalTarget.srcUrl} 
                            alt="Original content interpreted" 
                            title="Original Image" 
                            loading="lazy" 
                            on:error={handleImageError} 
                        />
                    {/if}
                </div>
            {:else if originalTarget.type === 'link' && originalTarget.srcUrl}
                <div class="original-link">
                    🔗 <a href={originalTarget.srcUrl} target="_blank" title="Original Link (opens in new tab)">{originalTarget.srcUrl}</a>
                </div>
             {:else if originalTarget.type === 'page' && originalTarget.pageUrl}
                <div class="original-page">
                    📄 Page: <a href={originalTarget.pageUrl} target="_blank" title="Interpreted Page (opens in new tab)">{originalTarget.pageUrl}</a>
                </div>
            {:else}
                 <p class="fallback-target"><em>Interpreted item type: {originalTarget.type} (No preview available)</em></p>
            {/if}
        </div>

        <!-- Display Interpretation -->
        <p class="interpretation-text">{interpretationData.interpretation}</p>

        <!-- Display Tone, Confidence, and Context Explanation -->
        <div class="details-section">
            <div class="detail-item tone-item">
                <span class="detail-label">Tone:</span>
                <span
                    class="detail-value tone-value tone-{interpretationData.tone.toLowerCase().replace(/\s+/g, '-')}"
                >
                    {interpretationData.tone}
                </span>
            </div>
            <div class="detail-item confidence-item">
                 <span class="detail-label">Confidence:</span>
                <span
                    class="detail-value confidence-value {getConfidenceClass(interpretationData.confidence)}"
                    title="Confidence: {(interpretationData.confidence * 100).toFixed(0)}%"
                >
                    {(interpretationData.confidence * 100).toFixed(0)}%
                </span>
            </div>
            
            <!-- Wrapper for the button to control its layout within flex container -->
            <div class="button-wrapper">
                <button on:click={handleAnalyzeContext} title="Show/Hide how context influenced the interpretation">
                    {showContextSummary ? 'Hide Context' : 'Explain Context'}
                </button>
            </div>
        </div>

        <!-- Conditionally Display Context Summary -->
        {#if showContextSummary && interpretationData?.contextSummary}
        <div class="context-summary">
            <p><strong>Context Explanation:</strong> {interpretationData.contextSummary}</p>
        </div>
        {/if}
    </div>
  {:else if isFirstVisit}
    <div class="welcome">
      <h2>Welcome to TIPS!</h2>
      <p class="welcome-start">Interpret something to get started!<br>💡</p>
    </div>
  {:else}
    <!-- Default message when no interpretation is loaded and no error -->
    <div class="no-data">
        <p>TIPS</p>
        <p>Interpret text/images!</p>
        <p><small>Right-click or select text & click 💡. Check the extension icon (top-right) for status (⏳✅❗️).</small></p>
    </div>
  {/if}
</main>

<style>
  /* Global styles for the popup window itself (not content inside) */
  :global(html), :global(body) {
      margin: 0;
      padding: 0;
      background-color: transparent; 
  }

  /* CSS Variables for consistent theming */
  :root {
    --primary-color: #007bff; /* buttons, links, etc. */
    --background-color: #f8f9faee; /* Overall background of the popup content */
    --text-color: #212529; /* Default text color */
    --card-background: #f8f9faee; /* Background for the main result card */
    --border-color: #dee2e6; /* Borders for elements */
    --shadow-color: rgba(0, 0, 0, 0.1); /* Subtle shadows for depth */
    --error-color: #dc3545; /* Text color for error messages */
    --error-background: #f8d7da; /* Background color for error containers */
    --muted-text-color: #6c757d; /* Less prominent text (e.g., labels, hints) */
    --light-background: #f1f3f5; /* Background for quoted text or image containers */
    --link-color: #0056b3; /* Link color */

    /* Dynamic Colors based on Confidence Score */
    /* Uses a 10-step gradient from red (low confidence) to green (high confidence) */
    --confidence-0-bg: #b71c1c;
    --confidence-1-bg: #c62828;
    --confidence-2-bg: #d32f2f;
    --confidence-3-bg: #e53935;
    --confidence-4-bg: #f44336;
    --confidence-5-bg: #fb8c00;
    --confidence-6-bg: #ff8f00;
    --confidence-7-bg: #ffa000;
    --confidence-8-bg: #4caf50;
    --confidence-9-bg: #2e7d32;
    --confidence-text-color: #ffffff;
    --confidence-text-dark: #333333;

    /* Dynamic background colors based on detected Tone */
    /* Note: I tried getting the AI to provide a hex code but it did not achieve
       consistent results. So here we are. */
    --tone-humorous-bg: #ffc107;
    --tone-sarcastic-bg: #fd7e14;
    --tone-ironic-bg: #e88433;
    --tone-playful-bg: #ffab00;
    --tone-angry-bg: #dc3545;
    --tone-sad-bg: #6ea8fe;
    --tone-anxious-bg: #8884d8;
    --tone-calm-bg: #a9d5c4;
    --tone-enthusiastic-bg: #ff7f0e;
    --tone-helpful-bg: #20c997;
    --tone-dismissive-bg: #adb5bd;
    --tone-formal-bg: #0d6efd;
    --tone-casual-bg: #6c757d;
    --tone-neutral-bg: #ced4da;
    --tone-informative-bg: #0dcaf0;
    --tone-questioning-bg: #6f42c1;
    --tone-surprised-bg: #d63384;
    --tone-skeptical-bg: #808080;
    --tone-optimistic-bg: #ffe066;
    --tone-celebratory-bg: #f39c12;
    --tone-frustrated-bg: #d35400;
    --tone-fearful-bg: #7f8c8d;
    --tone-urgent-bg: #e63946;
    --tone-warning-bg: #f4a261;
    --tone-error-bg: #e74c3c;
    --tone-pensive-bg: #5c6bc0;
    --tone-reflective-bg: #8e44ad;
    --tone-melancholic-bg: #57606f;
    --tone-detached-bg: #dfe6e9;
    --tone-encouraging-bg: #27ae60;
    --tone-romantic-bg: #e83e8c;
    --tone-persuasive-bg: #8854d0;
    --tone-curious-bg: #3498db;
    --tone-serious-bg: #2f3640;
    --tone-authoritative-bg: #1e272e;
    --tone-mysterious-bg: #2e4057;
    --tone-nostalgic-bg: #f8c3b6;
    --tone-default-bg: #6c757d;
    --tone-text-color: #ffffff;
    --tone-text-dark: #333333;
  }

  /* Main container for the popup content */
  main {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--background-color);
    color: var(--text-color);
    min-width: 300px; 
    max-width: 500px;
    line-height: 1.5;
    box-shadow: none; 
    padding: 0; 
    display: flex;
    flex-direction: column; 
    overflow: hidden;
  }

  /* Container for the main interpretation result */
  .result-card {
    background-color: var(--card-background);
    border: none;
    border-radius: 0;
    margin: 0;
    padding: 15px;
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  /* Loading message style */
  .loading-message {
    padding: 20px;
    text-align: center;
    color: var(--muted-text-color);
    font-style: italic;
  }

  /* Container for error messages */
  .error-container {
      background-color: var(--error-background);
      color: var(--error-color);
      padding: 15px;
      border: 1px solid var(--error-color);
      border-radius: 4px;
      margin: 10px;
  }

  /* General error text */
  .error {
      margin: 0 0 5px 0; 
      font-weight: bold;
  }

  /* Suggestion text within the error container */
  .error-suggestion {
      font-size: 0.9em;
      margin: 0;
  }

  /* Section displaying the original content (text, image, link) */
  .original-target {
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 15px;
    margin-bottom: 15px;
  }

  /* Style for quoted original text selection */
  .original-text {
    font-style: italic;
    background-color: var(--light-background);
    padding: 10px;
    border-radius: 4px;
    color: var(--muted-text-color);
    word-wrap: break-word;
  }

  /* Container for the original image */
  .original-image {
    text-align: center;
    background-color: var(--light-background);
    padding: 10px;
    border-radius: 4px;
  }

  /* Style for the original image itself */
  .original-image img {
    max-width: 100%;
    max-height: 150px;
    display: block;
    margin: 0 auto;
    border-radius: 3px;
  }

  /* Error message when image fails to load */
  .image-error {
    color: var(--error-color);
    font-style: italic;
  }

  /* Style for displaying the original link */
  .original-link, .original-page {
    font-size: 0.9em;
    color: var(--muted-text-color);
    word-wrap: break-word;
  }

  /* Styling for links within the original target section */
  .original-link a, .original-page a {
    color: var(--link-color);
    text-decoration: none;
  }
  .original-link a:hover, .original-page a:hover {
    text-decoration: underline;
  }

  /* Fallback text if original content type is unknown or can't be previewed */
  .fallback-target {
      font-size: 0.9em;
      color: var(--muted-text-color);
      font-style: italic;
  }

  /* Main interpretation text */
  .interpretation-text {
    margin: 0;
    font-size: 1.05em;
    line-height: 1.6;
  }

  /* Section containing Tone and Confidence */
  .details-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 0.9em;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
  }

  /* Individual item within the details section (e.g., Tone, Confidence) */
  .detail-item {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  /* Label text (e.g., "Tone:", "Confidence:") */
  .detail-label {
    color: var(--muted-text-color);
    font-weight: 500;
  }

  /* Value display (e.g., the actual tone or confidence percentage) */
  .detail-value {
    padding: 3px 8px;
    border-radius: 12px;
    font-weight: 600;
  }

  /* Specific styling for the confidence value badge */
  .confidence-value {
      min-width: 45px;
      text-align: center;
  }

  /* Dynamically applied confidence classes (background and text color) */
  /* Background colors are defined in :root */
  .confidence-0 { background-color: var(--confidence-0-bg); color: var(--confidence-text-color); }
  .confidence-1 { background-color: var(--confidence-1-bg); color: var(--confidence-text-color); }
  .confidence-2 { background-color: var(--confidence-2-bg); color: var(--confidence-text-color); }
  .confidence-3 { background-color: var(--confidence-3-bg); color: var(--confidence-text-color); }
  .confidence-4 { background-color: var(--confidence-4-bg); color: var(--confidence-text-dark); } 
  .confidence-5 { background-color: var(--confidence-5-bg); color: var(--confidence-text-dark); } 
  .confidence-6 { background-color: var(--confidence-6-bg); color: var(--confidence-text-dark); } 
  .confidence-7 { background-color: var(--confidence-7-bg); color: var(--confidence-text-dark); } 
  .confidence-8 { background-color: var(--confidence-8-bg); color: var(--confidence-text-color); }
  .confidence-9 { background-color: var(--confidence-9-bg); color: var(--confidence-text-color); }

  /* Dynamically applied tone classes (background and text color) */
  /* Default background and text color for all tones, overridden by specific rules below */
  .tone-value { 
    color: var(--tone-text-color); 
    background-color: var(--tone-default-bg); /* Default background */
  }

  /* Specific tones needing dark text (override default text color) */
  .tone-humorous { background-color: var(--tone-humorous-bg); color: var(--tone-text-dark); }
  .tone-playful { background-color: var(--tone-playful-bg); color: var(--tone-text-dark); }
  .tone-calm { background-color: var(--tone-calm-bg); color: var(--tone-text-dark); }
  .tone-neutral { background-color: var(--tone-neutral-bg); color: var(--tone-text-dark); }
  .tone-informative { background-color: var(--tone-informative-bg); color: var(--tone-text-dark); }
  .tone-optimistic { background-color: var(--tone-optimistic-bg); color: var(--tone-text-dark); }
  .tone-celebratory { background-color: var(--tone-celebratory-bg); color: var(--tone-text-dark); }
  .tone-warning { background-color: var(--tone-warning-bg); color: var(--tone-text-dark); }
  .tone-detached { background-color: var(--tone-detached-bg); color: var(--tone-text-dark); }
  .tone-nostalgic { background-color: var(--tone-nostalgic-bg); color: var(--tone-text-dark); }

  /* Tones using default white text (override default background) */
  .tone-sarcastic { background-color: var(--tone-sarcastic-bg); }
  .tone-ironic { background-color: var(--tone-ironic-bg); }
  .tone-angry { background-color: var(--tone-angry-bg); }
  .tone-sad { background-color: var(--tone-sad-bg); }
  .tone-anxious { background-color: var(--tone-anxious-bg); }
  .tone-enthusiastic { background-color: var(--tone-enthusiastic-bg); }
  .tone-helpful { background-color: var(--tone-helpful-bg); }
  .tone-dismissive { background-color: var(--tone-dismissive-bg); }
  .tone-formal { background-color: var(--tone-formal-bg); }
  .tone-casual { background-color: var(--tone-casual-bg); }
  .tone-questioning { background-color: var(--tone-questioning-bg); }
  .tone-surprised { background-color: var(--tone-surprised-bg); }
  .tone-skeptical { background-color: var(--tone-skeptical-bg); }
  .tone-frustrated { background-color: var(--tone-frustrated-bg); }
  .tone-fearful { background-color: var(--tone-fearful-bg); }
  .tone-urgent { background-color: var(--tone-urgent-bg); }
  .tone-error { background-color: var(--tone-error-bg); }
  .tone-pensive { background-color: var(--tone-pensive-bg); }
  .tone-reflective { background-color: var(--tone-reflective-bg); }
  .tone-melancholic { background-color: var(--tone-melancholic-bg); }
  .tone-encouraging { background-color: var(--tone-encouraging-bg); }
  .tone-romantic { background-color: var(--tone-romantic-bg); }
  .tone-persuasive { background-color: var(--tone-persuasive-bg); }
  .tone-curious { background-color: var(--tone-curious-bg); }
  .tone-serious { background-color: var(--tone-serious-bg); }
  .tone-authoritative { background-color: var(--tone-authoritative-bg); }
  .tone-mysterious { background-color: var(--tone-mysterious-bg); }

  /* Wrapper for the button inside details-section */
  .button-wrapper {
    flex-basis: 100%; 
    text-align: center; 
    margin-top: 10px;
  }

  /* Styling for buttons */
  button {
      background-color: var(--primary-color);
      color: white;
      border: none;
      padding: 8px 15px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9em;
      transition: background-color 0.2s ease;
  }

  button:hover {
      background-color: #0056b3;
  }

  button:active {
       background-color: #004085; 
  }

  /* Container for the context summary explanation */
  .context-summary {
      margin-top: 10px;
      padding: 10px;
      background-color: var(--light-background);
      border-radius: 4px;
      font-size: 0.9em;
      color: var(--muted-text-color);
      border: 1px dashed var(--border-color);
  }

  .context-summary p {
      margin: 0;
  }

  .context-summary strong {
      color: var(--text-color);
  }

  /* Style for the default message shown when no interpretation is loaded */
  .no-data {
    padding: 20px;
    text-align: center;
    color: var(--muted-text-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }

  .no-data p {
      margin: 0;
  }

  /* Larger icon for the default message */
  .no-data p:first-child {
      font-size: 2em;
      margin-bottom: 5px;
  }

  .no-data small {
    font-size: 0.85em;
    max-width: 80%;
  }

  /* Add welcome styles */
  .welcome {
    padding: 20px;
    text-align: center;
    color: var(--text-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .welcome h2 {
    margin: 0;
    color: var(--primary-color);
    font-size: 1.5em;
  }

  .welcome-steps {
    background-color: var(--light-background);
    padding: 10px 15px;
    border-radius: 8px;
    text-align: left;
    margin: 10px 0;
    width: 90%;
  }

  .welcome-start {
    font-weight: bold;
    color: var(--primary-color);
    font-size: 1.1em;
  }
</style>