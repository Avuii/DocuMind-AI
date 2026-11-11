import { useEffect, useState } from "react";
import { demoMode } from "../demo/mode";

export const request = (url: string, options?: RequestInit) => import.meta.env.MODE === "demo"
  ? import("../demo/api").then(({ demoRequest }) => demoRequest(url, options))
  : fetch(url, options);

export type DocumentStatus = "Queued" | "Processing" | "Done" | "Failed" | "Cancelled";

export interface DocumentSummary {
  id: string;
  originalFileName: string;
  contentType: string;
  status: DocumentStatus;
  createdAt: string;
  tags: string[];
  reviewed: boolean;
  groupId: string | null;
}

type FieldValue = string | number | boolean | null;

interface Extraction {
  fields: Record<string, { value: FieldValue; confidence?: number; edited?: boolean }>;
  debug?: { full_text?: string };
  line_items?: { description?: string; quantity?: string; id?: string; unit_price?: string; amount?: string }[];
}

export interface DocumentDetails extends DocumentSummary {
  errorMessage: string | null;
  result: {
    modelVersion: string;
    rawResult: Extraction;
    finalResult: Extraction;
  } | null;
}

export interface DocumentAnswer {
  answer: string | null;
  citations: { text: string; page: number | null; line: number }[];
}

export const documentsUrl = "/api/documents";
export const groupsUrl = "/api/document-groups";
const legacyGroupColors: Record<string, string> = {
  slate: "#64748b", blue: "#3b82f6", green: "#22c55e",
  amber: "#f59e0b", rose: "#f43f5e", violet: "#8b5cf6",
};
export const groupColor = (color: string) =>
  /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : legacyGroupColors[color] ?? "#64748b";
export const groupStyle = (color: string) => ({
  borderColor: groupColor(color),
  backgroundColor: groupColor(color) + "33",
});
export type DocumentGroup = { id: string; name: string; color: string };
export const documentUrl = (id: string) => documentsUrl + "/" + encodeURIComponent(id);

export function statusLabel(doc: Pick<DocumentSummary, "status" | "reviewed">) {
  return doc.status === "Done" ? (doc.reviewed ? "Reviewed" : "Needs review") : doc.status;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const sessionExpiredEvent = "documind-session-expired";

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await request(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 && !url.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event(sessionExpiredEvent));
    }
    throw new ApiError(response.status, body?.error ?? body?.title ?? ("Request failed (" + response.status + ")"));
  }
  return response.json();
}

export function sendJson<T>(url: string, method: "POST" | "PUT", data: unknown) {
  return api<T>(url, {
    method,
    headers: { "Content-Type": "application/json", "X-DocuMind-Request": "1" },
    body: JSON.stringify(data),
  });
}

export function useDocuments<T>(url: string | null, poll?: (data: T) => boolean) {
  const [state, setState] = useState<{ url: string; data?: T; error?: string }>();
  useEffect(() => {
    if (url == null) return;
    const requestUrl = url;
    const controller = new AbortController();
    let timer: number | undefined;

    async function load() {
      try {
        const data = await api<T>(requestUrl, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState({ url: requestUrl, data });
        if (poll?.(data)) timer = window.setTimeout(load, 3000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((previous) => ({ url: requestUrl,
          data: previous?.url === requestUrl ? previous.data : undefined, error: String(error) }));
        if (poll) timer = window.setTimeout(load, 3000);
      }
    }

    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [url, poll]);
  return state?.url === url ? state : {};
}

export const processing = (doc: DocumentSummary) =>
  doc.status === "Queued" || doc.status === "Processing";

export const hasProcessing = (list: { items: DocumentSummary[] }) =>
  list.items.some(processing);

export function uploadDocument(file: File, batchId: string, onProgress: (percentage: number) => void) {
  if (import.meta.env.MODE === "demo") return import("../demo/api").then(({ uploadDemo }) => uploadDemo(file, batchId, onProgress));
  return new Promise<{ ids: string[]; skipped: string[] }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const archive = file.name.toLowerCase().endsWith(".zip");
    request.open("POST", documentsUrl + (archive ? "/archive" : ""));
    request.setRequestHeader("X-DocuMind-Request", "1");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(100 * event.loaded / event.total));
    };
    request.onerror = () => reject(new Error("Could not connect to the document API."));
    request.onload = () => {
      if (request.status === 401) window.dispatchEvent(new Event(sessionExpiredEvent));
      if (request.status >= 200 && request.status < 300 && (request.response?.id || request.response?.ids)) {
        resolve(archive ? request.response : { ids: [request.response.id], skipped: [] });
      } else {
        reject(new Error(request.response?.error ?? ("Upload failed (" + request.status + ")")));
      }
    };
    const data = new FormData();
    data.append("file", file);
    data.append("batchId", batchId);
    request.send(data);
  });
}

export function useDocumentContent(id: string, onError: string) {
  const url = documentUrl(id) + "/content";
  const [state, setState] = useState<{ url: string; href?: string; error?: string }>();
  useEffect(() => {
    if (!demoMode) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    request(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(onError);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ url, href: objectUrl });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ url, error: onError });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, onError]);
  return demoMode ? (state?.url === url ? state : {}) : { href: url };
}
