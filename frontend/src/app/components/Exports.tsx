import { useState } from "react";
import { Link } from "react-router";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { documentsUrl, useDocuments } from "../data/documents";
import { ExportButtons } from "./ExportButtons";
import { useI18n } from "../data/preferences";
import type { DocumentSummary } from "../data/documents";
import { DocumentStatusBadge } from "./DocumentStatusBadge";

const pollReviewList = () => true;

export function Exports() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [approved, setApproved] = useState(false);
  const { data, error } = useDocuments<{ items: DocumentSummary[]; hasMore: boolean }>(
    documentsUrl + (approved ? "?reviewed=true&page=" : "?reviewQueue=true&page=") + page,
    pollReviewList
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-6">
      <h1 className="text-4xl font-semibold">{t("Exports")}</h1>
      <div className="flex flex-wrap gap-2">
        <Button variant={approved ? "outline" : "default"} aria-pressed={!approved}
          onClick={() => { setApproved(false); setPage(1); }}>{t("Needs review")}</Button>
        <Button variant={approved ? "default" : "outline"} aria-pressed={approved}
          onClick={() => { setApproved(true); setPage(1); }}>{t("Approved")}</Button>
      </div>
      {approved && Boolean(data?.items.length) && (
        <Card className="bg-white p-4 flex-row flex-wrap items-center justify-between">
          <h2 className="font-semibold">{t("Export all approved documents")}</h2>
          <ExportButtons />
        </Card>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!data && !error && <p role="status">{t("Loading documents…")}</p>}
      {data?.items.length === 0 && <p>{t(approved ? "No documents are ready to export." : "No documents to review.")}</p>}
      {data?.items.map((doc) => (
        <Card key={doc.id} className="p-4 bg-white flex-row flex-wrap items-center justify-between">
          <Link className="font-medium hover:underline break-all" to={"/documents/" + doc.id + "#manual-review"}>
            {doc.originalFileName}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <DocumentStatusBadge doc={doc} />
            {approved && <ExportButtons id={doc.id} compact />}
          </div>
        </Card>
      ))}
      {(page > 1 || data?.hasMore) && (
        <nav aria-label="Export pages" className="flex items-center gap-3">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("Previous")}</Button>
          <span>{t("Page")} {page}</span>
          <Button variant="outline" disabled={!data?.hasMore} onClick={() => setPage(page + 1)}>{t("Next")}</Button>
        </nav>
      )}
    </div>
  );
}
