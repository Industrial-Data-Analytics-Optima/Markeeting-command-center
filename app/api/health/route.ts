export async function GET() {
  return Response.json(
    { ok: true, host: process.env.VERCEL ? "vercel" : "local" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
