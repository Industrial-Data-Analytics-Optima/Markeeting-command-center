import { database } from "../../server/auth/http";
export default async function MetaDeletion({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code = "" } = await searchParams;
  const record = /^[-_a-zA-Z0-9]{32}$/.test(code)
    ? await database()
        .prepare("SELECT created_at FROM hub_meta_deletions WHERE code=?")
        .bind(code)
        .first<{ created_at: number }>()
    : null;
  return (
    <main className="meta-deletion-status">
      <section>
        <span className="a-eyebrow">MARKETING COMMAND CENTER</span>
        <h1>Meta data request</h1>
        {record ? (
          <>
            <b>Deletion completed</b>
            <p>
              The stored Facebook/Instagram connection, its credentials and
              associated account data have been removed.
            </p>
            <p>
              Your hub login and team workspace are separate from this Meta
              authorization.
            </p>
            <small>
              Completed {new Date(record.created_at).toISOString().slice(0, 10)}{" "}
              UTC
            </small>
          </>
        ) : (
          <>
            <b>Confirmation not found</b>
            <p>
              Use the confirmation link provided with your Meta data-deletion
              request. This page does not show account details.
            </p>
          </>
        )}
        <a href="/workspace">Open the workspace</a>
      </section>
    </main>
  );
}
