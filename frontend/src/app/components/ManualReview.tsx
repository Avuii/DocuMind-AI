import { useState } from "react";
import { Link } from "react-router";
import { documentUrl, sendJson } from "../data/documents";
import type { DocumentDetails } from "../data/documents";
import { useI18n } from "../data/preferences";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { RegistryLookup } from "./RegistryLookup";

const fields = [
  ["document_type", "Document type"],
  ["vendor_name", "Seller"],
  ["invoice_number", "Invoice number"],
  ["receipt_number", "Receipt number"],
  ["invoice_date", "Invoice date"],
  ["total_amount", "Gross amount"],
  ["currency", "Currency"],
  ["net_amount", "Net amount"],
  ["tax_amount", "VAT amount"],
  ["buyer_name", "Buyer"],
  ["seller_nip", "Seller NIP"],
  ["seller_gst_id", "Seller GST number"],
  ["buyer_nip", "Buyer NIP"],
  ["seller_address", "Seller address"],
  ["buyer_address", "Buyer address"],
  ["seller_regon", "Seller REGON"],
  ["buyer_regon", "Buyer REGON"],
  ["seller_krs", "Seller KRS"],
  ["buyer_krs", "Buyer KRS"],
  ["seller_vat_id", "Seller EU VAT number"],
  ["buyer_vat_id", "Buyer EU VAT number"],
  ["nip", "NIP"],
] as const;

type Field = typeof fields[number][0];
type Values = Partial<Record<Field, string>>;
const amounts = new Set<Field>(["total_amount", "net_amount", "tax_amount"]);
const numberText = (value: string) => value.trim().replace(/\s/g, "").replace(",", ".");
const isAmount = (value: string) => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(numberText(value))
  && Number.isFinite(Number(numberText(value)));

export function ManualReview({ doc, reload }: { doc: DocumentDetails; reload: () => void }) {
  const { t } = useI18n();
  const initial: Values = Object.fromEntries(fields.map(([key]) =>
    [key, String(doc.result?.finalResult.fields[key]?.value ?? "")]));
  const [changes, setChanges] = useState<Values>({});
  const values = { ...initial, ...changes };
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kind = values.document_type;
  const gst = doc.result?.finalResult.fields.tax_type?.value === "GST";
  const required: Field[] = ["document_type", "vendor_name", "invoice_date", "total_amount", "currency"];
  if (kind === "invoice") required.push("invoice_number");
  const invalid = (key: Field) => {
    const value = (values[key] ?? "").trim();
    if (!value) return required.includes(key);
    if (key === "document_type") return value !== "invoice" && value !== "receipt";
    if (key === "currency") return !/^[A-Z]{3}$/.test(value);
    if (key === "invoice_date") return !/^\d{4}-\d{2}-\d{2}$/.test(value);
    return amounts.has(key) && !isAmount(value);
  };
  const visibleFields = fields.filter(([key]) =>
    (key !== "receipt_number" || kind === "receipt") && (key !== "invoice_number" || kind !== "receipt") &&
    (key !== "seller_gst_id" || gst || Boolean(values.seller_gst_id)))
    .map(([key, label]) => [key, key === "tax_amount" && gst ? "GST amount" : label] as const);
  const issues = visibleFields.filter(([key]) => invalid(key)).map(([, label]) => t(label));
  const dirty = visibleFields.some(([key]) => changes[key] !== undefined && changes[key] !== initial[key]);
  const needsReview = !doc.reviewed || dirty;

  async function save(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const updates = Object.fromEntries(visibleFields
        .filter(([key]) => changes[key] !== undefined && changes[key] !== initial[key])
        .map(([key]) => {
          const value = (changes[key] ?? "").trim();
          return [key, value && amounts.has(key) && isAmount(value) ? Number(numberText(value))
            : value && key === "currency" ? value.toUpperCase() : value || null];
        }));
      await sendJson(documentUrl(doc.id) + "/review", "PUT", {
        tags: doc.tags, reviewed: approve, previewChecked: checked, fields: updates,
      });
      reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="manual-review" className="scroll-mt-6 bg-white p-5 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{t("Review document data")}</h2>
        <Link className="text-sm text-blue-700 hover:underline" to="/exports">{t("Review list")}</Link>
      </div>
      {needsReview && issues.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p><strong>{t("Missing or invalid fields")}</strong> · {issues.join(", ")}</p>
          <button type="button" className="cursor-pointer font-medium underline"
            onClick={() => document.getElementById("document-preview")?.scrollIntoView({ block: "start" })}>
            {t("Check the original in the preview")}
          </button>
        </div>
      )}
      <RegistryLookup values={values} disabled={busy} apply={(updates) => {
        setChanges((previous) => ({ ...previous, ...updates }));
        setChecked(false);
      }} />
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (checked && issues.length === 0 && needsReview) void save(true);
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleFields.map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm font-medium">
              <span>{t(label)}{required.includes(key) && " *"}</span>
              {key === "document_type" ? (
                <select disabled={busy} aria-invalid={invalid(key)} className="h-9 w-full rounded-md border bg-white px-2"
                  value={kind === "invoice" || kind === "receipt" ? kind : ""}
                  onChange={(event) => setChanges({ ...changes, [key]: event.target.value })}>
                  <option value="">{t("Choose document type")}</option>
                  <option value="invoice">{t("Invoice")}</option>
                  <option value="receipt">{t("Receipt")}</option>
                </select>
              ) : (
                <Input disabled={busy} aria-invalid={invalid(key)} value={values[key] ?? ""}
                  placeholder={key === "invoice_date" ? "YYYY-MM-DD" : undefined}
                  inputMode={amounts.has(key) ? "decimal" : undefined}
                  maxLength={key === "currency" ? 3 : 300}
                  onChange={(event) => setChanges({ ...changes, [key]: key === "currency"
                    ? event.target.value.toUpperCase() : event.target.value })} />
              )}
            </label>
          ))}
        </div>
        {needsReview && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={checked} disabled={busy}
              onChange={(event) => setChecked(event.target.checked)} />
            {t("I checked these values against the original.")}
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {needsReview ? (
            <>
              <Button disabled={busy || !checked || issues.length > 0}>{t("Approve data")}</Button>
              <Button type="button" variant="outline" disabled={busy || !dirty} onClick={() => void save(false)}>{t("Save draft")}</Button>
            </>
          ) : (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void save(false)}>{t("Reopen review")}</Button>
          )}
        </div>
      </form>
      {error && <p role="alert" className="text-red-700">{t(error)}</p>}
    </Card>
  );
}
