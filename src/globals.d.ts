import type { LocalePack } from "./types.ts";

declare global {
  var __NEXO_DISABLE_AUTO_START__: boolean | undefined;
  var __NEXO_LOCALE_PACK__: LocalePack | undefined;
  interface Window {
    __nexoDocumentSentinel?: boolean;
    __nexoHostPageSentinel?: boolean;
  }
}

export {};
