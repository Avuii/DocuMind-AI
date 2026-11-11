import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { documentsUrl, groupsUrl, groupColor, groupStyle, hasProcessing, useDocuments } from "../data/documents";
import type { DocumentGroup, DocumentSummary } from "../data/documents";
import { DocumentGroups } from "./DocumentGroups";
import { useI18n } from "../data/preferences";
import { DocumentStatusBadge, statusColors } from "./DocumentStatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DeleteDocumentButton } from "./DeleteDocumentButton";

const statusOptions = [
  ["all", "All statuses"], ["Queued", "Queued"], ["Processing", "Processing"], ["Done", "Done"],
  ["unreviewed", "Needs review"], ["reviewed", "Reviewed"], ["Failed", "Failed"], ["Cancelled", "Cancelled"],
];
const pollFilteredDocuments = () => true;

export function Documents() {
  const { t, language } = useI18n();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useSearchParams();
  const batchId = filters.get("batchId");
  const requestedStatus = filters.get("status");
  const status = requestedStatus && Object.hasOwn(statusColors, requestedStatus) ? requestedStatus : "";
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [groupId, setGroupId] = useState("");
  const [updatedGroups, setUpdatedGroups] = useState<Record<string, DocumentGroup>>({});
  const { data: storedGroups, error: groupError } = useDocuments<DocumentGroup[]>(groupsUrl);
  const groups = Object.values({
    ...Object.fromEntries((storedGroups ?? []).map((group) => [group.id, group])),
    ...updatedGroups,
  });
  const activeGroup = groups.find((group) => group.id === groupId);
  const params = new URLSearchParams({ page: String(page), v: String(revision) });
  if (search.trim()) params.set("search", search.trim());
  if (groupId) params.set("groupId", groupId);
  if (batchId) params.set("batchId", batchId);
  if (status === "reviewed" || status === "unreviewed") {
    params.set("reviewed", String(status === "reviewed"));
  } else if (status) {
    params.set("status", status);
  }
  const { data, error } = useDocuments<{ items: DocumentSummary[]; hasMore: boolean }>(
    documentsUrl + "?" + params, status ? pollFilteredDocuments : hasProcessing
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-semibold text-slate-900">{t("Documents")}</h1>
        <Button asChild variant="outline"><Link to="/exports">{t("Review list")}</Link></Button>
      </header>
      <DocumentGroups groups={groups} selected={groupId}
        select={(id) => { setGroupId(id); setPage(1); }}
        saved={(group) => setUpdatedGroups((previous) => ({ ...previous, [group.id]: group }))} />
      {groupError && <p role="alert" className="text-red-700">{groupError}</p>}
      <div className="flex flex-wrap gap-3">
        <Input className="max-w-sm bg-white" aria-label={t("Search documents")}
          placeholder={t("Search file names or tags")} value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <Select value={status || "all"} onValueChange={(value) => {
            const next = new URLSearchParams(filters);
            if (value === "all") next.delete("status");
            else next.set("status", value);
            setFilters(next);
            setPage(1);
          }}>
          <SelectTrigger aria-label={t("Filter by status")} className="bg-white w-auto min-w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {statusOptions.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {statusColors[value] && <span className={"size-2.5 rounded-full " + statusColors[value].dot} aria-hidden="true" />}
                {t(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {batchId && <Button variant="outline" onClick={() => {
          const next = new URLSearchParams(filters);
          next.delete("batchId");
          setFilters(next);
          setPage(1);
        }}>{t("Show all batches")}</Button>}
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!data && !error && <p role="status">{t("Loading documents…")}</p>}
      {data && (
        <Card className="bg-white gap-0 p-0 divide-y divide-slate-200"
          style={activeGroup ? groupStyle(activeGroup.color) : undefined}>
          {data.items.length === 0 && <p className="p-5">{t("No matching documents.")}</p>}
          {data.items.map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-center gap-2 hover:bg-white/50 pr-4">
            <Link to={"/documents/" + doc.id}
              className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 p-5">
              <div className="min-w-0">
                <div className="font-medium break-all">{doc.originalFileName}</div>
                <time className="text-sm text-slate-500" dateTime={doc.createdAt}>
                  {new Date(doc.createdAt).toLocaleString(language)}
                </time>
                {doc.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {doc.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {groups.filter((group) => group.id === doc.groupId).map((group) => (
                  <Badge key={group.id} variant="outline" style={groupStyle(group.color)}>
                    <span className="size-2 rounded-full" style={{ backgroundColor: groupColor(group.color) }} />{group.name}
                  </Badge>
                ))}
                <DocumentStatusBadge doc={doc} />
              </div>
            </Link>
            <DeleteDocumentButton doc={doc} compact onDeleted={() => {
              if (page > 1 && data.items.length === 1) setPage(page - 1);
              setRevision((value) => value + 1);
            }} />
            </div>
          ))}
        </Card>
      )}
      {(page > 1 || data?.hasMore) && (
        <nav aria-label="Document pages" className="flex items-center gap-3">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("Previous")}</Button>
          <span>{t("Page")} {page}</span>
          <Button variant="outline" disabled={!data?.hasMore} onClick={() => setPage(page + 1)}>{t("Next")}</Button>
        </nav>
      )}
    </div>
  );
}
