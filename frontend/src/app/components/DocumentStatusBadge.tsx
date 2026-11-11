import type { DocumentSummary } from "../data/documents";
import { statusLabel } from "../data/documents";
import { useI18n } from "../data/preferences";
import { Badge } from "./ui/badge";

export const statusColors: Record<string, { badge: string; dot: string }> = {
  Cancelled: { badge: "bg-orange-50 text-orange-900 border-orange-200", dot: "bg-orange-500" },
  Queued: { badge: "bg-slate-100 text-slate-700 border-slate-300", dot: "bg-slate-500" },
  Processing: { badge: "bg-blue-50 text-blue-800 border-blue-300", dot: "bg-blue-600" },
  Done: { badge: "bg-teal-50 text-teal-800 border-teal-300", dot: "bg-teal-600" },
  unreviewed: { badge: "bg-amber-50 text-amber-900 border-amber-300", dot: "bg-amber-600" },
  reviewed: { badge: "bg-emerald-50 text-emerald-800 border-emerald-300", dot: "bg-emerald-600" },
  Failed: { badge: "bg-red-50 text-red-800 border-red-300", dot: "bg-red-600" },
};

export function DocumentStatusBadge({ doc }: { doc: Pick<DocumentSummary, "status" | "reviewed"> }) {
  const { t } = useI18n();
  const key = doc.status === "Done" ? (doc.reviewed ? "reviewed" : "unreviewed") : doc.status;
  const color = statusColors[key];
  return (
    <Badge variant="outline" className={color.badge}>
      <span className={"size-2 rounded-full " + color.dot} aria-hidden="true" />
      {t(statusLabel(doc))}
    </Badge>
  );
}
