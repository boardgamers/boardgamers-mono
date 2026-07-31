<script lang="ts">
  let { class: className = "", size = "1em" }: { class?: string; size?: string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 16 16"
  width={size}
  height={size}
  fill="currentColor"
  class={className}
  aria-hidden="true"
>
  <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
  <path fill-rule="evenodd" d="M14 14s-1-4-6-4-6 4-6 4 1 1 6 1 6-1 6-1z" />
</svg>
