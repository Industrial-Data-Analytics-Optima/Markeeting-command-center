import test from "node:test";
import assert from "node:assert/strict";
import { providerReadiness } from "../server/connections/readiness.ts";

test("provider setup reports exact missing keys and redirect URI without exposing credentials", () => {
  const base = {
    APP_ORIGIN: "https://hub.example.test/",
    TOKEN_VAULT_KEY: "private-vault-value",
  };
  const pending = providerReadiness("linkedin", base);
  assert.equal(pending.ready, false);
  assert.deepEqual(pending.missing, [
    "LINKEDIN_CLIENT_ID",
    "LINKEDIN_CLIENT_SECRET",
  ]);
  assert.equal(
    pending.redirectUri,
    "https://hub.example.test/api/connections/linkedin/callback",
  );
  const configured = providerReadiness("linkedin", {
    ...base,
    LINKEDIN_CLIENT_ID: "private-client-id",
    LINKEDIN_CLIENT_SECRET: "private-client-secret",
  });
  assert.equal(configured.ready, true);
  assert.deepEqual(configured.missing, []);
  assert.ok(!JSON.stringify(configured).includes("private-"));
  for (const APP_ORIGIN of [
    "not a URL",
    "http://public.example.test",
    "javascript:alert(1)",
  ])
    assert.equal(
      providerReadiness("linkedin", {
        ...base,
        APP_ORIGIN,
        LINKEDIN_CLIENT_ID: "id",
        LINKEDIN_CLIENT_SECRET: "secret",
      }).ready,
      false,
    );
});
test("readiness supports Meta and mailbox providers without guessing credentials", () => {
  const env = {
    APP_ORIGIN: "https://hub.example.test",
    TOKEN_VAULT_KEY: "vault",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MICROSOFT_CLIENT_ID: "ms-id",
    MICROSOFT_CLIENT_SECRET: "ms-secret",
  };
  for (const id of ["google", "microsoft"]) {
    const ready = providerReadiness(id, env);
    assert.equal(ready.ready, true);
    assert.equal(
      ready.redirectUri,
      "https://hub.example.test/api/connections/" + id + "/callback",
    );
  }
  const meta = providerReadiness("meta", env);
  assert.equal(meta.ready, false);
  assert.deepEqual(meta.missing, [
    "META_APP_ID",
    "META_APP_SECRET",
    "META_LOGIN_CONFIG_ID",
  ]);
  assert.equal(
    meta.redirectUri,
    "https://hub.example.test/api/connections/meta/callback",
  );
  assert.equal(
    providerReadiness("meta", {
      ...env,
      META_APP_ID: "12345",
      META_APP_SECRET: "secret",
      META_LOGIN_CONFIG_ID: "67890",
    }).ready,
    true,
  );
  assert.equal(providerReadiness("unknown", env).ready, false);
});
