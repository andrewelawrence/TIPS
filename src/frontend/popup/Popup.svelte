<script lang="ts">
  // Basic Svelte component script block
  let message = "Hello from TIPS Popup!";
</script>

<main>
  <h1>{message}</h1>
  <p>This is the placeholder for the TIPS extension popup.</p>
</main>

<style>
  main {
    font-family: sans-serif;
    padding: 1em;
    max-width: 250px; /* Example constraint */
  }
  h1 {
    color: #333;
  }
</style>
