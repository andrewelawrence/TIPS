<script lang="ts">
  import { onMount } from 'svelte';

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

  let isLoading = true;
  let interpretationData: InterpretationData | null = null;
  let originalTarget: TargetInfo | null = null;
  let errorLoading: string | null = null; 
  let imageLoadError = false; 
  let showContextSummary = false; 

  /* Helper to get confidence class based on score */
  function getConfidenceClass(score: number): string {
    const level = Math.floor(score * 10); 
    const adjustedLevel = Math.min(level, 9);
    return `confidence-${adjustedLevel}`;
  }

  onMount(async () => {
    try {
      const result = await chrome.storage.local.get('lastInterpretation');
      console.log("Raw data from storage:", result);

      if (result.lastInterpretation) {
        const storedData = result.lastInterpretation as StoredData; 
        console.log("Parsed storedData:", storedData);

        /* More robust validation */
        if (
          storedData &&
          storedData.interpretation &&
          typeof storedData.interpretation.interpretation === 'string' &&
          typeof storedData.interpretation.confidence === 'number' &&
          typeof storedData.interpretation.tone === 'string' &&
          typeof storedData.originalTarget.type === 'string' && 
          typeof storedData.interpretation.contextSummary === 'string'
        ) {
          interpretationData = storedData.interpretation;
          originalTarget = storedData.originalTarget;
          console.log("Loaded interpretation:", interpretationData);
          console.log("Original target:", originalTarget);
        } else {
          console.warn("Stored data structure is invalid or incomplete:", storedData);
          errorLoading = "Couldn't load interpretation: Data format is invalid.";
        }
      } else {
        console.log("No interpretation data found in storage.");
      }
    } catch (e: any) {
      console.error("Error loading interpretation from storage:", e);
      errorLoading = `Couldn't load interpretation: ${e.message || 'Storage access failed'}`;
    } finally {
      isLoading = false;
    }
  });

  function handleImageError() {
    console.warn("Image failed to load:", originalTarget?.srcUrl);
    imageLoadError = true;
  }

  function handleAnalyzeContext() {
      console.log("Analyze Context button clicked.");
      showContextSummary = !showContextSummary; 
  }

</script>

<main>
  {#if isLoading}
    <p class="loading-message">Loading interpretation...</p>
  {:else if errorLoading}
    <div class="error-container">
        <p class="error">⚠️ {errorLoading}</p>
        <p class="error-suggestion">Interpretation failed. Please try again.</p>
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
  {:else}
    <!-- Default message when no interpretation is loaded -->
    <div class="no-data">
        <p>💡</p>
        <p>Ready to interpret!</p> 
        <p><small>Use the context menu (right-click) on text, images, links, or the page itself.</small></p>
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
    --confidence-0-bg: #d32f2f;
    --confidence-1-bg: #dd402c;
    --confidence-2-bg: #e65100;
    --confidence-3-bg: #f57c00;
    --confidence-4-bg: #ffa000;
    --confidence-5-bg: #ffb300;
    --confidence-6-bg: #c0ca33;
    --confidence-7-bg: #7cb342;
    --confidence-8-bg: #4caf50;
    --confidence-9-bg: #2e7d32;
    --confidence-text-color: #ffffff;
    --confidence-text-dark: #333333;

    /* Dynamic background colors based on detected Tone */
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
    --tone-default-bg: #6c757d;
    --tone-text-color: #ffffff; 
    --tone-text-dark: #333333; 
  }

  /* Main container for the popup content */
  main {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--background-color); /* Use variable */
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
  /* Backgrounds defined in :root. Most use white text. */
  .tone-value { color: var(--tone-text-color); }

  /* Specific tones needing dark text */
  .tone-humorous { background-color: var(--tone-humorous-bg); color: var(--tone-text-dark); }
  .tone-playful { background-color: var(--tone-playful-bg); color: var(--tone-text-dark); }
  .tone-calm { background-color: var(--tone-calm-bg); color: var(--tone-text-dark); }
  .tone-neutral { background-color: var(--tone-neutral-bg); color: var(--tone-text-dark); }
  .tone-informative { background-color: var(--tone-informative-bg); color: var(--tone-text-dark); }

  /* Tones using default white text */
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

  /* Fallback for unmapped tones */
  .tone-value:not([class*="tone-"]) { 
      background-color: var(--tone-default-bg);
      color: var(--tone-text-color);
  }

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
</style>
