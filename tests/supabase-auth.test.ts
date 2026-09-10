import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { requireSupabaseManagerSession } from "../src/supabase-auth.ts";
import type { SupabaseConfig } from "../src/types.ts";
import { installDomWindow, q } from "./test-dom.ts";

const config: SupabaseConfig = {
  url: "https://project-ref.supabase.co",
  publishableKey: "sb_publishable_test-key",
  canAuthor: false
};

function installDom(): void {
  const dom = new JSDOM("<!doctype html><main id='app'></main>", {
    url: "https://entre-parentesis.es/?mode=author&styles=open#token"
  });
  installDomWindow(dom.window);
}

test("an unauthenticated manager gets invite-only magic-link login", async () => {
  installDom();
  let request: unknown;
  const client = {
    auth: {
      async getSession() { return { data: { session: null }, error: null }; },
      async signInWithOtp(options: unknown) {
        request = options;
        return { error: null };
      },
      async signOut() { return { error: null }; }
    }
  };

  const session = await requireSupabaseManagerSession({
    config,
    mount: q("#app"),
    client,
    pageUrl: new URL(document.URL)
  });
  assert.equal(session, null);
  q('[data-testid="manager-email"]').value = "manager@example.test";
  q('[data-testid="manager-sign-in"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(request, {
    email: "manager@example.test",
    options: {
      emailRedirectTo: "https://entre-parentesis.es/?mode=author",
      shouldCreateUser: false
    }
  });
  assert.match(q('[data-testid="manager-auth-status"]').textContent ?? "", /Revisa tu correo/u);
});

test("an authenticated manager session supplies fresh tokens and can sign out", async () => {
  installDom();
  let signedOut = false;
  let token = "first-token";
  const client = {
    auth: {
      async getSession() {
        return {
          data: { session: { access_token: token, user: { email: "manager@example.test" } } },
          error: null
        };
      },
      async signInWithOtp() { return { error: null }; },
      async signOut() {
        signedOut = true;
        return { error: null };
      }
    }
  };

  const session = await requireSupabaseManagerSession({ config, mount: q("#app"), client });
  assert.ok(session);
  assert.equal(session.email, "manager@example.test");
  token = "refreshed-token";
  assert.equal(await session.getAccessToken(), "refreshed-token");
  await session.signOut();
  assert.equal(signedOut, true);
});
