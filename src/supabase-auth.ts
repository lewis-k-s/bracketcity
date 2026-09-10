import { createClient } from "@supabase/supabase-js";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseConfig } from "./types.ts";

interface SupabaseAuthClient {
  readonly auth: {
    getSession(): Promise<{
      data: { session: { access_token: string; user: { email?: string | undefined } } | null };
      error: { message: string } | null;
    }>;
    signInWithOtp(options: {
      email: string;
      options: { emailRedirectTo: string; shouldCreateUser: false };
    }): Promise<{ error: { message: string } | null }>;
    signOut(): Promise<{ error: { message: string } | null }>;
  };
}

export interface SupabaseManagerSession {
  readonly email: string;
  readonly getAccessToken: () => Promise<string>;
  readonly signOut: () => Promise<void>;
}

interface RequireManagerSessionOptions {
  readonly config: SupabaseConfig;
  readonly mount: HTMLElement;
  readonly client?: SupabaseAuthClient | undefined;
  readonly pageUrl?: URL | undefined;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; attributes?: Record<string, string> } = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes ?? {})) node.setAttribute(name, value);
  return node;
}

function authRedirectUrl(pageUrl: URL): string {
  const redirect = new URL(pageUrl.href);
  redirect.hash = "";
  redirect.search = "";
  redirect.searchParams.set("mode", "author");
  return redirect.href;
}

export function createSupabaseAuthClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      persistSession: true
    }
  });
}

function renderSignIn(
  mount: HTMLElement,
  client: SupabaseAuthClient,
  pageUrl: URL
): void {
  const shell = element("div", { className: "author-shell" });
  const panel = element("section", { className: "author-panel" });
  const heading = element("h1", { className: "brand", text: "Administrar Entre Paréntesis" });
  const explanation = element("p", {
    text: "Escribe la dirección de correo que recibió la invitación. Te enviaremos un enlace de acceso de un solo uso."
  });
  const form = element("form", { className: "author-editor" });
  const label = element("label", { className: "author-control-label", text: "Correo electrónico" });
  const input = element("input", {
    className: "author-input",
    attributes: {
      autocomplete: "email",
      inputmode: "email",
      name: "email",
      required: "",
      type: "email",
      "data-testid": "manager-email"
    }
  });
  const submit = element("button", {
    className: "author-button author-button--accent",
    text: "Enviar enlace de acceso",
    attributes: { type: "submit", "data-testid": "manager-sign-in" }
  });
  const status = element("p", {
    attributes: { "aria-live": "polite", role: "status", "data-testid": "manager-auth-status" }
  });
  label.append(input);
  form.append(label, submit, status);
  panel.append(heading, explanation, form);
  shell.append(panel);
  mount.replaceChildren(shell);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = input.value.trim();
    if (!email || !input.checkValidity()) {
      input.reportValidity();
      return;
    }
    submit.disabled = true;
    status.textContent = "Enviando el enlace…";
    void client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authRedirectUrl(pageUrl),
        shouldCreateUser: false
      }
    }).then(({ error }) => {
      submit.disabled = false;
      status.textContent = error
        ? `No se pudo enviar el enlace. ${error.message}`
        : "Revisa tu correo y abre el enlace de acceso en este navegador.";
    }, (error: unknown) => {
      submit.disabled = false;
      status.textContent = `No se pudo enviar el enlace. ${error instanceof Error ? error.message : String(error)}`;
    });
  });
}

export async function requireSupabaseManagerSession({
  config,
  mount,
  client: suppliedClient,
  pageUrl = new URL(globalThis.location?.href ?? document.baseURI)
}: RequireManagerSessionOptions): Promise<SupabaseManagerSession | null> {
  const client = suppliedClient ?? createSupabaseAuthClient(config);
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(`No se pudo comprobar la sesión. ${error.message}`);
  if (!data.session) {
    renderSignIn(mount, client, pageUrl);
    return null;
  }
  return {
    email: data.session.user.email ?? "",
    async getAccessToken() {
      const result = await client.auth.getSession();
      if (result.error || !result.data.session?.access_token) return "";
      return result.data.session.access_token;
    },
    async signOut() {
      const result = await client.auth.signOut();
      if (result.error) throw new Error(result.error.message);
    }
  };
}
