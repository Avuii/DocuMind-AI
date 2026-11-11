import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api, documentUrl, type DocumentSummary } from "../data/documents";
import { useI18n } from "../data/preferences";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";

export function DeleteDocumentButton({ doc, onDeleted, compact }: {
  doc: Pick<DocumentSummary, "id" | "originalFileName">; onDeleted: () => void; compact?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function remove() {
    setBusy(true);
    setError(false);
    try {
      await api(documentUrl(doc.id), { method: "DELETE", headers: { "X-DocuMind-Request": "1" } });
      setOpen(false);
      onDeleted();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return <AlertDialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(false); } }}>
    <AlertDialogTrigger asChild>
      <Button variant="outline" size={compact ? "icon" : "default"}
        className="text-red-700" aria-label={t("Delete document") + ": " + doc.originalFileName}
        title={t("Delete document")}>
        <Trash2 aria-hidden="true" />{!compact && t("Delete document")}
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("Delete document?")}</AlertDialogTitle>
        <AlertDialogDescription className="break-all">
          {doc.originalFileName}<br />{t("The original and extracted data will be permanently deleted.")}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-red-700">{t("Could not delete the document.")}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
        <Button variant="destructive" disabled={busy} onClick={() => void remove()}>{t("Delete document")}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
