import type { DocumentDetails, DocumentGroup } from "../data/documents";
import type { Language } from "../data/preferences";
import { fixtureResult, fixtures } from "./fixtures";
import { baseName, mimeType, unpackArchive } from "./archive";

type DemoDocument = DocumentDetails & { batchId?: string; file?: File; fixture?: string; queuedAt?: number };
type DemoState = { language: Language | null; documents: DemoDocument[]; groups: DocumentGroup[] };
const email = "demo@documind.example";
const database = "documind-pages-demo-v1";
const sampleGroup = "demo-documents";
const noOcr = "Demo OCR is available for the included samples. Review this file manually.";
const missing = () => json({ error: "Document not found." }, 404);
const json = (data: unknown, status = 200) => Response.json(data, { status });
const busy = (doc: DemoDocument) => doc.status === "Processing" || doc.status === "Queued";

function initial(): DemoState {
  return {
    language: null,
    groups: [{ id: sampleGroup, name: "Demo", color: "#3b82f6" }],
    documents: fixtures.map((fixture, index) => ({
      id: fixture.id, originalFileName: fixture.name, contentType: "image/jpeg", status: "Done",
      createdAt: new Date(Date.UTC(2026, 0, 15, 10, index)).toISOString(),
      tags: ["demo", fixture.data.language], groupId: sampleGroup, reviewed: index === 2,
      errorMessage: null, result: fixtureResult(fixture.id), fixture: fixture.id,
    })),
  };
}

