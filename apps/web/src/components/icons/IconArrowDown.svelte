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
  <path fill-rule="evenodd" d="M8 1a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 13.293V1.5A.5.5 0 0 1 8 1z" />
</svg>
