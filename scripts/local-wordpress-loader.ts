export function renderWordPressDevLoader(locale: unknown): string {
  return `(function () {
  "use strict";
  if (globalThis.__NEXO_LOADER_STARTED__) return;
  globalThis.__NEXO_LOADER_STARTED__ = true;
  globalThis.__NEXO_LOCALE_PACK__ = ${JSON.stringify(locale)};
  var loader = document.currentScript;
  var mount = document.getElementById("bracket-city-app");
  if (!loader || !loader.src || !mount) return;
  var application = document.createElement("script");
  application.type = "module";
  application.src = new URL("src/pages-entry.ts", loader.src).href;
  application.onerror = function () {
    var message = document.createElement("p");
    message.className = "nexo-error";
    message.setAttribute("role", "alert");
    message.textContent = "No se pudo cargar el entorno local de Nexo.";
    mount.replaceChildren(message);
  };
  document.head.appendChild(application);
})();
`;
}