let connection: Promise<IDBDatabase> | undefined;
function db() {
  return connection ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(database, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("workspace");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function transact<T>(action: (state: DemoState) => T, reset = false): Promise<T> {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction("workspace", "readwrite");
    const store = transaction.objectStore("workspace");
    const load = store.get("state");
    let value: T;
    let error: unknown;
    load.onsuccess = () => {
      try {
        const state = reset ? initial() : (load.result as DemoState | undefined) ?? initial();
        advance(state);
        value = action(state);
        store.put(state, "state");
      } catch (cause) {
        error = cause;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(error ?? transaction.error);
  });
}

function advance(state: DemoState) {
  for (const doc of state.documents) {
    if (!busy(doc) || doc.queuedAt === undefined) continue;
    const elapsed = Date.now() - doc.queuedAt;
    if (elapsed < 1800) continue;
    if (elapsed < 6500) { doc.status = "Processing"; continue; }
    if (doc.fixture) {
      doc.result ??= fixtureResult(doc.fixture);
      doc.status = "Done";
    } else {
      doc.status = "Failed";
      doc.errorMessage = noOcr;
    }
  }
}

const fileView = ({ file, fixture, queuedAt, batchId, ...details }: DemoDocument) => details;
const summary = ({ result, errorMessage, ...doc }: DocumentDetails) => doc;

async function matchFixture(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return fixtures.find((fixture) => fixture.data.sha256 === hash)?.id;
}

async function normalizeUpload(file: File) {
  const name = baseName(file.name);
  const type = mimeType(name);
  if (!type || !file.size || file.size > 29_000_000 || name.length > 260) {
    throw new Error("Use a PDF, JPG or PNG file smaller than 29 MB.");
  }
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const signature = type === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10]
    : type === "image/jpeg" ? [255, 216, 255] : [37, 80, 68, 70, 45];
  if (!signature.every((byte, index) => header[index] === byte)) throw new Error("The file does not match its extension.");
  return new File([file], name, { type });
}

export async function uploadDemo(file: File, batchId: string, progress: (pct: number) => void) {
  progress(15);
  const archive = file.name.toLowerCase().endsWith(".zip");
  const { files, skipped } = archive ? await unpackArchive(file) : { files: [file], skipped: [] };
  const ready: { file: File; fixture?: string }[] = [];
  for (const input of files) {
    try {
      const normalized = await normalizeUpload(input);
      ready.push({ file: normalized, fixture: await matchFixture(normalized) });
    } catch (error) {
      if (!archive) throw error;
      skipped.push(input.name);
    }
  }
  if (!ready.length) throw new Error("The ZIP contains no supported documents.");
  const ids = await transact((state) => {
    const storedSize = state.documents.reduce((bytes, doc) => bytes + (doc.file?.size ?? 0), 0);
    if (storedSize + ready.reduce((bytes, entry) => bytes + entry.file.size, 0) > 100_000_000) {
      throw new Error("Demo storage is full. Delete files or reset the demo in Settings.");
    }
    const now = Date.now();
    return ready.map(({ file, fixture }) => {
      const id = crypto.randomUUID();
      state.documents.unshift({
        id, originalFileName: file.name, contentType: file.type, status: "Queued",
        createdAt: new Date(now).toISOString(), tags: [], groupId: null, reviewed: false,
        errorMessage: null, result: null, queuedAt: now, batchId, fixture, file,
      });
      return id;
    });
  });
  progress(100);
  return { ids, skipped };
}

function answer(doc: DemoDocument, question: string) {
  const lines = doc.result?.rawResult.debug?.full_text?.split("\n") ?? [];
  const fields = doc.result?.rawResult.fields ?? {};
  const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("ł", "l");
  const query = normalize(question);
  const intents: [RegExp, string, RegExp?][] = [
    [/nip|tax id/, /buyer|nabywc/.test(query) ? "buyer_nip" : "seller_nip"],
    [/vat|podat/, "tax_amount"],
    [/netto|\bnet\b/, "net_amount"],
    [/gross|brutto|do zaplaty|kwot|total/, "total_amount", /suma pln|total pln/],
    [/data|date|kiedy|when/, "invoice_date", /data wystawienia|issue date|^\d{2}\.\d{2}\.\d{4}$/],
    [/buyer|nabywc/, "buyer_name"],
    [/seller|vendor|sprzedawc/, "vendor_name"],
    [/numer|number/, fields.invoice_number ? "invoice_number" : "receipt_number"],
  ];
  const intent = intents.find(([match]) => match.test(query));
  const [, field, pattern] = intent ?? [];
  const value = field ? fields[field]?.value : null;
  if (value !== null && value !== undefined) {
    const isAmount = typeof value === "number";
    const alternatives = isAmount ? [value.toFixed(2), value.toFixed(2).replace(".", ",")]
      : [String(value), ...(field === "invoice_date" ? [String(value).split("-").reverse().join(".")] : [])];
    const citations = lines.flatMap((text, index) => pattern?.test(normalize(text)) ||
      alternatives.some((part) => text.includes(part)) ? [{ text, page: 1, line: index + 1 }] : []).slice(0, 3);
    if (citations.length) return { answer: String(value), citations };
  }
  const words = query.match(/[a-z0-9]{3,}/g)?.filter((word) => !/^(what|the|jest|jaka|jaki|ile|how|much|czy)$/.test(word)) ?? [];
  const hits = lines.map((text, index) => ({ text, page: 1, line: index + 1,
    score: words.filter((word) => normalize(text).includes(word)).length }))
    .filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, 3)
    .map(({ text, page, line }) => ({ text, page, line }));
  return { answer: hits[0]?.text ?? null, citations: hits };
}

