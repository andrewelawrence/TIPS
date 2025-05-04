<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { TargetInfo, InterpretationData, StoredData } from "../types";

  let isFirstVisit = true;
  let isLoading = true;
  let interpretationData: InterpretationData | null = null;
  let originalTarget: TargetInfo | null = null;
  let errorLoading: string | null = null;
  let imageLoadError = false;
  let showContextSummary = false;
  let isMounted = false;

  function getConfidenceClass(score: number): string {
    const level = Math.floor(score * 10);
    const adjustedLevel = Math.min(level, 9);
    return `confidence-${adjustedLevel}`;
  }

  function handleImageError() {
    imageLoadError = true;
  }

  function handleAnalyzeContext() {
    showContextSummary = !showContextSummary;
  }

  async function loadInterpretationData() {
    if (!isMounted) {
      return;
    }
    isLoading = true;
    errorLoading = null;
    imageLoadError = false;
    showContextSummary = false;

    try {
      const result = await chrome.storage.local.get("lastInterpretation");

      if (result.lastInterpretation) {
        const storedData = result.lastInterpretation as StoredData;

        if (
          storedData &&
          storedData.interpretation &&
          typeof storedData.interpretation.interpretation === "string" &&
          typeof storedData.interpretation.confidence === "number" &&
          typeof storedData.interpretation.tone === "string" &&
          storedData.originalTarget &&
          typeof storedData.originalTarget.type === "string" &&
          typeof storedData.interpretation.contextSummary === "string"
        ) {
          interpretationData = storedData.interpretation;
          originalTarget = storedData.originalTarget;
          errorLoading = null;
        } else {
          errorLoading = "Data format invalid.";
          interpretationData = null;
          originalTarget = null;
        }
      } else {
        errorLoading = null;
        interpretationData = null;
        originalTarget = null;
      }
    } catch (e: any) {
      errorLoading = `Storage access failed: ${e.message || "Unknown error"}`;
      interpretationData = null;
      originalTarget = null;
    } finally {
      if (isMounted) {
        isLoading = false;
      }
    }
  }

  async function checkFirstVisit() {
    try {
      const result = await chrome.storage.local.get("hasVisitedBefore");
      isFirstVisit = !result.hasVisitedBefore;

      if (isFirstVisit) {
        chrome.storage.local.set({ hasVisitedBefore: true });
      }
    } catch (e) {
      isFirstVisit = false;
    }
  }

  onMount(() => {
    isMounted = true;

    checkFirstVisit().then(() => {
      loadInterpretationData();
    });
  });

  onDestroy(() => {
    isMounted = false;
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
      <div class="original-target">
        {#if originalTarget.type === "selection" && originalTarget.selectionText}
          <div class="original-text">
            "{originalTarget.selectionText}"
          </div>
        {:else if originalTarget.type === "image" && originalTarget.srcUrl}
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
        {:else if originalTarget.type === "link" && originalTarget.srcUrl}
          <div class="original-link">
            🔗 <a
              href={originalTarget.srcUrl}
              target="_blank"
              title="Original Link (opens in new tab)"
              >{originalTarget.srcUrl}</a
            >
          </div>
        {:else if originalTarget.type === "page" && originalTarget.pageUrl}
          <div class="original-page">
            📄 Page: <a
              href={originalTarget.pageUrl}
              target="_blank"
              title="Interpreted Page (opens in new tab)"
              >{originalTarget.pageUrl}</a
            >
          </div>
        {:else}
          <p class="fallback-target">
            <em
              >Interpreted item type: {originalTarget.type} (No preview available)</em
            >
          </p>
        {/if}
      </div>

      <p class="interpretation-text">{interpretationData.interpretation}</p>

      <div class="details-section">
        <div class="detail-item tone-item">
          <span class="detail-label">Tone:</span>
          <span
            class="detail-value tone-value tone-{interpretationData.tone
              .toLowerCase()
              .replace(/\s+/g, '-')}"
          >
            {interpretationData.tone}
          </span>
        </div>
        <div class="detail-item confidence-item">
          <span class="detail-label">Confidence:</span>
          <span
            class="detail-value confidence-value {getConfidenceClass(
              interpretationData.confidence
            )}"
            title="Confidence: {(interpretationData.confidence * 100).toFixed(
              0
            )}%"
          >
            {(interpretationData.confidence * 100).toFixed(0)}%
          </span>
        </div>

        <div class="button-wrapper">
          <button
            on:click={handleAnalyzeContext}
            title="Show/Hide how context influenced the interpretation"
          >
            {showContextSummary ? "Hide Context" : "Explain Context"}
          </button>
        </div>
      </div>

      {#if showContextSummary && interpretationData?.contextSummary}
        <div class="context-summary">
          <p>
            <strong>Context Explanation:</strong>
            {interpretationData.contextSummary}
          </p>
        </div>
      {/if}
    </div>
  {:else if isFirstVisit}
    <div class="welcome">
      <h2>Welcome to TIPS!</h2>
      <p class="welcome-start">Interpret something to get started!<br />💡</p>
    </div>
  {:else}
    <div class="no-data">
      <p>TIPS</p>
      <p>Interpret text/images!</p>
      <p>
        <small
          >Right-click or select text & click 💡. Check the extension icon
          (top-right) for status (⏳✅❗️).</small
        >
      </p>
    </div>
  {/if}
</main>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    background-color: transparent;
  }

  :global(body) {
    transition: background-color 0.3s ease;
  }

  :root {
    --primary-color: #007bff;
    --text-color: #212529;
    --main-background: linear-gradient(135deg, rgba(248, 249, 250, 0.85), rgba(233, 236, 239, 0.9));
    --card-background: rgba(255, 255, 255, 0.95);
    --border-color: rgba(222, 226, 230, 0.5);
    --shadow-color: rgba(0, 0, 0, 0.08);
    --muted-text-color: #6c757d;
    --light-background: rgba(241, 243, 245, 0.9);
    --link-color: #0056b3;
    --error-background: #f8d7da;
    --error-color: #721c24;

    /* Other variables */
    --border-radius-sm: 6px;
    --border-radius-md: 10px;
    --border-radius-lg: 14px;
    --transition-fast: 0.2s ease;
    --transition-normal: 0.3s ease;
    --box-shadow: 0 2px 10px var(--shadow-color);

    /* Confidence Colors */
    --confidence-0-bg: #dc3545;
    --confidence-1-bg: #e54848;
    --confidence-2-bg: #ec5a50;
    --confidence-3-bg: #f26c58;
    --confidence-4-bg: #f77e60;
    --confidence-5-bg: #ff8c42;
    --confidence-6-bg: #ffa500;
    --confidence-7-bg: #ffbf00;
    --confidence-8-bg: #addfad;
    --confidence-9-bg: #28a745;
    --confidence-text-color: #ffffff;

    /* Tone Colors */
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
  }

  main {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    color: var(--text-color);
    min-width: 300px;
    max-width: 500px;
    line-height: 1.5;
    box-shadow: var(--box-shadow);
    padding: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: background-color var(--transition-normal);
    border-radius: var(--border-radius-lg);
    background: var(--main-background);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .result-card,
  .welcome,
  .no-data,
  .error-container {
    border-radius: var(--border-radius-md);
    background-color: var(--card-background);
    box-shadow: var(--box-shadow);
    padding: 16px;
    transition: background-color var(--transition-normal);
  }

  .result-card {
    gap: 13px;
    display: flex;
    flex-direction: column;
  }

  .welcome,
  .no-data {
    text-align: center;
    color: var(--muted-text-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .error-container {
    color: var(--error-color);
    border: 1px solid var(--border-color);
  }

  .loading-message {
    padding: 22px;
    text-align: center;
    color: var(--muted-text-color);
    font-style: italic;
    animation: pulse 1.5s infinite alternate;
  }

  @keyframes pulse {
    from {
      opacity: 0.7;
    }
    to {
      opacity: 1;
    }
  }

  .error {
    margin: 0 0 5px 0;
    font-weight: bold;
  }

  .error-suggestion {
    font-size: 0.9em;
    margin: 0;
  }

  .original-target {
    padding-bottom: 13px;
    margin-bottom: 13px;
  }

  .original-text {
    font-style: italic;
    background-color: var(--light-background);
    padding: 10px;
    border-radius: var(--border-radius-md);
    color: var(--muted-text-color);
    word-wrap: break-word;
    box-shadow: 0 1px 3px var(--shadow-color);
    transition: box-shadow var(--transition-fast);
  }

  .original-text:hover {
    box-shadow: 0 2px 5px var(--shadow-color);
  }

  .original-image {
    text-align: center;
    background-color: var(--light-background);
    padding: 10px;
    border-radius: var(--border-radius-md);
    box-shadow: 0 1px 3px var(--shadow-color);
    transition:
      transform var(--transition-normal),
      box-shadow var(--transition-normal);
  }

  .original-image:hover {
    transform: translateY(-2px);
    box-shadow: 0 3px 8px var(--shadow-color);
  }

  .original-image img {
    max-width: 100%;
    max-height: 150px;
    display: block;
    margin: 0 auto;
    border-radius: var(--border-radius-sm);
    transition: transform var(--transition-fast);
  }

  .original-image:hover img {
    transform: scale(1.02);
  }

  .image-error {
    color: var(--error-color);
    font-style: italic;
  }

  .original-link,
  .original-page {
    font-size: 0.9em;
    color: var(--muted-text-color);
    word-wrap: break-word;
  }

  .original-link a,
  .original-page a {
    color: var(--link-color);
    text-decoration: none;
  }
  .original-link a:hover,
  .original-page a:hover {
    text-decoration: underline;
  }

  .fallback-target {
    font-size: 0.9em;
    color: var(--muted-text-color);
    font-style: italic;
  }

  .interpretation-text {
    margin: 0;
    font-size: 1.05em;
    line-height: 1.6;
  }

  .details-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px;
    margin-top: 9px;
    padding-top: 9px;
    font-size: 0.9em;
  }

  .detail-item {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .detail-label {
    color: var(--muted-text-color);
    font-weight: 500;
  }

  .detail-value {
    padding: 3px 8px;
    border-radius: 12px;
    font-weight: 600;
  }

  .confidence-value {
    min-width: 45px;
    text-align: center;
    color: var(--confidence-text-color);
  }

  .confidence-0 { background-color: var(--confidence-0-bg); }
  .confidence-1 { background-color: var(--confidence-1-bg); }
  .confidence-2 { background-color: var(--confidence-2-bg); }
  .confidence-3 { background-color: var(--confidence-3-bg); }
  .confidence-4 { background-color: var(--confidence-4-bg); color: var(--text-color); }
  .confidence-5 { background-color: var(--confidence-5-bg); color: var(--text-color); }
  .confidence-6 { background-color: var(--confidence-6-bg); color: var(--text-color); }
  .confidence-7 { background-color: var(--confidence-7-bg); color: var(--text-color); }
  .confidence-8 { background-color: var(--confidence-8-bg); color: var(--text-color); }
  .confidence-9 { background-color: var(--confidence-9-bg); }

  .tone-value {
    color: var(--tone-text-color);
    background-color: var(--tone-default-bg);
  }

  .tone-humorous {
    background-color: var(--tone-humorous-bg);
    color: var(--text-color);
  }
  .tone-playful {
    background-color: var(--tone-playful-bg);
    color: var(--text-color);
  }
  .tone-calm {
    background-color: var(--tone-calm-bg);
    color: var(--text-color);
  }
  .tone-neutral {
    background-color: var(--tone-neutral-bg);
    color: var(--text-color);
  }
  .tone-informative {
    background-color: var(--tone-informative-bg);
    color: var(--text-color);
  }
  .tone-optimistic {
    background-color: var(--tone-optimistic-bg);
    color: var(--text-color);
  }
  .tone-celebratory {
    background-color: var(--tone-celebratory-bg);
    color: var(--text-color);
  }
  .tone-warning {
    background-color: var(--tone-warning-bg);
    color: var(--text-color);
  }
  .tone-detached {
    background-color: var(--tone-detached-bg);
    color: var(--text-color);
  }
  .tone-nostalgic {
    background-color: var(--tone-nostalgic-bg);
    color: var(--text-color);
  }

  .tone-sarcastic {
    background-color: var(--tone-sarcastic-bg);
  }
  .tone-ironic {
    background-color: var(--tone-ironic-bg);
  }
  .tone-angry {
    background-color: var(--tone-angry-bg);
  }
  .tone-sad {
    background-color: var(--tone-sad-bg);
  }
  .tone-anxious {
    background-color: var(--tone-anxious-bg);
  }
  .tone-enthusiastic {
    background-color: var(--tone-enthusiastic-bg);
  }
  .tone-helpful {
    background-color: var(--tone-helpful-bg);
  }
  .tone-dismissive {
    background-color: var(--tone-dismissive-bg);
  }
  .tone-formal {
    background-color: var(--tone-formal-bg);
  }
  .tone-casual {
    background-color: var(--tone-casual-bg);
  }
  .tone-questioning {
    background-color: var(--tone-questioning-bg);
  }
  .tone-surprised {
    background-color: var(--tone-surprised-bg);
  }
  .tone-skeptical {
    background-color: var(--tone-skeptical-bg);
  }
  .tone-frustrated {
    background-color: var(--tone-frustrated-bg);
  }
  .tone-fearful {
    background-color: var(--tone-fearful-bg);
  }
  .tone-urgent {
    background-color: var(--tone-urgent-bg);
  }
  .tone-error {
    background-color: var(--tone-error-bg);
  }
  .tone-pensive {
    background-color: var(--tone-pensive-bg);
  }
  .tone-reflective {
    background-color: var(--tone-reflective-bg);
  }
  .tone-melancholic {
    background-color: var(--tone-melancholic-bg);
  }
  .tone-encouraging {
    background-color: var(--tone-encouraging-bg);
  }
  .tone-romantic {
    background-color: var(--tone-romantic-bg);
  }
  .tone-persuasive {
    background-color: var(--tone-persuasive-bg);
  }
  .tone-curious {
    background-color: var(--tone-curious-bg);
  }
  .tone-serious {
    background-color: var(--tone-serious-bg);
  }
  .tone-authoritative {
    background-color: var(--tone-authoritative-bg);
  }
  .tone-mysterious {
    background-color: var(--tone-mysterious-bg);
  }

  .button-wrapper {
    flex-basis: 100%;
    text-align: center;
    margin-top: 10px;
  }

  button {
    background-color: var(--primary-color);
    color: white;
    border: none;
    padding: 9px 18px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 0.95em;
    font-weight: 500;
    transition: all var(--transition-normal);
    box-shadow: 0 2px 5px rgba(0, 123, 255, 0.3);
  }

  button:hover {
    background-color: #0069d9;
    box-shadow: 0 4px 8px rgba(0, 123, 255, 0.4);
    transform: translateY(-2px);
  }

  button:active {
    background-color: #004085;
    box-shadow: 0 1px 3px rgba(0, 123, 255, 0.4);
    transform: translateY(0);
  }

  .context-summary {
    margin-top: 11px;
    padding: 12px;
    background-color: var(--light-background);
    border-radius: var(--border-radius-md);
    font-size: 0.95em;
    color: var(--muted-text-color);
    border: 1px dashed var(--border-color);
    box-shadow: 0 1px 3px var(--shadow-color);
    transition:
      box-shadow var(--transition-normal),
      transform var(--transition-normal);
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .context-summary:hover {
    box-shadow: 0 3px 8px var(--shadow-color);
    transform: translateY(-1px);
  }
  .context-summary p {
    margin: 0;
  }

  .context-summary strong {
    color: var(--text-color);
  }

  .no-data {
    padding: 25px;
    text-align: center;
    color: var(--muted-text-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    border-radius: var(--border-radius-lg);
    background-color: var(--card-background);
    box-shadow: var(--box-shadow);
    margin: 12px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .no-data p {
    margin: 0;
  }

  .no-data p:first-child {
    font-size: 2em;
    margin-bottom: 5px;
  }

  .no-data small {
    font-size: 0.85em;
    max-width: 80%;
  }

  .welcome {
    padding: 25px;
    text-align: center;
    color: var(--text-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    border-radius: var(--border-radius-lg);
    background-color: var(--card-background);
    box-shadow: var(--box-shadow);
    margin: 12px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
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
    font-size: 1.2em;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.03);
    animation: pulse 2s infinite alternate;
  }

  .welcome,
  .no-data {
    padding: 22px;
    gap: 10px;
  }
</style>
