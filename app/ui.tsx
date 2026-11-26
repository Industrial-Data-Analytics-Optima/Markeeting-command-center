import { ReactNode, useEffect, useRef } from "react";
let activeModals = 0;
let previousBodyOverflow = "";
const paths: Record<string, string> = {
  "Media library": "M3 4h18v16H3z M3 16l5-5 4 4 3-3 6 6 M17 8h.01",
  globe:
    "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c-6 6-6 14 0 20 M12 2c6 6 6 14 0 20",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  bell: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4",

  Overview: "m3 10 9-7 9 7v10H3z M9 20v-7h6v7",
  Publishing: "M4 4h10v4 M4 4v16h16v-8 M10 14l9-9 3 3-9 9-4 1z",
  Calendar: "M4 5h16v16H4z M7 3v4 M17 3v4 M4 10h16",
  Approvals: "M9 12l2 2 5-5 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  "Brand feed": "M3 4h18v14H8l-5 3z M7 8h10 M7 12h6",
  "Team space": "M3 4h18v13H9l-6 4z M7 8h10 M7 12h7",
  Email: "M3 5h18v14H3z m0 0 9 8 9-8",
  Campaigns: "M3 10h5l12-5v14L8 14H3z M8 14l2 7h4l-2-6",
  Leads:
    "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 3a4 4 0 0 1 0 8 M18 15a4 4 0 0 1 4 4v2",
  Analytics: "M4 21V11h4v10 M10 21V6h4v15 M16 21V2h4v19",
  "Brand settings":
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  Connections:
    "M10 13a5 5 0 0 0 7 .54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  plus: "M12 5v14 M5 12h14",
  search: "M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  help: "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  left: "m15 5-7 7 7 7",
  right: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  edit: "m4 16 12-12 4 4-12 12-5 1z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  like: "M8 21H3V10h5 M8 10l5-8c3 0 2 5 1 7h6c2 0 2 2 1 5l-2 7H8z",
  comment: "M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4",
  repost: "m3 8 4-4 4 4 M7 4v12h9 M21 16l-4 4-4-4 M17 20V8H8",
  Inbox: "M3 4h18v16H3z M3 13h5l2 3h4l2-3h5",
  Sent: "m3 3 18 9-18 9 4-9z M7 12h14",
  Drafts: "M5 2h10l4 4v16H5z M14 2v5h5",
  Archived: "M3 3h18v5H3z M5 8v13h14V8 M9 12h6",
  image: "M3 3h18v18H3z m0 14 5-5 4 4 3-3 6 6 M9 7h.01",
  close: "m6 6 12 12 M6 18 18 6",
  chevron: "m6 9 6 6 6-6",
  signout: "M9 4H4v16h5 M16 8l4 4-4 4 M8 12h12",
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      className="hub-icon"
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] || paths.Email} />
    </svg>
  );
}
export function SiteMark({ size = 36 }: { size?: number }) {
  return (
    <img
      className="site-mark"
      src="/mark.svg"
      width={size}
      height={size}
      alt=""
    />
  );
}
export function Avatar({ name }: { name: string }) {
  const colors: Record<string, string> = {
    IDAO: "#111318",
    Optimaviz: "#111318",
    "AI JSA": "#0b1a2a",
    Nestwise: "#ffffff",
    TaskGo: "#ffffff",
  };
  const logos: Record<string, string> = {
    IDAO: "/brands/idao.png",
    Optimaviz: "/brands/optimaviz.png",
    "AI JSA": "/brands/ai-jsa.png",
    Nestwise: "/brands/nestwise.png",
    TaskGo: "/brands/taskgo.png",
  };
  const logo = logos[name];
  return (
    <span
      className={"avatar" + (logo ? " avatar-logo" : "")}
      style={{ background: colors[name] || "#e5ece3" }}
    >
      {logo ? (
        <img src={logo} alt="" />
      ) : name === "Brand Manager" ? (
        "BM"
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function Platform({
  name,
  iconOnly = false,
}: {
  name: string;
  iconOnly?: boolean;
}) {
  return (
    <span
      className={"platform" + (iconOnly ? " platform-icon-only" : "")}
      role={iconOnly ? "img" : undefined}
      aria-label={iconOnly ? name : undefined}
    >
      <span
        aria-hidden="true"
        className={"platform-mark " + name.toLowerCase().split(" ")[0]}
      >
        {name.startsWith("LinkedIn")
          ? "in"
          : name === "Instagram"
            ? "◎"
            : name === "Facebook"
              ? "f"
              : name === "Gmail"
                ? "M"
                : name === "Outlook"
                  ? "O"
                  : "↗"}
      </span>
      {!iconOnly && <span className="platform-name">{name}</span>}
    </span>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closer = useRef(close);
  useEffect(() => {
    closer.current = close;
  }, [close]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    if (activeModals++ === 0)
      previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closer.current();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "a[href],button,input,select,textarea,[tabindex]",
          ) || [],
        ).filter(
          (n) =>
            !n.matches(":disabled") &&
            n.tabIndex >= 0 &&
            n.getClientRects().length > 0 &&
            getComputedStyle(n).visibility !== "hidden",
        );
        if (!nodes.length) {
          e.preventDefault();
          ref.current?.focus();
          return;
        }
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !ref.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (--activeModals === 0)
        document.body.style.overflow = previousBodyOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={"modal " + (wide ? "wide-modal" : "")}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
