import { useEventBus } from "@vueuse/core";

export const notifications = useEventBus<{ type: "info" | "success" | "error"; message: string }>("notifications");
