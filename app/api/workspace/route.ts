import { NextResponse } from "next/server";
// The legacy anonymous cookie was a user-controlled database key, not authentication.
// Fail closed until verified sessions and workspace membership are configured.
function unavailable() {
  return NextResponse.json(
    {
      error: "WORKSPACE_AUTH_REQUIRED",
      message:
        "Shared workspace access is disabled until secure authentication is configured. The preview stores its own data locally.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET() {
  return unavailable();
}
export async function POST() {
  return unavailable();
}
