import type { IUser } from "@lib/user";
import { writable } from "svelte/store";

export const user = writable<IUser | null>(null);
