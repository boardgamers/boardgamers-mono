interface ImportMetaEnv {
  readonly VITE_MESSAGE: string;
  readonly VITE_backend: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  // Injected by vite.config.ts (`define.__APP_RELEASE__`).
  const __APP_RELEASE__: string;

  namespace App {
    interface Locals {
      ip: string;
      host: string;
      refreshToken: { code: string; expiresAt: number } | null;
      sidebarOpen: boolean | undefined;
    }

    interface PageData {
      user?: import("@bgs/models").UserFront | null;
      activeGames?: string[];
    }

    interface Error {
      message: string;
    }
  }
}

export {};
