import { useState } from "react";
import { useParams, Link } from "react-router";
import {
  ArrowLeft,
  FileText,
  Edit3,
  Check,
  X,
  Download,
  AlertCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import { mockDocuments } from "../data/mockData";

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const document = mockDocuments.find((d) => d.id === id);

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  if (!document) {
    return (
      <div className="max-w-[1600px] mx-auto px-8 py-12">
        <div className="text-center py-16">
          <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-slate-900 mb-2">
            Document not found
          </h2>
          <p className="text-slate-600 mb-6">
            The document you're looking for doesn't exist.
          </p>
          <Link to="/documents">
            <Button className="bg-blue-600 hover:bg-blue-700 rounded-xl">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Documents
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleEdit = (fieldName: string, currentValue: string) => {
    setEditingField(fieldName);
    setEditValues({ ...editValues, [fieldName]: currentValue });
  };

  const handleSave = (fieldName: string) => {
    // In a real app, this would save to the backend
    setEditingField(null);
  };

  const handleCancel = () => {
    setEditingField(null);
    setEditValues({});
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 95) return "text-emerald-700";
    if (confidence >= 85) return "text-blue-700";
    if (confidence >= 75) return "text-amber-700";
    return "text-red-700";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 95) return "Excellent";
    if (confidence >= 85) return "Good";
    if (confidence >= 75) return "Fair";
    return "Low";
  };

  return (
    <div className="max-w-[1600px] mx-auto px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/documents"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Documents
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 mb-2 tracking-tight">
              {document.fileName}
            </h1>
            <div className="flex items-center gap-4 text-sm text-slate-600">
              <span>Uploaded on {document.uploadDate}</span>
              <span>•</span>
              <Badge
                variant="secondary"
                className="bg-slate-100 text-slate-700 border-slate-200"
              >
                {document.fileType}
              </Badge>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-slate-300 hover:bg-slate-50 rounded-xl"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        {/* Document Preview */}
        <Card className="p-8 border-slate-200 shadow-sm bg-white h-fit">
          <h2 className="text-xl font-semibold text-slate-900 mb-6">
            Document Preview
          </h2>
          <div className="aspect-[8.5/11] bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border-2 border-slate-200 flex items-center justify-center">
            <div className="text-center">
              <FileText className="w-16 h-16 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-600 font-medium">
                {document.fileName}
              </p>
              <p className="text-sm text-slate-500 mt-2">
                Document preview unavailable
              </p>
            </div>
          </div>
        </Card>

        {/* Extracted Fields */}
        <div className="space-y-6">
          <Card className="p-8 border-slate-200 shadow-sm bg-white">
            <h2 className="text-xl font-semibold text-slate-900 mb-6">
              Extracted Fields
            </h2>

            {!document.extractedFields ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600">
                  {document.status === "processing"
                    ? "Extraction in progress..."
                    : document.status === "queued"
                    ? "Document queued for processing"
                    : "No extracted data available"}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Vendor Name */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Vendor Name
                    </label>
                    {document.extractedFields.vendor_name.corrected && (
                      <Badge
                        variant="secondary"
                        className="bg-violet-50 text-violet-700 border-violet-200"
                      >
                        Corrected
                      </Badge>
                    )}
                  </div>
                  {editingField === "vendor_name" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editValues.vendor_name}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            vendor_name: e.target.value,
                          })
                        }
                        className="flex-1 bg-white border-slate-300 rounded-lg"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSave("vendor_name")}
                        className="bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancel}
                        className="rounded-lg"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="font-medium text-slate-900">
                          {document.extractedFields.vendor_name.corrected ||
                            document.extractedFields.vendor_name.value}
                        </div>
                        {document.extractedFields.vendor_name.corrected && (
                          <div className="text-sm text-slate-500 line-through mt-1">
                            {document.extractedFields.vendor_name.value}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          handleEdit(
                            "vendor_name",
                            document.extractedFields!.vendor_name.corrected ||
                              document.extractedFields!.vendor_name.value
                          )
                        }
                        className="hover:bg-slate-100 rounded-lg"
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Progress
                      value={document.extractedFields.vendor_name.confidence}
                      className="h-1.5 flex-1"
                    />
                    <span
                      className={`text-xs font-medium ${getConfidenceColor(
                        document.extractedFields.vendor_name.confidence
                      )}`}
                    >
                      {document.extractedFields.vendor_name.confidence}%{" "}
                      {getConfidenceLabel(
                        document.extractedFields.vendor_name.confidence
                      )}
                    </span>
                  </div>
                </div>

                {/* Invoice Date */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Invoice Date
                    </label>
                    {document.extractedFields.invoice_date.corrected && (
                      <Badge
                        variant="secondary"
                        className="bg-violet-50 text-violet-700 border-violet-200"
                      >
                        Corrected
                      </Badge>
                    )}
                  </div>
                  {editingField === "invoice_date" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        value={editValues.invoice_date}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            invoice_date: e.target.value,
                          })
                        }
                        className="flex-1 bg-white border-slate-300 rounded-lg"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSave("invoice_date")}
                        className="bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancel}
                        className="rounded-lg"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="font-medium text-slate-900">
                          {document.extractedFields.invoice_date.corrected ||
                            document.extractedFields.invoice_date.value}
                        </div>
                        {document.extractedFields.invoice_date.corrected && (
                          <div className="text-sm text-slate-500 line-through mt-1">
                            {document.extractedFields.invoice_date.value}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          handleEdit(
                            "invoice_date",
                            document.extractedFields!.invoice_date.corrected ||
                              document.extractedFields!.invoice_date.value
                          )
                        }
                        className="hover:bg-slate-100 rounded-lg"
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Progress
                      value={document.extractedFields.invoice_date.confidence}
                      className="h-1.5 flex-1"
                    />
                    <span
                      className={`text-xs font-medium ${getConfidenceColor(
                        document.extractedFields.invoice_date.confidence
                      )}`}
                    >
                      {document.extractedFields.invoice_date.confidence}%{" "}
                      {getConfidenceLabel(
                        document.extractedFields.invoice_date.confidence
                      )}
                    </span>
                  </div>
                </div>

                {/* Total Amount */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Total Amount
                    </label>
                    {document.extractedFields.total_amount.corrected && (
                      <Badge
                        variant="secondary"
                        className="bg-violet-50 text-violet-700 border-violet-200"
                      >
                        Corrected
                      </Badge>
                    )}
                  </div>
                  {editingField === "total_amount" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={editValues.total_amount}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            total_amount: e.target.value,
                          })
                        }
                        className="flex-1 bg-white border-slate-300 rounded-lg"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSave("total_amount")}
                        className="bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancel}
                        className="rounded-lg"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="font-medium text-slate-900">
                          {document.extractedFields.total_amount.corrected ||
                            document.extractedFields.total_amount.value}
                        </div>
                        {document.extractedFields.total_amount.corrected && (
                          <div className="text-sm text-slate-500 line-through mt-1">
                            {document.extractedFields.total_amount.value}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          handleEdit(
                            "total_amount",
                            document.extractedFields!.total_amount.corrected ||
                              document.extractedFields!.total_amount.value
                          )
                        }
                        className="hover:bg-slate-100 rounded-lg"
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Progress
                      value={document.extractedFields.total_amount.confidence}
                      className="h-1.5 flex-1"
                    />
                    <span
                      className={`text-xs font-medium ${getConfidenceColor(
                        document.extractedFields.total_amount.confidence
                      )}`}
                    >
                      {document.extractedFields.total_amount.confidence}%{" "}
                      {getConfidenceLabel(
                        document.extractedFields.total_amount.confidence
                      )}
                    </span>
                  </div>
                </div>

                {/* Currency */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Currency
                    </label>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="font-medium text-slate-900">
                        {document.extractedFields.currency.value}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Progress
                      value={document.extractedFields.currency.confidence}
                      className="h-1.5 flex-1"
                    />
                    <span
                      className={`text-xs font-medium ${getConfidenceColor(
                        document.extractedFields.currency.confidence
                      )}`}
                    >
                      {document.extractedFields.currency.confidence}%{" "}
                      {getConfidenceLabel(
                        document.extractedFields.currency.confidence
                      )}
                    </span>
                  </div>
                </div>

                {/* Tax Amount */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-semibold text-slate-700">
                      Tax Amount
                    </label>
                  </div>
                  {editingField === "tax_amount" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={editValues.tax_amount}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            tax_amount: e.target.value,
                          })
                        }
                        className="flex-1 bg-white border-slate-300 rounded-lg"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSave("tax_amount")}
                        className="bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancel}
                        className="rounded-lg"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="font-medium text-slate-900">
                          {document.extractedFields.tax_amount.value}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          handleEdit(
                            "tax_amount",
                            document.extractedFields!.tax_amount.value
                          )
                        }
                        className="hover:bg-slate-100 rounded-lg"
                      >
                        <Edit3 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Progress
                      value={document.extractedFields.tax_amount.confidence}
                      className="h-1.5 flex-1"
                    />
                    <span
                      className={`text-xs font-medium ${getConfidenceColor(
                        document.extractedFields.tax_amount.confidence
                      )}`}
                    >
                      {document.extractedFields.tax_amount.confidence}%{" "}
                      {getConfidenceLabel(
                        document.extractedFields.tax_amount.confidence
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Info Card */}
          <Card className="p-6 border-blue-200 bg-gradient-to-br from-blue-50 to-white shadow-sm">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-slate-900 mb-1">
                  About Corrections
                </h4>
                <p className="text-sm text-slate-700 leading-relaxed">
                  When you correct a field, the corrected value will be used in
                  exports. Original AI-extracted values are preserved for
                  reference and quality tracking.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
