import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { documentUrl, groupsUrl, processing, sendJson, useDocumentContent, useDocuments } from "../data/documents";
import type { DocumentAnswer, DocumentDetails, DocumentGroup } from "../data/documents";
import { ExportButtons } from "./ExportButtons";
import { useI18n } from "../data/preferences";
import { ManualReview } from "./ManualReview";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { DeleteDocumentButton } from "./DeleteDocumentButton";

const fieldLabels: Record<string, string> = {
  vendor_name: "Seller",
  invoice_number: "Invoice number",
  nip: "NIP",
  invoice_date: "Invoice date",
  total_amount: "Gross amount",
  currency: "Currency",
  tax_amount: "VAT amount",
  net_amount: "Net amount",
  vat_rate: "VAT rate",
  tax_type: "Tax type",
  seller_gst_id: "Seller GST number",
  buyer_name: "Buyer",
  buyer_address: "Buyer address",
  seller_address: "Seller address",
  buyer_nip: "Buyer NIP",
  seller_nip: "Seller NIP",
  regon: "REGON",
  receipt_number: "Receipt number",
  purchase_order_number: "Purchase order number",
  payment_terms: "Payment terms",
  payment_method: "Payment method",
  sale_date: "Sale date",
  due_date: "Due date",
  phone: "Phone",
  email: "Email",
  website: "Website",
  bank_account: "Bank account",
  tax_ids: "Tax IDs",
  document_type: "Document type",
  document_language: "Document language",
};

export function DocumentDetail() {
  const { id = "" } = useParams();
  const { hash } = useLocation();
  const { t } = useI18n();
  const [version, setVersion] = useState(0);
  const { data, error } = useDocuments<DocumentDetails>(documentUrl(id) + "?v=" + version, processing);
  const reviewReady = Boolean(data && !processing(data));
  useEffect(() => {
    if (hash === "#manual-review" && reviewReady) {
      document.getElementById("manual-review")?.scrollIntoView({ block: "start" });
    }
  }, [hash, id, reviewReady]);
  if (!data || data.id !== id.toLowerCase()) {
    return <p className="p-8" role={error ? "alert" : "status"}>{t(error ?? "Loading document…")}</p>;
  }
  return <DocumentView key={id + "-" + version} doc={data} reload={() => setVersion((previous) => previous + 1)} />;
}

