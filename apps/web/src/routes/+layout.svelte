<script lang="ts">
  import { Notifications } from "@/components";

  let { children } = $props();
</script>

{@render children()}

<Notifications />