function exportResult(docs: DemoDocument[], format: string, single: boolean) {
  if (!docs.length) return json({ error: "No approved documents to export." }, 400);
  const result = (doc: DemoDocument) => ({ model_version: doc.result?.modelVersion, ...doc.result?.finalResult });
  if (format === "json") return json(single ? result(docs[0]) : docs.map((doc) => ({
    documentId: doc.id, originalFileName: doc.originalFileName, result: result(doc),
  })));
  if (format !== "csv") return json({ error: "Unknown export format." }, 400);
  const fields = ["vendor_name", "invoice_date", "total_amount", "currency", "tax_amount", "invoice_number", "nip",
    "seller_nip", "buyer_nip", "seller_address", "buyer_address", "seller_regon", "buyer_regon", "seller_krs",
    "buyer_krs", "seller_vat_id", "buyer_vat_id", "tax_type", "seller_gst_id"];
  if (!single) fields.push("document_type", "receipt_number", "buyer_name", "net_amount");
  const keys = ["document_id", ...(single ? [] : ["original_file_name"]), "model_version", ...fields];
  const quote = (value: unknown) => {
    let cell = String(value ?? "");
    if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/u.test(cell)) cell = "'" + cell;
    return '"' + cell.replaceAll('"', '""') + '"';
  };
  return new Response([keys.map(quote).join(","), ...docs.map((doc) => [
    doc.id, ...(single ? [] : [doc.originalFileName]), doc.result?.modelVersion,
    ...fields.map((key) => doc.result?.finalResult.fields[key]?.value),
  ].map(quote).join(","))].join("\r\n"),
  { headers: { "Content-Type": "text/csv; charset=utf-8" } });
}

function patchFields(doc: DemoDocument, changes: Record<string, string | number | null>) {
  doc.result ??= { modelVersion: "demo-manual", rawResult: { fields: {} }, finalResult: { fields: {} } };
  for (const [key, value] of Object.entries(changes)) {
    Object.defineProperty(doc.result.finalResult.fields, key, {
      value: { value, edited: true }, enumerable: true, writable: true, configurable: true,
    });
  }
}

