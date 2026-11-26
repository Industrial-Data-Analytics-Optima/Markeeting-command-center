export const brandLogos: Record<string, string> = {
  IDAO: "/brands/idao.png",
  Optimaviz: "/brands/optimaviz.png",
  "AI JSA": "/brands/ai-jsa.png",
  Nestwise: "/brands/nestwise.png",
  TaskGo: "/brands/taskgo.png",
};
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
