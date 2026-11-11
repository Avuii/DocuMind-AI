import type { DocumentDetails } from "../data/documents";
import invoicePl from "./fixtures/invoice-pl.json";
import receiptPl from "./fixtures/receipt-pl.json";
import invoiceEn from "./fixtures/invoice-en.json";
import invoicePlUrl from "./fixtures/invoice-pl.jpg?url";
import receiptPlUrl from "./fixtures/receipt-pl.jpg?url";
import invoiceEnUrl from "./fixtures/invoice-en.jpg?url";

export const fixtures = [
  { id: "invoice-pl", name: "Faktura-VAT-demo.jpg", url: invoicePlUrl, data: invoicePl },
  { id: "receipt-pl", name: "Paragon-fiskalny-demo.jpg", url: receiptPlUrl, data: receiptPl },
  { id: "invoice-en", name: "VAT-invoice-demo.jpg", url: invoiceEnUrl, data: invoiceEn },
];

export function fixtureResult(id: string): DocumentDetails["result"] {
  const fixture = fixtures.find((entry) => entry.id === id);
  if (!fixture) return null;
  const data = fixture.data;
  const invoice = data.document_type === "invoice";
  const values = {
    document_type: data.document_type, document_language: data.language,
    [invoice ? "invoice_number" : "receipt_number"]: data.number,
    vendor_name: data.seller.name, seller_address: data.seller.address, seller_nip: data.seller.nip,
    buyer_nip: data.buyer.nip, buyer_name: "name" in data.buyer ? data.buyer.name : undefined,
    buyer_address: "address" in data.buyer ? data.buyer.address : undefined,
    invoice_date: data.issue_date, sale_date: data.sale_date,
    due_date: "due_date" in data ? data.due_date : undefined, currency: data.currency,
    total_amount: Number(data.totals.gross), tax_amount: Number(data.totals.vat),
    net_amount: invoice ? Number(data.totals.net) : undefined,
  };
  const rawResult = {
    fields: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, { value: value ?? null, confidence: 0.96 }])),
    debug: { full_text: data.text.join("\n") },
    line_items: data.line_items.map((row) => ({
      description: row.description, quantity: String(row.quantity), amount: row.gross,
      unit_price: "unit_net" in row ? row.unit_net : row.unit_gross,
    })),
  };
  return { modelVersion: "demo-fixture", rawResult, finalResult: structuredClone(rawResult) };
}

export async function sampleFiles(): Promise<File[]> {
  return Promise.all(fixtures.map(async (fixture) => {
    const response = await fetch(fixture.url);
    if (!response.ok) throw new Error("Could not load demo samples.");
    return new File([await response.blob()], fixture.name, { type: "image/jpeg" });
  }));
}
