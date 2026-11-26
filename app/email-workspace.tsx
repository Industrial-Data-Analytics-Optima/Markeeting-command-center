import { useUnsavedChanges } from "./use-unsaved-changes";
import { useEffect, useState, FormEvent } from "react";
import { Modal } from "./ui";
import { MediaWorkspace, Asset } from "./media-workspace";
type Brand = { id: string; name: string };
type Draft = {
  id: string;
  brand_id: string;
  brand_name: string;
  mailbox_id: string | null;
  lead_id: string | null;
  reply_to_id: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: string[];
  version: number;
  updated_at: number;
  author_name: string;
};
type Message = {
  id: string;
  brand_id: string;
  brand_name: string;
  mailbox_id: string;
  thread_id: string;
  direction: string;
  sender: string;
  replyTo?: string[];
  cc?: string[];
  files?: { id: string; name: string; size: number }[];
  to: string[];
  subject: string;
  body: string;
  received_at: number;
};
type EmailFile = { id: string; brand_id: string; name: string; bytes: number };
const threadKey = (m: Message) =>
  m.brand_id + ":" + m.mailbox_id + ":" + m.thread_id;
type Mailbox = {
  id: string;
  label: string;
  provider: string;
  status: string;
  brand_id: string;
  largeAttachments: boolean;
};
type Delivery = {
  brand_id: string;
  mailbox_id: string;
  id: string;
  status: string;
  subject: string;
  to: string[];
  mailbox: string;
  brand_name: string;
  error_message: string | null;
  created_at: number;
};
type Data = {
  id?: string;
  version?: number;
  deliveries: Delivery[];
  canResolve: boolean;
  sync: {
    mailbox_id: string;
    synced_at: number | null;
    error_message: string | null;
    backfilling: number;
  }[];
  drafts: Draft[];
  messages: Message[];
  mailboxes: Mailbox[];
  syncEnabled: boolean;
  deliveryEnabled: boolean;
};
export type EmailIntent = { brandId: string; leadId?: string; to: string };
async function call(data?: unknown) {
  const r = await fetch("/api/email", {
      method: data ? "POST" : "GET",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    d = (await r.json()) as Data & { message?: string };
  if (!r.ok) throw new Error(d.message || "Could not load email.");
  return d;
}
export function EmailWorkspace({
  brands,
  intent,
  onIntentUsed,
}: {
  brands: Brand[];
  intent: EmailIntent | null;
  onIntentUsed: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [folder, setFolder] = useState("Drafts"),
    [brand, setBrand] = useState(""),
    [mailbox, setMailbox] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState<Draft | null | undefined>(),
    [seed, setSeed] = useState<EmailIntent | null>(null),
    [verification, setVerification] = useState<{
      job: Delivery;
      accepted: boolean;
    } | null>(null);
  async function load() {
    setData(await call());
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const timer = setInterval(
      () => load().catch((e) => setError(e.message)),
      30000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (intent) {
      setSeed(intent);
      setEditing(null);
      onIntentUsed();
    }
  }, [intent]);
  useEffect(() => setSelected(""), [brand, mailbox, search]);
  function verify(job: Delivery, accepted: boolean) {
    setVerification({ job, accepted });
  }
  function reply(m: Message, all: boolean) {
    const own = data?.mailboxes
        .find((b) => b.id === m.mailbox_id)
        ?.label.toLowerCase(),
      primary =
        m.direction === "incoming"
          ? m.replyTo?.length
            ? m.replyTo
            : [m.sender]
          : m.to,
      to = [
        ...new Set(
          [
            ...primary,
            ...(all && m.direction === "incoming" ? m.to : []),
          ].filter((x) => x.toLowerCase() !== own),
        ),
      ],
      cc = all
        ? (m.cc || []).filter(
            (x) =>
              x.toLowerCase() !== own &&
              !to.some((t) => t.toLowerCase() === x.toLowerCase()),
          )
        : [];
    setSeed({ brandId: m.brand_id, to: to.join(", ") });
    setEditing({
      id: "",
      brand_id: m.brand_id,
      brand_name: m.brand_name,
      mailbox_id: m.mailbox_id,
      lead_id: null,
      reply_to_id: m.id,
      to,
      cc,
      bcc: [],
      subject: /^re:/i.test(m.subject) ? m.subject : "Re: " + m.subject,
      body: "",
      attachments: [],
      version: 0,
      updated_at: 0,
      author_name: "",
    });
  }
  const filter = (d: {
    brand_id: string;
    mailbox_id: string | null;
    subject: string;
    body: string;
    to: string[];
  }) =>
    (!brand || d.brand_id === brand) &&
    (!mailbox || d.mailbox_id === mailbox) &&
    [d.subject, d.body, ...d.to]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
  const deliveries = (data?.deliveries || []).filter(
    (j) =>
      (!brand || j.brand_id === brand) &&
      (!mailbox || j.mailbox_id === mailbox) &&
      [j.subject, j.mailbox, ...j.to]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const drafts = (data?.drafts || []).filter(filter),
    messages = (data?.messages || [])
      .filter(filter)
      .filter((m) =>
        folder === "Inbox"
          ? m.direction === "incoming"
          : m.direction === "outgoing",
      ),
    thread = selected
      ? (data?.messages || [])
          .filter((m) => threadKey(m) === selected)
          .sort((a, b) => a.received_at - b.received_at)
      : [];
  const threads = messages.filter(
    (m, i, all) => all.findIndex((x) => threadKey(x) === threadKey(m)) === i,
  );
  function compose(d: Draft | null) {
    setSeed(null);
    setEditing(d);
  }
  return (
    <section className="email-workspace">
      <header className="leads-heading">
        <div>
          <p className="ed-muted">CONVERSATIONS, IN ONE PLACE</p>
          <h1>A considered reply starts here.</h1>
          <p>
            Prepare brand emails, keep context and follow through with your
            team.
          </p>
        </div>
        <button
          className="primary"
          disabled={!brands.length}
          onClick={() => compose(null)}
        >
          + Compose email
        </button>
      </header>
      {error && (
        <div className="secure-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="secure-notice" role="status">
          {notice}
        </p>
      )}
      {data?.sync.map((s) => (
        <p className="ed-muted" key={s.mailbox_id}>
          {data.mailboxes.find((m) => m.id === s.mailbox_id)?.label} ·{" "}
          {s.synced_at
            ? "Last sync " + new Date(s.synced_at).toLocaleString()
            : "Awaiting first successful sync"}
          {s.backfilling ? " · Loading recent history" : ""}
          {s.error_message ? " · " + s.error_message : ""}
        </p>
      ))}
      <div className="email-service">
        <b>
          {data?.syncEnabled
            ? "Mailbox sync enabled"
            : "Draft workspace is ready"}
        </b>
        <span>
          {data?.syncEnabled
            ? "Inbox and Sent sync covers the recent 30-day window, with provider timestamps. Older imported messages remain stored."
            : "Messages save securely in the hub. Live inbox sync and delivery are not enabled yet."}
        </span>
      </div>
      <div className="email-layout">
        <aside className="email-folders">
          <h3>Workspace mail</h3>
          {["Inbox", "Sent", "Drafts", "Outbox"].map((f) => (
            <button
              key={f}
              className={folder === f ? "active" : ""}
              onClick={() => {
                setFolder(f);
                setSelected("");
              }}
            >
              {f}
              <span>
                {f === "Outbox"
                  ? data?.deliveries.length || 0
                  : f === "Drafts"
                    ? data?.drafts.length || 0
                    : (data?.messages || []).filter(
                        (m) =>
                          m.direction ===
                          (f === "Inbox" ? "incoming" : "outgoing"),
                      ).length}
              </span>
            </button>
          ))}
          <p>Mailboxes</p>
          {data?.mailboxes.length ? (
            data.mailboxes
              .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
              .map((m) => (
                <button
                  key={m.id}
                  className={mailbox === m.id ? "active" : ""}
                  onClick={() => setMailbox(mailbox === m.id ? "" : m.id)}
                >
                  <span className="email-mailbox-name">{m.label}</span>
                </button>
              ))
          ) : (
            <small>
              Your super admin manages Gmail and Outlook accounts in
              Connections.
            </small>
          )}
        </aside>
        <div className="email-main">
          <div className="email-toolbar">
            <input
              aria-label="Search email"
              placeholder="Search subjects, recipients or messages"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Filter brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button onClick={() => load().catch((e) => setError(e.message))}>
              Refresh
            </button>
          </div>
          <div className="email-section-title">
            <h2>{folder}</h2>
            <span>
              {folder === "Outbox"
                ? deliveries.length
                : folder === "Drafts"
                  ? drafts.length
                  : threads.length}{" "}
              {folder === "Outbox"
                ? "deliveries"
                : folder === "Drafts"
                  ? "drafts"
                  : "threads"}{" "}
              · Latest 500 records
            </span>
          </div>
          {!data ? (
            <div className="leads-empty">Loading your email workspace…</div>
          ) : folder === "Outbox" ? (
            <div className="email-outbox">
              {deliveries.length ? (
                deliveries.map((j) => (
                  <article key={j.id}>
                    <h3>{j.subject}</h3>
                    <p>
                      {j.mailbox} → {j.to.join(", ")}
                    </p>
                    <span className="ed-pill">
                      {j.status === "accepted"
                        ? "Provider accepted · awaiting Sent confirmation"
                        : j.status === "sent"
                          ? "Confirmed in provider Sent folder"
                          : j.status === "preparing"
                            ? "Preparing message and attachments"
                            : j.status === "submitting"
                              ? "Submitting to provider"
                              : j.status}
                    </span>
                    <small>
                      {j.brand_name} · {new Date(j.created_at).toLocaleString()}
                    </small>
                    {j.error_message && <p role="status">{j.error_message}</p>}
                    {["queued", "preparing"].includes(j.status) && (
                      <button
                        onClick={async () => {
                          try {
                            const r = await fetch("/api/email/delivery", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                action: "cancel",
                                id: j.id,
                              }),
                            });
                            const d = (await r.json()) as { message?: string };
                            if (!r.ok) throw new Error(d.message);
                            await load();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Cancel before submission
                      </button>
                    )}
                    {j.status === "failed" && data.deliveryEnabled && (
                      <button
                        onClick={async () => {
                          if (
                            !confirm(
                              "Retry this saved email?\nFrom: " +
                                j.mailbox +
                                "\nTo: " +
                                j.to.join(", ") +
                                "\nSubject: " +
                                j.subject +
                                "\nInterrupted attachment uploads will resume where possible.",
                            )
                          )
                            return;
                          try {
                            const r = await fetch("/api/email/delivery", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                action: "retry",
                                id: j.id,
                              }),
                            });
                            const d = (await r.json()) as { message?: string };
                            if (!r.ok) throw new Error(d.message);
                            await load();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Retry saved email
                      </button>
                    )}
                    {j.status === "uncertain" && data.canResolve && (
                      <div>
                        <button onClick={() => verify(j, true)}>
                          Verified in Sent
                        </button>
                        <button onClick={() => verify(j, false)}>
                          Verified not sent
                        </button>
                      </div>
                    )}
                  </article>
                ))
              ) : (
                <div className="leads-empty">
                  <h2>No queued emails.</h2>
                  <p>
                    Delivery attempts will appear here. Provider acceptance is
                    shown separately from Sent confirmation.
                  </p>
                </div>
              )}
            </div>
          ) : folder === "Drafts" ? (
            drafts.length ? (
              <div className="email-drafts">
                {drafts.map((d) => (
                  <button key={d.id} onClick={() => compose(d)}>
                    <span className="email-monogram">
                      {(d.to[0] || d.brand_name).slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <b>{d.subject || "Untitled draft"}</b>
                      <p>{d.to.join(", ") || "No recipients yet"}</p>
                      <small>
                        {d.body.slice(0, 100) || "Start writing your message…"}
                      </small>
                    </div>
                    <aside>
                      <span>{d.brand_name}</span>
                      <small>
                        {new Date(d.updated_at).toLocaleDateString()}
                      </small>
                      <small>Edited by {d.author_name}</small>
                    </aside>
                  </button>
                ))}
              </div>
            ) : (
              <div className="leads-empty">
                <h2>
                  {search || brand || mailbox
                    ? "No matching drafts."
                    : "Your next conversation begins here."}
                </h2>
                <p>
                  Create an email draft now, or start one directly from a lead.
                </p>
                <button className="primary" onClick={() => compose(null)}>
                  Write an email
                </button>
              </div>
            )
          ) : threads.length ? (
            <div className="email-threads">
              <div>
                {threads.map((m) => (
                  <button
                    className={selected === threadKey(m) ? "active" : ""}
                    key={threadKey(m)}
                    onClick={() => setSelected(threadKey(m))}
                  >
                    <b>{m.subject || "(No subject)"}</b>
                    <span>{m.sender}</span>
                    <small>{m.body.slice(0, 80)}</small>
                  </button>
                ))}
              </div>
              <section>
                {thread.length ? (
                  thread.map((m) => (
                    <article key={m.id}>
                      <h3>{m.subject}</h3>
                      <p>
                        <b>{m.sender}</b> → {m.to.join(", ")}
                      </p>
                      <small>{new Date(m.received_at).toLocaleString()}</small>
                      {!!m.cc?.length && <p>Cc: {m.cc.join(", ")}</p>}
                      {!!m.files?.length && (
                        <div className="email-attachments">
                          {m.files.map((f) => (
                            <a
                              key={f.id}
                              href={
                                "/api/email/messages/" +
                                m.id +
                                "/attachment?file=" +
                                encodeURIComponent(f.id)
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              {f.name} · {(f.size / 1024).toFixed(0)} KB
                            </a>
                          ))}
                        </div>
                      )}
                      <small>
                        Plain-text view · remote images are not loaded
                      </small>
                      <p className="email-message-body">{m.body}</p>
                      {m.body.length >= 100000 && (
                        <p className="ed-muted">
                          Long message: this view is limited to 100,000
                          characters. Check the original mailbox for the
                          complete message.
                        </p>
                      )}
                      <button onClick={() => reply(m, false)}>
                        Draft reply
                      </button>
                      <button onClick={() => reply(m, true)}>Reply all</button>
                    </article>
                  ))
                ) : (
                  <div className="leads-empty">
                    Choose a conversation to read it here.
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="leads-empty">
              <span className="email-empty-mark">✉</span>
              <h2>
                {folder === "Inbox"
                  ? "A home for incoming conversations."
                  : "A clear record of every send."}
              </h2>
              <p>
                {data.syncEnabled
                  ? "No synced messages match this view yet."
                  : "Live mail sync is not enabled yet. Your saved drafts are available in Drafts."}
              </p>
            </div>
          )}
        </div>
      </div>
      {verification && (
        <EmailVerification
          {...verification}
          close={() => setVerification(null)}
          done={async () => {
            await load();
            setVerification(null);
          }}
        />
      )}
      {editing !== undefined && data && (
        <EmailComposer
          brands={brands}
          deliveryEnabled={data.deliveryEnabled}
          mailboxes={data.mailboxes}
          initial={editing}
          seed={seed}
          close={() => setEditing(undefined)}
          saved={async (discarded = false, queued = false) => {
            await load();
            setEditing(undefined);
            setFolder(queued ? "Outbox" : "Drafts");
            setNotice(
              queued
                ? "Email queued. Check Outbox for provider confirmation."
                : discarded
                  ? "Draft discarded."
                  : "Draft saved to the workspace.",
            );
          }}
        />
      )}
    </section>
  );
}
function EmailComposer({
  brands,
  mailboxes,
  initial,
  seed,
  close,
  saved,
  deliveryEnabled,
}: {
  brands: Brand[];
  mailboxes: Mailbox[];
  initial: Draft | null;
  seed: EmailIntent | null;
  close: () => void;
  saved: (discarded?: boolean, queued?: boolean) => Promise<void>;
  deliveryEnabled: boolean;
}) {
  const [brand, setBrand] = useState(
      initial?.brand_id || seed?.brandId || brands[0]?.id || "",
    ),
    [mailbox, setMailbox] = useState(initial?.mailbox_id || ""),
    [expanded, setExpanded] = useState(
      !!initial?.cc.length || !!initial?.bcc.length,
    ),
    [attachments, setAttachments] = useState<string[]>(
      initial?.attachments || [],
    ),
    [assets, setAssets] = useState<Asset[]>([]),
    [files, setFiles] = useState<EmailFile[]>([]),
    [picker, setPicker] = useState(false),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [key] = useState(() => crypto.randomUUID()),
    [savedVersion, setSavedVersion] = useState<{
      id: string;
      version: number;
    } | null>(
      initial?.id ? { id: initial.id, version: initial.version } : null,
    );
  useUnsavedChanges(dirty || uploadBusy);
  useEffect(() => {
    fetch("/api/email/attachments")
      .then((r) => r.json())
      .then((d) => setFiles((d as { files: EmailFile[] }).files || []))
      .catch(() => {});
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => setAssets((d as { assets: Asset[] }).assets || []))
      .catch(() => {});
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(new FormData(e.currentTarget));
      const savedDraft = await call({
        ...fields,
        id: savedVersion?.id,
        version: savedVersion?.version,
        brandId: brand,
        mailboxId: mailbox,
        leadId: initial?.lead_id || seed?.leadId,
        replyToId: initial?.reply_to_id,
        attachments,
        clientKey: key,
        action: "save",
      });
      if (savedDraft.id && savedDraft.version)
        setSavedVersion({ id: savedDraft.id, version: savedDraft.version });
      const sending =
        (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-send") ===
        "true";
      if (sending) {
        if (
          !confirm(
            "Send from " +
              (mailboxes.find((m) => m.id === mailbox && m.brand_id === brand)
                ?.label || "the selected mailbox") +
              "?\nTo: " +
              String(fields.to) +
              (fields.cc ? "\nCc: " + fields.cc : "") +
              (fields.bcc ? "\nBcc: " + fields.bcc : "") +
              "\nAttachments: " +
              attachments.length +
              "\nThe queued message cannot be edited during delivery.",
          )
        ) {
          await saved();
          return;
        }
        const response = await fetch("/api/email/delivery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: savedDraft.id,
            version: savedDraft.version,
          }),
        });
        const result = (await response.json()) as { message?: string };
        if (!response.ok)
          throw new Error(result.message || "Could not queue the message.");
      }
      await saved(false, sending);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (!savedVersion?.id) {
      close();
      return;
    }
    if (!confirm("Discard this saved draft?")) return;
    setBusy(true);
    try {
      await call({
        action: "discard",
        id: savedVersion.id,
        version: savedVersion.version,
        brandId: brand,
      });
      await saved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function addAttachment(a: EmailFile) {
    if (attachments.includes(a.id)) {
      setPicker(false);
      return;
    }
    const total =
      attachments.reduce(
        (n, id) =>
          n +
          (assets.find((a) => a.id === id)?.bytes ||
            files.find((f) => f.id === id)?.bytes ||
            0),
        0,
      ) + a.bytes;
    if (total > 20 * 1024 * 1024 || attachments.length >= 10) {
      setError("Choose up to 10 files, totalling 20 MB or less for email.");
      return;
    }
    setAttachments([...attachments, a.id]);
    setDirty(true);
    setPicker(false);
    setError("");
  }
  function select(a: Asset) {
    setAssets((old) => (old.some((x) => x.id === a.id) ? old : [...old, a]));
    addAttachment(a);
  }
  async function uploadDocument(file?: File) {
    if (!file) return;
    setUploadBusy(true);
    setError("");
    try {
      const total =
        attachments.reduce(
          (n, id) =>
            n +
            (assets.find((a) => a.id === id)?.bytes ||
              files.find((f) => f.id === id)?.bytes ||
              0),
          0,
        ) + file.size;
      if (total > 20 * 1024 * 1024 || attachments.length >= 10)
        throw new Error("Choose up to 10 files, totalling 20 MB or less.");
      const r = await fetch("/api/email/attachments", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-brand-id": brand,
            "x-file-name": encodeURIComponent(file.name),
          },
          body: file,
        }),
        d = (await r.json()) as EmailFile & { message?: string };
      if (!r.ok) throw new Error(d.message);
      setFiles((old) => [d, ...old]);
      addAttachment(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploadBusy(false);
    }
  }
  return (
    <Modal
      title={
        initial?.reply_to_id
          ? "Draft a reply"
          : initial
            ? "Edit email draft"
            : "New email"
      }
      close={() => {
        if (
          !busy &&
          !uploadBusy &&
          (!dirty || confirm("Close without saving your changes?"))
        )
          close();
      }}
      wide
    >
      <form
        className="email-compose"
        onSubmit={submit}
        onChange={() => setDirty(true)}
      >
        <fieldset className="email-compose-fields" disabled={busy}>
          <div className="email-compose-meta">
            <label>
              Brand
              <select
                value={brand}
                disabled={
                  busy || uploadBusy || !!savedVersion?.id || !!seed?.leadId
                }
                onChange={(e) => {
                  setBrand(e.target.value);
                  setMailbox("");
                  setAttachments([]);
                }}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <select
                value={mailbox}
                onChange={(e) => setMailbox(e.target.value)}
                disabled={busy || uploadBusy || !!initial?.reply_to_id}
              >
                <option value="">Choose mailbox later</option>
                {mailboxes
                  .filter((m) => m.brand_id === brand)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ·{" "}
                      {m.provider === "google" ? "Gmail" : "Outlook"}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {mailboxes.some(
            (m) =>
              m.id === mailbox &&
              m.provider === "microsoft" &&
              !m.largeAttachments,
          ) && (
            <p className="ed-muted">
              For attachments above 2 MB, ask your super admin to reauthorize
              this Outlook mailbox in Connections. Your draft can still be
              saved.
            </p>
          )}
          <label>
            To
            <input
              name="to"
              aria-label="To recipients"
              maxLength={3000}
              defaultValue={initial?.to.join(", ") || seed?.to || ""}
              placeholder="name@company.com, another@company.com"
            />
          </label>
          <button
            type="button"
            className="email-cc-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide Cc / Bcc" : "Add Cc / Bcc"}
          </button>
          <div hidden={!expanded}>
            <label>
              Cc
              <input
                name="cc"
                maxLength={3000}
                defaultValue={initial?.cc.join(", ") || ""}
              />
            </label>
            <label>
              Bcc
              <input
                name="bcc"
                maxLength={3000}
                defaultValue={initial?.bcc.join(", ") || ""}
              />
            </label>
          </div>
          <label>
            Subject
            <input
              name="subject"
              maxLength={300}
              defaultValue={initial?.subject || ""}
              placeholder="A clear subject makes a good first impression"
            />
          </label>
          <textarea
            className="email-body"
            name="body"
            aria-label="Email message"
            maxLength={10000}
            defaultValue={initial?.body || ""}
            placeholder="Write your message…"
          />
          <div className="email-attachments">
            {attachments.map((id) => (
              <span key={id}>
                <a
                  href={
                    files.some((f) => f.id === id)
                      ? "/api/email/attachments/" + id
                      : "/api/media/" + id
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {assets.find((a) => a.id === id)?.name ||
                    files.find((f) => f.id === id)?.name ||
                    "Saved attachment"}
                </a>
                <button
                  type="button"
                  disabled={busy || uploadBusy}
                  aria-label="Remove attachment"
                  onClick={() => {
                    setAttachments(attachments.filter((x) => x !== id));
                    setDirty(true);
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              disabled={busy || uploadBusy}
              onClick={() => setPicker(!picker)}
            >
              {picker ? "Close library" : "+ Attach from media library"}
            </button>
            <label className="email-document-upload">
              {uploadBusy ? "Uploading…" : "Upload document"}
              <input
                type="file"
                accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt"
                disabled={busy || uploadBusy}
                onChange={(e) => {
                  uploadDocument(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {files.some((f) => f.brand_id === brand) && (
              <select
                aria-label="Attach a saved document"
                value=""
                disabled={busy || uploadBusy}
                onChange={(e) => {
                  const file = files.find((f) => f.id === e.target.value);
                  if (file) addAttachment(file);
                }}
              >
                <option value="">Choose a saved document</option>
                {files
                  .filter(
                    (f) => f.brand_id === brand && !attachments.includes(f.id),
                  )
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            )}
            <small>
              Up to 10 files · 20 MB combined · PDF, Office, CSV, TXT or media
              library assets
            </small>
          </div>
          {picker && (
            <MediaWorkspace
              brands={brands.filter((b) => b.id === brand)}
              onSelect={select}
              onBusy={setUploadBusy}
            />
          )}
          <p className="email-draft-note">
            Saved drafts are shared with teammates who have access to this
            brand.{" "}
            {deliveryEnabled
              ? "Sending queues a saved snapshot. Check Outbox for provider acceptance and Sent confirmation. Attachments support up to 20 MB combined."
              : "Live sending and mailbox sync will be enabled during the connections phase."}
          </p>
          {error && (
            <p className="access-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button
              type="submit"
              className="primary"
              disabled={busy || uploadBusy}
            >
              {busy ? "Saving…" : "Save draft"}
            </button>
            <button
              type="submit"
              data-send="true"
              disabled={!deliveryEnabled || !mailbox || busy || uploadBusy}
              title={
                deliveryEnabled
                  ? "Save and queue this email"
                  : "Live email delivery has not been enabled"
              }
            >
              Send email
            </button>
            <button
              type="button"
              disabled={busy || uploadBusy}
              onClick={discard}
            >
              Discard draft
            </button>
          </footer>
        </fieldset>
      </form>
    </Modal>
  );
}

function EmailVerification({
  job,
  accepted,
  close,
  done,
}: {
  job: Delivery;
  accepted: boolean;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = new FormData(e.currentTarget).get("note");
    setBusy(true);
    try {
      const r = await fetch("/api/email/delivery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resolve",
            id: job.id,
            accepted,
            note,
          }),
        }),
        d = (await r.json()) as { message?: string };
      if (!r.ok) throw new Error(d.message);
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Verify email submission"
      close={() => {
        if (!busy) close();
      }}
    >
      <form className="feed-action-form" onSubmit={submit}>
        <div className="feed-action-source">
          <b>{job.subject}</b>
          <p>
            {job.mailbox} → {job.to.join(", ")}
          </p>
        </div>
        <p className="ed-muted">
          Check this mailbox’s Sent folder before recording the outcome.
          Provider acceptance does not prove receipt by the recipient.
        </p>
        <b>
          {accepted
            ? "Confirm: the message was submitted"
            : "Confirm: the message was not sent"}
        </b>
        <label>
          How did you verify the outcome?
          <textarea name="note" minLength={10} maxLength={500} required />
        </label>
        {!accepted && (
          <p className="ed-muted">
            Marking it as not sent permits a deliberate retry from Outbox, or a
            new attempt after editing the draft.
          </p>
        )}
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Recording…" : "Record verification"}
        </button>
      </form>
    </Modal>
  );
}
