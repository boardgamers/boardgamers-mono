<script lang="ts">
  let { class: className = "", style = "", size = "1em", ...rest }: { class?: string; style?: string; size?: string; [key: string]: any } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 16 16"
  width={size}
  height={size}
  fill="currentColor"
  class={className}
  style={style}
  aria-hidden="true"
  {...rest}
>
  <path d="M8 15A7 7 0 1 0 8 1v14zm0 1A8 8 0 1 1 8 0a8 8 0 0 1 0 16z" />
</svg>
