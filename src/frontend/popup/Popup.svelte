<script lang="ts">
  import { onMount } from 'svelte';

  interface InterpretationData {
    text: string;
    confidence: number;
    tone: string;
  }

  interface StoredData {
    interpretation: InterpretationData;
    originalSelection: string;
    originalContext: { // Assuming context structure from background.ts
      url: string;
      title: string;
      precedingText?: string;
      succeedingText?: string;
    };
  }

  let isLoading = true;
  let interpretation: InterpretationData | null = null;
  let errorLoading = false;
  let originalSelection: string | null = null; // Store original selection for context

  onMount(async () => {
    try {
      const result = await chrome.storage.local.get('lastInterpretation');
      if (result.lastInterpretation) {
        const storedData = result.lastInterpretation as StoredData;
        // Validate the structure slightly, including tone
        if (storedData.interpretation &&
            typeof storedData.interpretation.text === 'string' &&
            typeof storedData.interpretation.confidence === 'number' &&
            typeof storedData.interpretation.tone === 'string')
        {
            interpretation = storedData.interpretation;
            originalSelection = storedData.originalSelection; // Keep original text if needed later
            console.log("Loaded interpretation:", interpretation);
            console.log("Original selection:", originalSelection);
        } else {
             console.warn("Stored data structure is invalid:", storedData);
             errorLoading = true; // Or handle differently
        }
      } else {
        console.log("No interpretation data found in storage.");
      }
    } catch (e) {
      console.error("Error loading interpretation from storage:", e);
      errorLoading = true;
    } finally {
      isLoading = false;
    }
  });

  // Function to get color based on confidence
  function getConfidenceColor(confidence: number): string {
    // Clamp confidence between 0 and 1
    const clampedConfidence = Math.max(0, Math.min(1, confidence));
    // Interpolate HSL color: 0 (red) -> 120 (green) -> 240 (blue)
    // Let's go Red (0) -> Yellow (60) -> Green (120) -> Cyan (180) -> Blue (240)
    // We want Red for low (<0.3), Yellow/Orange (~0.5), Green/Blue for high (>0.7)
    const hue = clampedConfidence * 180; // Hue ranges from 0 (Red) to 180 (Cyan/Blue-ish)
    const saturation = 90; // Keep saturation high
    const lightness = 50; // Keep lightness moderate
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  function handleAnalyzeContext() {
      console.log("Analyze Context clicked - sending message...");
       // TODO: Implement sending message to background for context analysis
      alert("Contextual meaning analysis not yet implemented.");
  }

</script>

<main>
  {#if isLoading}
    <p>Loading interpretation...</p>
  {:else if errorLoading}
    <p class="error">Error loading interpretation. Please try again.</p>
  {:else if interpretation}
    <div class="result-card">
        {#if originalSelection}
            <div class="original-text">
                <!-- <strong>Selected:</strong> --> "{originalSelection}"
            </div>
        {/if}
        <p class="interpretation-text">{interpretation.text}</p>
        <div class="confidence-section">
            <!-- Display Tone first -->
            <span class="tone-label">Tone:</span>
            <span class="tone-value">{interpretation.tone}</span>

            <!-- Display Confidence next -->
            <span class="confidence-label">Confidence:</span>
            <span
                class="confidence-value"
                style="--confidence-color: {getConfidenceColor(interpretation.confidence)};"
                title="Confidence: {(interpretation.confidence * 100).toFixed(0)}%"
            >
                {(interpretation.confidence * 100).toFixed(0)}%
            </span>
        </div>
        <div class="actions">
            <!-- Remove Explain Tone button -->
            <!-- <button on:click={handleAnalyzeTone} title="Explain the tone of the selected text">Explain Tone</button> -->
            <button on:click={handleAnalyzeContext} title="Explain the meaning considering surrounding context">Explain Context</button>
            <!-- Add more actions later -->
        </div>
    </div>
  {:else}
    <div class="no-data">
        <p>💡</p>
        <p>Highlight text on a webpage and click 'Interpret' (I) from the menu that appears.</p>
        <p><small>No interpretation data found.</small></p>
    </div>
  {/if}
</main>

<style>
  :root {
    --primary-color: #007bff; /* Example primary color */
    --background-color: #f8f9fa;
    --text-color: #212529;
    --card-background: #ffffff;
    --border-color: #dee2e6;
    --shadow-color: rgba(0, 0, 0, 0.1);
    --error-color: #dc3545;
  }

  main {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 1rem;
    background-color: var(--background-color);
    color: var(--text-color);
    min-width: 300px; /* Slightly wider for better layout */
    max-width: 450px;
    line-height: 1.5;
  }

  .error {
    color: var(--error-color);
    font-weight: bold;
  }

  .result-card {
    background-color: var(--card-background);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 1rem 1.25rem; /* Increased horizontal padding */
    box-shadow: 0 3px 7px var(--shadow-color); /* Slightly adjusted shadow */
    margin-top: 0; /* Remove top margin if it's the only element */
    display: flex; /* Use flexbox for layout */
    flex-direction: column;
    gap: 1rem; /* Add gap between flex items */
  }

  .original-text {
    font-size: 0.9em; /* Slightly larger */
    color: #495057; /* Darker grey */
    /* margin-bottom: 0.75rem; */ /* Replaced by gap */
    border-left: 3px solid #adb5bd; /* Muted border color */
    padding: 0.25rem 0.75rem; /* Adjusted padding */
    font-style: italic;
    max-height: 6em; /* Allow slightly more height */
    overflow-y: auto;
    background-color: #f8f9fa; /* Very light background */
    border-radius: 0 4px 4px 0; /* Rounded corners on right */
  }

  .interpretation-text {
    font-size: 1.05em; /* Slightly larger main text */
    /* margin-bottom: 1rem; */ /* Replaced by gap */
    line-height: 1.6;
    flex-grow: 1; /* Allow text to take available space */
  }

  .confidence-section {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    font-size: 0.9em;
    /* margin-bottom: 1rem; */ /* Replaced by gap */
    /* border-top: 1px solid var(--border-color); */ /* Remove top border */
    /* padding-top: 0.75rem; */ /* Remove top padding */
    margin-top: auto; /* Push to bottom if flex allows */
    gap: 0.75rem; /* Add gap between items */
  }

  .tone-label,
  .confidence-label {
    color: #6c757d; /* Use a slightly muted color for labels */
  }

  .tone-value {
    font-weight: bold;
    padding: 0.2em 0.5em;
    border-radius: 4px;
    background-color: #e9ecef; /* Match button background */
    color: #495057; /* Match button text */
    text-transform: capitalize; /* Capitalize the first letter */
  }

  .confidence-value {
    font-weight: bold;
    padding: 0.2em 0.5em;
    border-radius: 4px;
    color: white; /* Text color contrasts with background */
    background-color: var(--confidence-color);
    min-width: 40px; /* Ensure minimum width */
    text-align: center;
  }

  .actions {
    display: flex;
    gap: 0.75rem; /* Increased gap */
    justify-content: flex-start;
    /* margin-top: 0.5rem; */ /* Replaced by gap */
    padding-top: 0.5rem; /* Add padding above buttons */
    border-top: 1px solid var(--border-color); /* Add border above actions */
  }

  button {
    background-color: #e9ecef; /* Lighter background */
    color: #495057; /* Darker text */
    border: 1px solid #ced4da; /* Match tone background border */
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
    transition: background-color 0.2s ease, border-color 0.2s ease;
  }

  button:hover {
    background-color: #dee2e6;
    border-color: #adb5bd;
  }

  .no-data {
      text-align: center;
      color: #6c757d;
      padding: 1rem;
  }
  .no-data p:first-child {
      font-size: 2em; /* Larger icon */
      margin-bottom: 0.5rem;
  }
  .no-data p {
      margin: 0.2rem 0;
  }

</style>
