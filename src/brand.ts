import type { LocalePack } from "./types.ts";

/**
 * The public product name. Change this value when a host CMS skins the game.
 * Technical `nexo` identifiers are retained for existing installations.
 */
export const BRAND_NAME = "Entre Paréntesis";

export function applyBrandName(locale: LocalePack): LocalePack {
  return {
    ...locale,
    ui: Object.fromEntries(
      Object.entries(locale.ui).map(([key, value]) => [
        key,
        value.replaceAll("{gameName}", BRAND_NAME)
      ])
    )
  };
}
