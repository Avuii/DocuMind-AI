import { useState } from "react";
import { Link } from "react-router";
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
import { mockDocuments, DocumentStatus } from "../data/mockData";

export function Dashboard() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const stats = {
    total: mockDocuments.length,
    processing: mockDocuments.filter((d) => d.status === "processing").length,
    completed: mockDocuments.filter((d) => d.status === "done").length,
    failed: mockDocuments.filter((d) => d.status === "failed").length,
  };

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
    // Simulate upload
    setUploadProgress(0);
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev === null) return 0;
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => setUploadProgress(null), 1000);
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  const getStatusBadge = (status: DocumentStatus) => {
    switch (status) {
      case "queued":
        return (
          <Badge
            variant="secondary"
            className="bg-slate-100 text-slate-700 border-slate-200"
          >
            <Clock className="w-3 h-3 mr-1" />
            Queued
          </Badge>
        );
      case "processing":
        return (
          <Badge
            variant="secondary"
            className="bg-blue-50 text-blue-700 border-blue-200"
          >
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      case "done":
        return (
          <Badge
            variant="secondary"
            className="bg-emerald-50 text-emerald-700 border-emerald-200"
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Done
          </Badge>
        );
      case "failed":
        return (
          <Badge
            variant="secondary"
            className="bg-red-50 text-red-700 border-red-200"
          >
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto px-8 py-12">
      {/* Hero Section */}
      <div className="mb-16">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold text-slate-900 mb-4 tracking-tight">
            Invoice & Receipt Extraction
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed mb-8">
            AI-powered extraction of key business fields from invoices and
            receipts. Upload documents, review extracted data with confidence
            scores, make corrections, and export structured results to JSON or
            CSV.
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
              Upload Document
            </Button>
            <Link to="/documents">
              <Button
                size="lg"
                variant="outline"
                className="h-11 px-6 rounded-xl border-slate-300 hover:bg-slate-50"
              >
                View Documents
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-4 gap-6 mb-12">
        <Card className="p-6 border-slate-200 shadow-sm hover:shadow-md transition-shadow bg-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-slate-600" />
            </div>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {stats.total}
          </div>
          <div className="text-sm text-slate-600">Total Documents</div>
        </Card>

        <Card className="p-6 border-blue-200 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-blue-50 to-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            </div>
          </div>
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {stats.processing}
          </div>
          <div className="text-sm text-slate-600">Processing Now</div>
        </Card>

        <Card className="p-6 border-emerald-200 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-emerald-50 to-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {stats.completed}
          </div>
          <div className="text-sm text-slate-600">Completed</div>
        </Card>

        <Card className="p-6 border-red-200 shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-red-50 to-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-600" />
            </div>
          </div>
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {stats.failed}
          </div>
          <div className="text-sm text-slate-600">Failed</div>
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
            {isDragging ? "Drop your files here" : "Upload Documents"}
          </h3>
          <p className="text-slate-600 mb-6">
            Drag and drop your files or click to browse
          </p>
          <p className="text-sm text-slate-500 mb-6">
            Supports PDF, JPG, and PNG files up to 10MB
          </p>
          <Button
            variant="outline"
            className="border-slate-300 hover:bg-slate-50 rounded-xl"
          >
            Browse Files
          </Button>
        </div>

        {uploadProgress !== null && (
          <div className="mt-8 max-w-md mx-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">
                Uploading...
              </span>
              <span className="text-sm text-slate-600">{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}
      </Card>

      {/* Processing Flow */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold text-slate-900 mb-6">
          Processing Workflow
        </h2>
        <div className="grid grid-cols-4 gap-4">
          <Card className="p-6 border-slate-200 shadow-sm bg-white">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-4">
              <Clock className="w-6 h-6 text-slate-600" />
            </div>
            <h4 className="font-semibold text-slate-900 mb-2">Queued</h4>
            <p className="text-sm text-slate-600">
              Document uploaded and waiting for processing
            </p>
          </Card>

          <Card className="p-6 border-blue-200 shadow-sm bg-gradient-to-br from-blue-50 to-white">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
            <h4 className="font-semibold text-slate-900 mb-2">Processing</h4>
            <p className="text-sm text-slate-600">
              AI extracting key fields from document
            </p>
          </Card>

          <Card className="p-6 border-emerald-200 shadow-sm bg-gradient-to-br from-emerald-50 to-white">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            </div>
            <h4 className="font-semibold text-slate-900 mb-2">Done</h4>
            <p className="text-sm text-slate-600">
              Extraction complete, ready for review
            </p>
          </Card>

          <Card className="p-6 border-red-200 shadow-sm bg-gradient-to-br from-red-50 to-white">
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mb-4">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
            <h4 className="font-semibold text-slate-900 mb-2">Failed</h4>
            <p className="text-sm text-slate-600">
              Processing error, manual review needed
            </p>
          </Card>
        </div>
      </div>

      {/* Recent Documents Preview */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-slate-900">
            Recent Documents
          </h2>
          <Link to="/documents">
            <Button
              variant="ghost"
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            >
              View All
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>

        <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
          <div className="divide-y divide-slate-100">
            {mockDocuments.slice(0, 5).map((doc) => (
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
                      {doc.fileName}
                    </div>
                    <div className="text-sm text-slate-500">{doc.uploadDate}</div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  {doc.vendor && (
                    <div className="text-sm text-slate-600 min-w-[180px]">
                      {doc.vendor}
                    </div>
                  )}
                  {doc.totalAmount && (
                    <div className="text-sm font-semibold text-slate-900 min-w-[100px] text-right">
                      {doc.totalAmount}
                    </div>
                  )}
                  {doc.confidence !== undefined && (
                    <div className="min-w-[80px]">
                      <div className="text-xs text-slate-600 mb-1">
                        {doc.confidence}% confidence
                      </div>
                      <Progress
                        value={doc.confidence}
                        className="h-1.5 w-20"
                      />
                    </div>
                  )}
                  <div className="min-w-[120px] flex justify-end">
                    {getStatusBadge(doc.status)}
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
