import { useState } from "react";
import { useOutletContext } from "react-router";
import { documentsUrl, documentUrl } from "../data/documents";
import { exportDocument } from "../data/exportFolder";
import { useI18n } from "../data/preferences";
import type { AccountContext } from "./RootLayout";
import { Button } from "./ui/button";

export function ExportButtons({ id, compact = false }: { id?: string; compact?: boolean }) {
  const { account } = useOutletContext<AccountContext>();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function save(format: "json" | "csv") {
    setBusy(true);
    setFeedback("");
    try {
      const path = id ? documentUrl(id) + "/export/" : documentsUrl + "/export/approved/";
      const name = id ? "document-" + id : "approved-documents";
      const saved = await exportDocument(account.email, path + format, name + "-" + Date.now() + "." + format);
      if (saved) setFeedback("Saved to export folder.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void save("json")}>
          {compact ? "JSON" : t("Export JSON")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void save("csv")}>
          {compact ? "CSV" : t("Export CSV")}
        </Button>
      </div>
      {feedback && <p role="status" className="text-sm">{t(feedback)}</p>}
    </div>
  );
}
