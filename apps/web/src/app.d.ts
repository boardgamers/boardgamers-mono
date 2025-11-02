// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {
    // 	message: string;
    // 	code?: number | string;
    // }
    interface Locals {
      requestId: string;
      sidebarOpen: boolean;
      refreshToken: { code: string; expiresAt: number } | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
