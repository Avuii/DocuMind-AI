import { useRef, useState } from "react";
import { Link, useOutletContext } from "react-router";
import {
  Upload,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { documentsUrl, hasProcessing, sendJson, statusLabel, uploadDocument, useDocuments } from "../data/documents";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import type { DocumentStatus, DocumentSummary } from "../data/documents";
import { useI18n } from "../data/preferences";
import type { AccountContext } from "./RootLayout";
import { demoMode } from "../demo/mode";

type StatusCounts = Record<Lowercase<DocumentStatus>, number>;
const pollStatusCounts = () => true;
const loadDemoFixtures = import.meta.env.MODE === "demo" ? () => import("../demo/fixtures") : undefined;

export function Dashboard() {
  const { t, language } = useI18n();
  const { account } = useOutletContext<AccountContext>();
  const batchStorageKey = "documind:last-upload:" + account.email.toLowerCase();
  const [batchId, setBatchId] = useState(() => sessionStorage.getItem(batchStorageKey));
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadResult, setUploadResult] = useState<{ count: number; skipped: string[]; errors: string[] }>();
  const [uploadVersion, setUploadVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const stopAfterTransfer = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");
  const [cancelError, setCancelError] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [sampleError, setSampleError] = useState(false);
  const { data, error } = useDocuments<{ items: DocumentSummary[] }>(documentsUrl + "?v=" + uploadVersion, hasProcessing);
  const documents = data?.items ?? [];
  const { data: counts, error: countsError } = useDocuments<StatusCounts>(
    documentsUrl + "/status-counts?v=" + uploadVersion, pollStatusCounts
  );
  const { data: batchCounts, error: batchError } = useDocuments<StatusCounts>(
    batchId ? documentsUrl + "/status-counts?batchId=" + batchId + "&v=" + uploadVersion : null, pollStatusCounts
  );
  const workflowCount = (status: keyof StatusCounts) =>
    formatCount(batchCounts?.[status] ?? (batchError ? undefined : 0));
  const workflowLink = (status: DocumentStatus) =>
    "/documents?" + new URLSearchParams({ status, ...(batchId ? { batchId } : {}) });
  const formatCount = (count?: number) => count?.toLocaleString(language) ?? "—";

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void upload(Array.from(e.dataTransfer.files));
  };

  async function upload(files: File[]) {
    if (!files.length || uploading.current || cancelling) return;
    uploading.current = true;
    stopAfterTransfer.current = false;
    setCancelMessage("");
    setCancelError(false);
    const nextBatch = crypto.randomUUID();
    sessionStorage.setItem(batchStorageKey, nextBatch);
    setBatchId(nextBatch);
    setUploadResult(undefined);
    setUploadProgress(0);
    const ids: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        if (stopAfterTransfer.current) break;
        try {
          const result = await uploadDocument(file, nextBatch, (progress) =>
            setUploadProgress(Math.round((index * 100 + progress) / files.length)));
          ids.push(...result.ids);
          skipped.push(...result.skipped.map((name) => file.name + " / " + name));
        } catch (error) {
          errors.push(file.name + " — " + (error instanceof Error ? error.message : String(error)));
        }
      }
      setUploadResult({ count: ids.length, skipped, errors });
      setUploadVersion((version) => version + 1);
    } finally {
      uploading.current = false;
      setUploadProgress(null);
      if (stopAfterTransfer.current) await stopBatch(nextBatch);
    }
  }

  async function stopBatch(id: string) {
    setCancelling(true);
    setCancelError(false);
    try {
      const { cancelled } = await sendJson<{ cancelled: number }>(
        documentsUrl + "/batches/" + id + "/cancel", "POST", {});
      setCancelMessage(t("Documents cancelled") + " · " + formatCount(cancelled));
      setUploadVersion((version) => version + 1);
    } catch {
      setCancelError(true);
    } finally {
      setCancelling(false);
    }
  }

  async function loadSamples() {
    if (!loadDemoFixtures) return;
    setLoadingSamples(true);
    setSampleError(false);
    try {
      const { sampleFiles } = await loadDemoFixtures();
      const files = await sampleFiles();
      setLoadingSamples(false);
      await upload(files);
    } catch {
      setSampleError(true);
    } finally {
      setLoadingSamples(false);
    }
  }

  function requestCancellation() {
    if (!batchId || cancelling) return;
    if (uploading.current) {
      stopAfterTransfer.current = true;
      setCancelling(true);
    } else {
      void stopBatch(batchId);
    }
  }

  const getStatusBadge = (doc: DocumentSummary) => {
    switch (doc.status) {
      case "Queued":
        return (
          <Badge
            variant="secondary"
            className="bg-slate-100 text-slate-700 border-slate-200"
          >
            <Clock className="w-3 h-3 mr-1" />
            {t("Queued")}
          </Badge>
        );
      case "Processing":
        return (
          <Badge
            variant="secondary"
            className="bg-blue-50 text-blue-700 border-blue-200"
          >
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            {t("Processing")}
          </Badge>
        );
      case "Done":
        return (
          <Badge
            variant="secondary"
            className="bg-emerald-50 text-emerald-700 border-emerald-200"
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            {t(statusLabel(doc))}
          </Badge>
        );
      case "Failed":
        return (
          <Badge
            variant="secondary"
            className="bg-red-50 text-red-700 border-red-200"
          >
            <XCircle className="w-3 h-3 mr-1" />
            {t("Failed")}
          </Badge>
        );
      case "Cancelled":
        return <DocumentStatusBadge doc={doc} />;
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto px-8 py-12">
      {/* Hero Section */}
      <div className="mb-16">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold text-slate-900 mb-4 tracking-tight">
            {t("Invoice & Receipt Extraction")}
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed mb-8">
            {t("Upload invoices and receipts, review extracted data, and export to JSON or CSV.")}
          </p>
          <div className="flex items-center gap-4">
            <Button
              size="lg"
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm h-11 px-6 rounded-xl"
              onClick={() =>
                document.getElementById("upload-zone")?.scrollIntoView({
                  behavior: "smooth",
                })
              }
            >
              <Upload className="w-4 h-4 mr-2" />
              {t("Upload Document")}
            </Button>
            <Link to="/documents">
              <Button
                size="lg"
                variant="outline"
                className="h-11 px-6 rounded-xl border-slate-300 hover:bg-slate-50"
              >
                {t("View Documents")}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <Card className="p-6 border-slate-200 shadow-sm hover:shadow-md transition-shadow bg-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-slate-600" />
            </div>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {formatCount(counts && counts.queued + counts.processing + counts.done + counts.failed)}
          </div>
          <div className="text-sm text-slate-600">{t("All Documents")}</div>
        </Card>

        <Card className="p-6 border-blue-200 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-blue-50 to-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Loader2 className={`w-5 h-5 text-blue-600 ${counts?.processing ? "motion-safe:animate-spin" : ""}`} />
            </div>
          </div>
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {formatCount(counts?.processing)}
          </div>
          <div className="text-sm text-slate-600">{t("Processing Now")}</div>
        </Card>

        <Card className="p-6 border-emerald-200 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-emerald-50 to-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {formatCount(counts?.done)}
          </div>
          <div className="text-sm text-slate-600">{t("Completed")}</div>
        </Card>

        <Card className="p-6 border-red-200 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-red-50 to-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-600" />
            </div>
          </div>
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {formatCount(counts?.failed)}
          </div>
          <div className="text-sm text-slate-600">{t("Failed")}</div>
        </Card>
      </div>

      {/* Upload Section */}
      <Card
        id="upload-zone"
        className="p-8 border-2 border-dashed border-slate-300 hover:border-blue-400 transition-colors bg-white shadow-sm mb-12"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center">
          <div
            className={`w-16 h-16 mx-auto mb-6 rounded-2xl flex items-center justify-center transition-all ${
              isDragging
                ? "bg-blue-600 scale-110"
                : "bg-gradient-to-br from-slate-100 to-slate-200"
            }`}
          >
            <Upload
              className={`w-7 h-7 ${
                isDragging ? "text-white" : "text-slate-600"
              }`}
            />
          </div>
          <h3 className="text-xl font-semibold text-slate-900 mb-2">
            {t(isDragging ? "Drop your files here" : "Upload Documents")}
          </h3>
          <p className="text-slate-600 mb-6">
            {t("Drag and drop your files or click to browse")}
          </p>
          <p className="text-sm text-slate-500 mb-6">
            {t("PDF, JPG, PNG and ZIP")} · 30 MB
          </p>
          <input
            ref={input}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.zip"
            multiple
            className="hidden"
            onChange={(event) => {
              void upload(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <Button
            variant="outline"
            className="border-slate-300 hover:bg-slate-50 rounded-xl"
            disabled={uploadProgress !== null || cancelling || loadingSamples}
            onClick={() => input.current?.click()}
          >
            {t("Browse Files")}
          </Button>
          {demoMode && <Button className="ml-2" disabled={uploadProgress !== null || cancelling || loadingSamples}
            onClick={() => void loadSamples()}>{t(loadingSamples ? "Loading demo samples…" : "Process demo samples")}</Button>}
        </div>
        {sampleError && <p role="alert" className="mt-3 text-center text-red-700">{t("Could not load demo samples.")}</p>}

        {uploadResult && (
          <div role="status" className="mt-5 space-y-2 max-w-lg mx-auto">
            <p>{t("Documents queued")} · {uploadResult.count}</p>
            {uploadResult.skipped.length > 0 && <p className="text-amber-800 break-all">
              {t("Skipped")} · {uploadResult.skipped.join(", ")}
            </p>}
            {uploadResult.errors.length > 0 && <ul className="text-red-700">
              {uploadResult.errors.map((message, index) => <li key={index} className="break-all">{message}</li>)}
            </ul>}
          </div>
        )}
        {uploadProgress !== null && (
          <div className="mt-8 max-w-md mx-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">
                {t("Uploading…")}
              </span>
              <span className="text-sm text-slate-600">{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}
      </Card>

      {/* Processing Flow */}
      <div className="mb-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-slate-900">{t("Processing Workflow")}</h2>
          {batchId && (uploadProgress !== null || cancelling || cancelError || batchCounts?.queued || batchCounts?.processing)
            ? <Button variant="outline" className="text-red-700" disabled={cancelling} onClick={requestCancellation}>
                {t(cancelling ? "Cancelling…" : "Cancel batch processing")}
              </Button> : null}
        </div>
        {cancelling && uploadProgress !== null && <p role="status" className="mb-3 text-sm">
          {t("The current transfer will finish before processing is cancelled. Remaining files will not upload.")}
        </p>}
        {cancelMessage && <p role="status" className="mb-3 text-sm">{cancelMessage}</p>}
        {cancelError && <p role="alert" className="mb-3 text-sm text-red-700">{t("Could not cancel batch processing. Try again.")}</p>}
        {!batchId && <p className="mb-3 text-sm text-slate-600">{t("Upload files to track a batch here.")}</p>}
        {(countsError || batchError) && <p role="status" className="mb-3 text-sm text-amber-800">{t("Could not refresh document counts.")}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link to={workflowLink("Queued")} className="rounded-xl hover:ring-2 hover:ring-slate-300">
          <Card className="h-full p-6 border-slate-200 shadow-sm bg-white">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-4">
              <Clock className="w-6 h-6 text-slate-600" />
            </div>
            <h3 className="flex items-baseline justify-between gap-2 font-semibold text-slate-900">
              {t("Queued")} <span className="text-3xl tabular-nums">{workflowCount("queued")}</span>
            </h3>
            <p className="text-sm text-slate-600">
              {t("Document uploaded and waiting for processing")}
            </p>
          </Card>
          </Link>

          <Link to={workflowLink("Processing")} className="rounded-xl hover:ring-2 hover:ring-blue-300">
          <Card className="h-full p-6 border-blue-200 shadow-sm bg-gradient-to-br from-blue-50 to-white">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4">
              <Loader2 className={`w-6 h-6 text-blue-600 ${batchCounts?.processing ? "motion-safe:animate-spin" : ""}`} />
            </div>
            <h3 className="flex items-baseline justify-between gap-2 font-semibold text-slate-900">
              {t("Processing")} <span className="text-3xl tabular-nums">{workflowCount("processing")}</span>
            </h3>
            <p className="text-sm text-slate-600">
              {t("AI extracting key fields from document")}
            </p>
          </Card>
          </Link>

          <Link to={workflowLink("Done")} className="rounded-xl hover:ring-2 hover:ring-emerald-300">
          <Card className="h-full p-6 border-emerald-200 shadow-sm bg-gradient-to-br from-emerald-50 to-white">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="flex items-baseline justify-between gap-2 font-semibold text-slate-900">
              {t("Done")} <span className="text-3xl tabular-nums">{workflowCount("done")}</span>
            </h3>
            <p className="text-sm text-slate-600">
              {t("Extraction complete, ready for review")}
            </p>
          </Card>
          </Link>

          <Link to={workflowLink("Failed")} className="rounded-xl hover:ring-2 hover:ring-red-300">
          <Card className="h-full p-6 border-red-200 shadow-sm bg-gradient-to-br from-red-50 to-white">
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mb-4">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="flex items-baseline justify-between gap-2 font-semibold text-slate-900">
              {t("Failed")} <span className="text-3xl tabular-nums">{workflowCount("failed")}</span>
            </h3>
            <p className="text-sm text-slate-600">
              {t("Processing error, manual review needed")}
            </p>
          </Card>
          </Link>
        </div>
        {!!batchCounts?.cancelled && <Link to={workflowLink("Cancelled")}
          className="mt-4 inline-flex rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 hover:underline">
          {t("Cancelled")} · {workflowCount("cancelled")}
        </Link>}
      </div>

      {/* Recent Documents Preview */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-slate-900">
            {t("Recent Documents")}
          </h2>
          <Link to="/documents">
            <Button
              variant="ghost"
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            >
              {t("View All")}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>

        <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
          <div className="divide-y divide-slate-100">
            {error && <p role="alert" className="p-4 text-red-700">{error}</p>}
            {data && documents.length === 0 && <p className="p-4">{t("No documents yet.")}</p>}
            {documents.slice(0, 5).map((doc) => (
              <Link
                key={doc.id}
                to={`/documents/${doc.id}`}
                className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 truncate group-hover:text-blue-600 transition-colors">
                      {doc.originalFileName}
                    </div>
                    <div className="text-sm text-slate-500">{new Date(doc.createdAt).toLocaleString(language)}</div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="min-w-[120px] flex justify-end">
                    {getStatusBadge(doc)}
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
