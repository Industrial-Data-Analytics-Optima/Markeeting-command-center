import { writeFileSync, mkdirSync } from "node:fs";

const token = process.env.TURSO_API_TOKEN;
const name = process.env.TURSO_DB_NAME || "marketing-command-center";

if (!token) {
  console.log(`Turso CLI is not required if you use the dashboard, but an API token lets this script create the database.

PowerShell:
  1. Install CLI:  irm https://get.tur.so/install.ps1 | iex
  2. Close and reopen the terminal, then:
       turso auth login
       turso auth token
  3. Re-run with the token (do not commit it):
       $env:TURSO_API_TOKEN = "<token from step 2>"
       npm run turso:provision

Or create the database in https://turso.tech → Databases → Create.
Name it "${name}". Copy the libSQL URL and a database token into .local/turso.env:

DATABASE_URL=libsql://${name}-<org>.turso.io
TURSO_AUTH_TOKEN=
`);
  process.exit(1);
}

const headers = {
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
};
const orgs = await fetch("https://api.turso.tech/v1/organizations", {
  headers,
});
if (!orgs.ok) {
  console.error(
    "Turso API rejected the token:",
    orgs.status,
    await orgs.text(),
  );
  process.exit(1);
}
const orgList = await orgs.json();
const org = orgList[0]?.slug || orgList.organizations?.[0]?.slug;
if (!org) {
  console.error("No Turso organization on this account.");
  process.exit(1);
}

const existing = await fetch(
  `https://api.turso.tech/v1/organizations/${org}/databases/${name}`,
  { headers },
);
if (existing.status === 404) {
  const created = await fetch(
    `https://api.turso.tech/v1/organizations/${org}/databases`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name, group: "default" }),
    },
  );
  if (!created.ok) {
    console.error(
      "Could not create database:",
      created.status,
      await created.text(),
    );
    process.exit(1);
  }
  console.log("Created Turso database", name, "in org", org);
} else if (!existing.ok) {
  console.error(
    "Could not read database:",
    existing.status,
    await existing.text(),
  );
  process.exit(1);
} else {
  console.log("Using existing Turso database", name);
}

const minted = await fetch(
  `https://api.turso.tech/v1/organizations/${org}/databases/${name}/auth/tokens`,
  { method: "POST", headers },
);
if (!minted.ok) {
  console.error("Could not mint DB token:", minted.status, await minted.text());
  process.exit(1);
}
const { jwt } = await minted.json();
const url = `libsql://${name}-${org}.turso.io`;
mkdirSync(".local", { recursive: true });
writeFileSync(
  ".local/turso.env",
  `DATABASE_URL=${url}\nTURSO_AUTH_TOKEN=${jwt}\n`,
);
console.log("Wrote .local/turso.env");
console.log("DATABASE_URL=" + url);
console.log("Copy DATABASE_URL and TURSO_AUTH_TOKEN into Vercel env vars.");
