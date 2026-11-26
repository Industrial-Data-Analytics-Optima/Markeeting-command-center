export type Brand = {
  name: string;
  color: string;
  logo?: string;
  placeholder?: boolean;
};
export const brandLogos: Record<string, string> = {
  IDAO: "/brands/idao.png",
  Optimaviz: "/brands/optimaviz.png",
  "AI JSA": "/brands/ai-jsa.png",
  Nestwise: "/brands/nestwise.png",
  TaskGo: "/brands/taskgo.png",
};
export type Post = {
  id: string;
  brand: string;
  platform: string;
  text: string;
  date: string;
  time: string;
  status: "Published" | "Planned" | "Needs approval" | "Draft" | "Ready";
  image?: string;
};
export type Mail = {
  id: string;
  brand: string;
  sender: string;
  subject: string;
  body: string;
  time: string;
  folder: string;
  unread: boolean;
  to?: string;
  provider?: string;
};
export const brands: Brand[] = [
  { name: "IDAO", color: "#3d4fd8", logo: brandLogos.IDAO },
  { name: "Optimaviz", color: "#1aa3a8", logo: brandLogos.Optimaviz },
  { name: "AI JSA", color: "#3aa0e8", logo: brandLogos["AI JSA"] },
  { name: "Nestwise", color: "#5a8f3d", logo: brandLogos.Nestwise },
  { name: "TaskGo", color: "#2f6bff", logo: brandLogos.TaskGo },
];
const renamedBrands: Record<string, string> = {
  "Brand 4": "AI JSA",
  "Brand 5": "TaskGo",
};
export function canonicalBrandName(name: string) {
  return renamedBrands[name] || name;
}
export function withBrandLogos(list: Brand[]) {
  const byName = new Map(
    list.map((b) => {
      const name = canonicalBrandName(b.name);
      const base = brands.find((x) => x.name === name);
      return [
        name,
        {
          ...b,
          name,
          placeholder: undefined,
          color: base?.color || b.color,
          logo: brandLogos[name] || b.logo,
        },
      ];
    }),
  );
  return brands.map((b) => byName.get(b.name) || b);
}
export function dateKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}
export function weekStart(now = new Date()) {
  const parts = now.toLocaleDateString("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  });
  const d = new Date(parts + "T12:00:00+08:00");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
const day = (n: number) => {
  const d = weekStart();
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d);
};
export const photos = {
  study: "/study.jpg",
  home: "/home.jpg",
  team: "/team.jpg",
  room: "/room.jpg",
};
export const initialPosts: Post[] = [
  {
    id: "p1",
    brand: "IDAO",
    platform: "LinkedIn",
    text: "Build skills that open doors. Your next chapter starts with the right people.",
    date: day(0),
    time: "09:00",
    status: "Published",
    image: photos.study,
  },
  {
    id: "p2",
    brand: "Optimaviz",
    platform: "LinkedIn",
    text: "Your data has a story. Here’s how to find it.",
    date: day(1),
    time: "09:00",
    status: "Published",
  },
  {
    id: "p3",
    brand: "Nestwise",
    platform: "Instagram",
    text: "A place for your next chapter. Thoughtful spaces for everyday living.",
    date: day(2),
    time: "12:30",
    status: "Planned",
    image: photos.home,
  },
  {
    id: "p4",
    brand: "IDAO",
    platform: "Facebook",
    text: "Meet the people behind the programme.",
    date: day(2),
    time: "16:00",
    status: "Needs approval",
  },
  {
    id: "p5",
    brand: "Optimaviz",
    platform: "LinkedIn",
    text: "From reporting to real decisions. Make your next move with confidence.",
    date: day(3),
    time: "10:00",
    status: "Planned",
    image: "/chart-creative.svg",
  },
  {
    id: "p6",
    brand: "Nestwise",
    platform: "Instagram",
    text: "Small details. Better living.",
    date: day(4),
    time: "11:00",
    status: "Draft",
    image: photos.room,
  },
  {
    id: "p7",
    brand: "IDAO",
    platform: "Facebook",
    text: "Your next step starts here. Join our upcoming open day.",
    date: day(5),
    time: "10:00",
    status: "Needs approval",
    image: photos.team,
  },
  {
    id: "p8",
    brand: "IDAO",
    platform: "LinkedIn",
    text: "The next chapter starts with the right skills. Meet the people turning ambition into opportunity.",
    date: day(-2),
    time: "14:00",
    status: "Published",
    image: photos.team,
  },
  {
    id: "p9",
    brand: "AI JSA",
    platform: "LinkedIn",
    text: "Safety briefings that write themselves. AI JSA turns job hazard analysis into a clear, shareable brief.",
    date: day(1),
    time: "11:30",
    status: "Planned",
  },
  {
    id: "p10",
    brand: "TaskGo",
    platform: "LinkedIn",
    text: "One list. Every job moving. TaskGo keeps field work on schedule.",
    date: day(3),
    time: "15:00",
    status: "Draft",
  },
];
export const initialMail: Mail[] = [
  {
    id: "m1",
    brand: "IDAO",
    sender: "Sarah Lim",
    subject: "November intake enquiry",
    body: "Hi team,\n\nI’d like to learn more about the upcoming programme. Could you share the course outline and available intake dates?\n\nThank you,\nSarah",
    time: "10:42",
    folder: "Inbox",
    unread: true,
  },
  {
    id: "m2",
    brand: "Optimaviz",
    sender: "Daniel Tan",
    subject: "Proposal follow-up",
    body: "Hi team,\n\nThanks for the meeting last week. Just checking in on the proposal we discussed.\n\nBest,\nDaniel",
    time: "09:17",
    folder: "Inbox",
    unread: true,
  },
  {
    id: "m3",
    brand: "IDAO",
    sender: "Admissions team",
    subject: "Open day materials",
    body: "The draft materials for the upcoming open day are ready for review. Let us know your thoughts.",
    time: "Yesterday",
    folder: "Inbox",
    unread: false,
  },
  {
    id: "m4",
    brand: "Optimaviz",
    sender: "You",
    subject: "Meeting recap",
    body: "Thanks for your time today. Here is a summary of the next steps we discussed.\n\nThis is an illustrative sent message.",
    time: "Yesterday",
    folder: "Sent",
    unread: false,
  },
];
export const initialLeads = [
  {
    id: "l1",
    name: "Sarah Lim",
    brand: "IDAO",
    source: "LinkedIn",
    email: "sarah@example.com",
    status: "New",
  },
  {
    id: "l2",
    name: "Daniel Tan",
    brand: "Optimaviz",
    source: "Facebook",
    email: "daniel@example.com",
    status: "Contacted",
  },
  {
    id: "l3",
    name: "Amira Hassan",
    brand: "Nestwise",
    source: "Instagram",
    email: "amira@example.com",
    status: "Qualified",
  },
];
export function toCsv(rows: object[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const quote = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@\-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    keys.map(quote).join(","),
    ...rows.map((row) =>
      keys.map((k) => quote((row as Record<string, unknown>)[k])).join(","),
    ),
  ].join("\r\n");
}
export function download(name: string, rows: object[]) {
  const csv = toCsv(rows);
  if (!csv) return;
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function validatePost(
  text: string,
  platform: string,
  date: string,
  time: string,
  image: string,
  status: Post["status"],
  now = Date.now(),
) {
  if (!text.trim()) return "Write a caption before saving.";
  const limit =
    platform === "Instagram" ? 2200 : platform === "LinkedIn" ? 3000 : 63206;
  if (text.length > limit) return `This caption exceeds the ${platform} limit.`;
  const scheduled = Date.parse(date + "T" + time + ":00+08:00");
  if (!date || !time || !Number.isFinite(scheduled))
    return "Choose a valid date and time.";
  if (status === "Planned" && scheduled <= now)
    return "Choose a future date and time to add this to the plan.";
  if (status === "Planned" && platform === "Instagram" && !image)
    return "Add an image for this Instagram post.";
  return "";
}