export async function demoRequest(path: string, options?: RequestInit): Promise<Response> {
  const url = new URL(path, location.origin);
  const route = url.pathname.split("/").filter(Boolean);
  const method = options?.method ?? "GET";
  const body = typeof options?.body === "string" ? JSON.parse(options.body) : {};
  const query = url.searchParams;
  const [, resource, id, op, format] = route;
  if (options?.signal?.aborted) throw options.signal.reason;
  if (path === "/api/demo/reset" && method === "POST") return transact(() => json({ ok: true }), true);
  if (resource === "auth") {
    if (id === "language" && method === "PUT" && ["en", "pl"].includes(body.language)) {
      return transact((state) => json({ email, language: state.language = body.language }));
    }
    if (id === "session") return transact((state) => json({ email, language: state.language }));
    return json({ error: "Account security is available in the full application." }, 403);
  }
  if (resource === "registries") {
    const party = fixtures.flatMap(({ data }) => [data.seller, data.buyer]).find((item) => item.nip === body.number);
    return json(["VAT", "KRS", "GUS", "CEIDG", "VIES"].map((source) => ({
      source, outcome: party && source === "VAT" ? "found" : "notApplicable",
      company: party && source === "VAT" ? party : null, status: null, date: null, reference: "DEMO",
    })));
  }
  if (resource === "document-groups") return transact((state) => {
    if (method === "GET") return json(state.groups);
    const name = String(body.name ?? "").trim();
    const color = String(body.color ?? "");
    if (!name || name.length > 60 || !/^#[0-9a-f]{6}$/i.test(color)) return json({ error: "Invalid group." }, 400);
    if (state.groups.some((group) => group.id !== id && group.name.toLowerCase() === name.toLowerCase())) {
      return json({ error: "A group with this name already exists." }, 409);
    }
    const existing = state.groups.find((group) => group.id === id);
    if (method === "PUT" && !existing) return missing();
    const group = existing ?? { id: crypto.randomUUID(), name, color };
    Object.assign(group, { name, color });
    if (!existing) state.groups.push(group);
    const doc = state.documents.find((doc) => doc.id === body.documentId);
    if (doc) doc.groupId = group.id;
    return json(group);
  });
  if (resource !== "documents") return missing();
  if (op === "content") {
    const doc = await transact((state) => state.documents.find((doc) => doc.id === id));
    if (!doc) return missing();
    if (doc.file) return new Response(doc.file, { headers: { "Content-Type": doc.contentType } });
    const asset = fixtures.find((fixture) => fixture.id === doc.fixture);
    return asset ? fetch(asset.url, { signal: options?.signal }) : missing();
  }
  return transact((state) => {
    const batchId = query.get("batchId");
    const list = state.documents.filter((doc) => !batchId || doc.batchId === batchId);
    if (id === "status-counts") {
      return json(Object.fromEntries(["Queued", "Processing", "Done", "Failed", "Cancelled"]
        .map((status) => [status.toLowerCase(), list.filter((doc) => doc.status === status).length])));
    }
    if (id === "batches" && format === "cancel" && method === "POST") {
      const active = state.documents.filter((doc) => doc.batchId === op && busy(doc));
      active.forEach((doc) => { doc.status = "Cancelled"; });
      return json({ cancelled: active.length });
    }
    if (id === "export" && op === "approved") {
      return exportResult(list.filter((doc) => doc.status === "Done" && doc.reviewed && doc.result), format, false);
    }
    if (!id) {
      const term = query.get("search")?.trim().toLowerCase();
      const status = query.get("status");
      const reviewed = query.get("reviewed");
      const group = query.get("groupId");
      const start = (Math.max(1, Number(query.get("page")) || 1) - 1) * 100;
      const filtered = list.filter((doc) =>
        (!status || doc.status === status) && (!group || doc.groupId === group) &&
        (reviewed === null || (doc.status === "Done" && String(doc.reviewed) === reviewed)) &&
        (!query.has("reviewQueue") || (!doc.reviewed && (doc.status === "Done" || doc.status === "Failed"))) &&
        (!term || [doc.originalFileName, ...doc.tags].some((value) => value.toLowerCase().includes(term))));
      return json({ items: filtered.slice(start, start + 100).map((doc) => summary(fileView(doc))), hasMore: filtered.length > start + 100 });
    }
    const doc = list.find((entry) => entry.id === id);
    if (!doc) return missing();
    if (!op && method === "DELETE") {
      state.documents = state.documents.filter((entry) => entry.id !== id);
      return json({ id });
    }
    if (!op) return json(fileView(doc));
    if (op === "group") {
      if (body.groupId && !state.groups.some((entry) => entry.id === body.groupId)) return missing();
      doc.groupId = body.groupId ?? null;
      return json({ groupId: doc.groupId });
    }
    if (op === "analyze") {
      if (busy(doc)) return json({ error: "Document is already queued or processing." }, 409);
      Object.assign(doc, { status: "Queued", queuedAt: Date.now(), reviewed: false, errorMessage: null });
      return json({ id, status: doc.status }, 202);
    }
    if (op === "questions") return json(answer(doc, String(body.question ?? "")));
    if (op === "export" && doc.result) return exportResult([doc], format, true);
    if (op === "review" || op === "corrections") {
      const changes = body.fields ?? {};
      const edits = Object.keys(changes).length > 0;
      if ((edits || body.reviewed) && busy(doc)) return json({ error: "Review is available when processing has finished." }, 409);
      if (body.reviewed) {
        const values = { ...Object.fromEntries(Object.entries(doc.result?.finalResult.fields ?? {})
          .map(([key, field]) => [key, field.value])), ...changes };
        const required = ["document_type", "vendor_name", "invoice_date", "total_amount", "currency"];
        if (values.document_type === "invoice") required.push("invoice_number");
        if (!body.previewChecked || required.some((key) => values[key] === undefined || values[key] === null || values[key] === "")) {
          return json({ error: "Check the original and complete the required fields before approving." }, 422);
        }
      }
      if (edits) patchFields(doc, changes);
      if (Array.isArray(body.tags)) doc.tags = Array.from(new Set(body.tags));
      doc.reviewed = body.reviewed ?? (doc.reviewed && !edits);
      if (doc.reviewed && doc.status === "Failed") { doc.status = "Done"; doc.errorMessage = null; }
      return json({ tags: doc.tags, reviewed: doc.reviewed, finalResult: doc.result?.finalResult });
    }
    return missing();
  });
}
