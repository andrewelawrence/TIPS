import sveltePreprocess from 'svelte-preprocess';

export default {
  // Consult https://svelte.dev/docs#compile-time-svelte-preprocess
  // for more information about preprocessors
  preprocess: sveltePreprocess({
    // Enable TypeScript preprocessing
    typescript: true,
    // You can add other preprocessors here if needed (e.g., postcss for CSS)
  }),
}; 