function DocumentView({ doc, reload }: { doc: DocumentDetails; reload: () => void }) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const preview = useDocumentContent(doc.id, "Could not load the document preview.");
  const url = documentUrl(doc.id);
  const [tags, setTags] = useState(doc.tags.join(", "));
  const [savedTags, setSavedTags] = useState(doc.tags);
  const [reviewed, setReviewed] = useState(doc.reviewed);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [corrections, setCorrections] = useState<DocumentDetails["result"]>();
  const result = corrections ?? doc.result;
  const [field, setField] = useState<string>();
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [savingField, setSavingField] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<DocumentAnswer>();
  const [questionError, setQuestionError] = useState("");
  const [asking, setAsking] = useState(false);
  const [groupId, setGroupId] = useState(doc.groupId ?? "");
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [groupName, setGroupName] = useState<string>();
  const [createdGroups, setCreatedGroups] = useState<DocumentGroup[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const { data: groups, error: groupsError } = useDocuments<DocumentGroup[]>(groupsUrl);
  const groupOptions = new Map([...(groups ?? []), ...createdGroups].map((group) => [group.id, group]));
  const items = result?.finalResult.line_items ?? [];
  const transcript = result?.rawResult.debug?.full_text;

  async function createGroup() {
    if (!groupName?.trim()) return;
    setGroupError("");
    setSavingGroup(true);
    try {
      const group = await sendJson<DocumentGroup>(groupsUrl, "POST", {
        name: groupName.trim(), color: "blue", documentId: doc.id,
      });
      setCreatedGroups((previous) => [...previous, group]);
      setGroupId(group.id);
      setGroupName(undefined);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingGroup(false);
    }
  }

  async function saveGroup(group: string) {
    setGroupError("");
    setSavingGroup(true);
    try {
      await sendJson(url + "/group", "PUT", { groupId: group || null });
      setGroupId(group);
    } catch (error) {
      setGroupError(String(error));
    } finally {
      setSavingGroup(false);
    }
  }

  async function analyzeAgain() {
    setAnalyzing(true);
    setAnalysisError("");
    try {
      await sendJson(url + "/analyze", "POST", {});
      reload();
    } catch (error) {
      setAnalysisError(String(error));
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveTags() {
    setSavingReview(true);
    setReviewFeedback("");
    try {
      const updated = await sendJson<{ tags: string[]; reviewed: boolean }>(url + "/review", "PUT", {
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      setReviewed(updated.reviewed);
      setTags(updated.tags.join(", "));
      setSavedTags(updated.tags);
      setReviewFeedback("Review details saved.");
    } catch (error) {
      setReviewFeedback(String(error));
    } finally {
      setSavingReview(false);
    }
  }

  async function saveField(key: string) {
    if (!result) return;
    const amount = ["total_amount", "tax_amount", "net_amount"].includes(key);
    const cleaned = value.trim();
    if (amount && cleaned && !Number.isFinite(Number(cleaned))) {
      setFieldError("Enter a valid amount.");
      return;
    }
    setSavingField(true);
    setFieldError("");
    try {
      const updated = await sendJson<Pick<NonNullable<DocumentDetails["result"]>, "finalResult"> & { reviewed: boolean }>(
        url + "/corrections", "PUT", { fields: { [key]: cleaned ? (amount ? Number(cleaned) : cleaned) : null } }
      );
      setCorrections({ ...result, finalResult: updated.finalResult });
      setReviewed(updated.reviewed);
      setField(undefined);
    } catch (error) {
      setFieldError(String(error));
    } finally {
      setSavingField(false);
    }
  }

  async function ask() {
    setAsking(true);
    setAnswer(undefined);
    setQuestionError("");
    try {
      setAnswer(await sendJson<DocumentAnswer>(url + "/questions", "POST", { question }));
    } catch (error) {
      setQuestionError(String(error));
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-10 space-y-6">
      <Link className="text-blue-700 hover:underline" to="/documents">← {t("Documents")}</Link>
      <header className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-semibold break-all mb-2">{doc.originalFileName}</h1>
          <DocumentStatusBadge doc={{ status: doc.status, reviewed }} />
        </div>
        <div className="flex flex-wrap gap-2">
          {!processing(doc) && <Button variant="outline" disabled={analyzing || savingField}
            onClick={() => void analyzeAgain()}>{t("Reanalyze")}</Button>}
          {result && <ExportButtons id={doc.id} />}
          <DeleteDocumentButton doc={doc} onDeleted={() => navigate("/documents", { replace: true })} />
        </div>
      </header>
      {analysisError && <p role="alert" className="text-red-700">{analysisError}</p>}
      {doc.status === "Failed" && <p role="alert" className="text-red-700">{t(doc.errorMessage ?? "Extraction failed.")}</p>}
      {doc.status === "Cancelled" && <p role="status" className="text-orange-900">{t("Processing cancelled. You can reanalyze this document.")}</p>}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card id="document-preview" className="scroll-mt-6 bg-white p-5 lg:sticky lg:top-20">
          <div className="flex justify-between items-center gap-2">
            <h2 className="text-xl font-semibold">{t("Document preview")}</h2>
            {preview.href && <a className="text-blue-700 hover:underline" href={preview.href} target="_blank" rel="noreferrer">
              {t("Open original")}
            </a>}
          </div>
          {preview.error ? <p role="alert">{t(preview.error)}</p> : !preview.href
            ? <p role="status">{t("Loading document…")}</p> : doc.contentType === "application/pdf" ? (
            <iframe title={t("PDF preview")} src={preview.href} className="w-full h-[65vh] rounded border bg-slate-50" />
          ) : (
            <img className="max-h-[75vh] w-full object-contain" src={preview.href} alt={doc.originalFileName} />
          )}
        </Card>

        <div className="space-y-6">
          {!processing(doc) && doc.status !== "Cancelled" && <ManualReview doc={{ ...doc, reviewed, result, tags: savedTags }} reload={reload} />}
          <Card className="bg-white p-5 gap-4">
            <h2 className="text-xl font-semibold">{t("Extracted fields")}</h2>
            {processing(doc) && <p role="status">{t("Waiting for extraction…")}</p>}
            {result && !processing(doc) && Object.entries(result.finalResult.fields).map(([key, entry]) => {
              const gst = result.finalResult.fields.tax_type?.value === "GST";
              const label = gst && key === "tax_amount" ? "GST amount"
                : gst && key === "vat_rate" ? "GST rate"
                : fieldLabels[key] ?? key.replaceAll("_", " ");
              const missing = entry.value == null || entry.value === "";
              const displayValue = String(entry.value ?? "");
              const text = key === "document_type" ? t(({ invoice: "Invoice", receipt: "Receipt" } as Record<string, string>)[displayValue] ?? "Unknown")
                : key === "document_language" ? (/^[a-z]{2}$/.test(displayValue)
                  ? new Intl.DisplayNames([language], { type: "language" }).of(displayValue) ?? displayValue : t("Unknown"))
                : displayValue;
              const classification = key === "document_type" || key === "document_language";
              return (
                <div key={key} className="border-t pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t(label)}</span>
                    {entry.edited ? (
                      <Badge variant="secondary">{t("Corrected")}</Badge>
                    ) : missing ? (
                      <Badge variant="outline" className="text-red-800 border-red-200 bg-red-50">{t("Missing")}</Badge>
                    ) : entry.confidence !== undefined && (
                      <Badge variant="outline" className={entry.confidence >= 0.8
                        ? "text-emerald-800 border-emerald-200 bg-emerald-50"
                        : "text-amber-900 border-amber-200 bg-amber-50"}>
                        {Math.round(entry.confidence * 100)}% {t("extraction confidence")}
                      </Badge>
                    )}
                  </div>
                  {field === key ? (
                    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void saveField(key); }}>
                      <Input className="flex-1" aria-label={t(label)} value={value} disabled={savingField}
                        onChange={(event) => setValue(event.target.value)} />
                      <Button disabled={savingField}>{t("Save")}</Button>
                      <Button type="button" variant="ghost" disabled={savingField} onClick={() => setField(undefined)}>{t("Cancel")}</Button>
                      {fieldError && <p className="w-full text-red-700" role="alert">{fieldError}</p>}
                    </form>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="break-all">
                        <p>{missing ? "—" : text}</p>
                        {entry.edited && (
                          <p className="text-sm text-slate-500">
                            {t("Original")} {String(result.rawResult.fields[key]?.value ?? "—")}
                          </p>
                        )}
                      </div>
                      {!classification && <Button variant="outline" size="sm" disabled={savingField} aria-label={t("Edit") + " " + t(label)}
                        onClick={() => { setField(key); setValue(String(entry.value ?? "")); setFieldError(""); }}>{t("Edit")}</Button>}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>

          {items.length > 0 && (
            <Card className="bg-white p-5 gap-3">
              <h2 className="text-xl font-semibold">{t("Line items")}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="border-b">
                    <tr>{["Description", "ID", "Quantity", "Unit price", "Amount"].map((label) => (
                      <th key={label} scope="col" className="p-2 whitespace-nowrap">{t(label)}</th>
                    ))}</tr>
                  </thead>
                  <tbody>{items.map((item, index) => (
                    <tr key={index} className="border-b">
                      {[item.description, item.id, item.quantity, item.unit_price, item.amount].map((cell, column) => (
                        <td key={column} className="p-2">{cell ?? "—"}</td>
                      ))}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}
          {transcript && (
            <Card className="bg-white p-5 gap-3">
              <details>
                <summary className="font-semibold cursor-pointer">{t("Full text")}</summary>
                <pre className="mt-3 whitespace-pre-wrap break-words text-sm max-h-[32rem] overflow-auto">{transcript}</pre>
              </details>
            </Card>
          )}
          <Card className="bg-white p-5 gap-3">
            <h2 className="text-xl font-semibold">{t("Tags and groups")}</h2>
            <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void saveTags(); }}>
              <Input className="flex-1" aria-label={t("Tags, separated by commas")} placeholder={t("Tags, separated by commas")}
                value={tags} disabled={savingReview} onChange={(event) => setTags(event.target.value)} />
              <Button variant="outline" disabled={savingReview}>{t("Save tags")}</Button>
            </form>
            {reviewFeedback && <p role="status">{t(reviewFeedback)}</p>}
            <div className="space-y-2">
              <label htmlFor="document-group" className="block font-medium">{t("Group")}</label>
              <div className="flex gap-2">
                <select id="document-group" className="min-w-0 flex-1 border rounded-lg px-3 py-2 bg-white" value={groupId}
                  disabled={savingGroup || !groups} onChange={(event) => void saveGroup(event.target.value)}>
                  <option value="">{t("No group")}</option>
                  {[...groupOptions.values()].map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <Button variant="outline" size="icon" disabled={savingGroup}
                  aria-label={t("Create group")} title={t("Create group")}
                  onClick={() => setGroupName(groupName === undefined ? "" : undefined)}>
                  <Plus aria-hidden="true" />
                </Button>
              </div>
              {groupName !== undefined && (
                <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void createGroup(); }}>
                  <Input className="min-w-28 flex-1" aria-label={t("Group name")} placeholder={t("Group name")}
                    autoFocus value={groupName} onChange={(event) => setGroupName(event.target.value)}
                    maxLength={60} disabled={savingGroup} required />
                  <Button disabled={savingGroup || !groupName.trim()}>{t("Add")}</Button>
                </form>
              )}
            </div>
            {(groupError || groupsError) && <p role="alert" className="text-red-700">{groupError || groupsError}</p>}
          </Card>

          {result && (
            <Card className="bg-white p-5 gap-3">
              <h2 className="text-xl font-semibold">{t("Ask this document")}</h2>
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
                <Input aria-label={t("Question")} placeholder={t("e.g. What is the NIP?")} value={question}
                  maxLength={500} disabled={asking} onChange={(event) => setQuestion(event.target.value)} />
                <Button disabled={asking || !question.trim()}>{t(asking ? "Searching…" : "Ask")}</Button>
              </form>
              {questionError && <p role="alert" className="text-red-700">{questionError}</p>}
              {answer && (
                <div aria-live="polite" className="space-y-2">
                  <p className="whitespace-pre-line">{answer.answer ?? t("No matching text was found.")}</p>
                  {answer.citations.map((citation) => (
                    <blockquote key={citation.line} className="border-l-2 border-blue-300 pl-3 text-sm">
                      {citation.text}
                      <cite className="block text-slate-500">
                        {citation.page !== null && (t("Page") + " " + citation.page + " · ")}{t("Line")} {citation.line}
                      </cite>
                    </blockquote>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
