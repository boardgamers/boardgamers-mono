import type { Readable } from "svelte/store";

export type RemoveReadable<T> = T extends Readable<infer U> ? U : T;
