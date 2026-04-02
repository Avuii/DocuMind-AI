import { useState } from "react";
import { Download, FileJson, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { mockDocuments } from "../data/mockData";

export function Exports() {
  const [exportedFormat, setExportedFormat] = useState<string | null>(null);

  const completedDocuments = mockDocuments.filter((d) => d.status === "done");
  const documentsWithCorrections = completedDocuments.filter(
    (d) =>
      d.extractedFields &&
      Object.values(d.extractedFields).some((field) => field.corrected)
  );

  const handleExport = (format: "json" | "csv") => {
    // In a real app, this would trigger an actual export
    setExportedFormat(format);
    setTimeout(() => setExportedFormat(null), 3000);
  };

  return (
    <div className="max-w-[1600px] mx-auto px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-semibold text-slate-900 mb-2 tracking-tight">
          Exports
        </h1>
        <p className="text-lg text-slate-600">
          Export extracted document data in structured formats
        </p>
      </div>

      {/* Export Status */}
      <div className="grid grid-cols-3 gap-6 mb-12">
        <Card className="p-6 border-slate-200 shadow-sm bg-white">
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {completedDocuments.length}
          </div>
          <div className="text-sm text-slate-600">Ready to Export</div>
        </Card>

        <Card className="p-6 border-violet-200 shadow-sm bg-gradient-to-br from-violet-50 to-white">
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {documentsWithCorrections.length}
          </div>
          <div className="text-sm text-slate-600">With Corrections</div>
        </Card>

        <Card className="p-6 border-emerald-200 shadow-sm bg-gradient-to-br from-emerald-50 to-white">
          <div className="text-3xl font-semibold text-slate-900 mb-1">
            {completedDocuments.length - documentsWithCorrections.length}
          </div>
          <div className="text-sm text-slate-600">Original Values Only</div>
        </Card>
      </div>

      {/* Export Options */}
      <div className="grid grid-cols-2 gap-8 mb-12">
        {/* JSON Export */}
        <Card className="p-8 border-slate-200 shadow-sm hover:shadow-lg transition-shadow bg-white">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
              <FileJson className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-semibold text-slate-900 mb-2">
                Export as JSON
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Export all extracted data in JSON format, ideal for API
                integration and programmatic processing.
              </p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-200">
            <code className="text-xs text-slate-700 font-mono block">
              {`{
  "documents": [
    {
      "id": "1",
      "vendor_name": "Acme Corporation",
      "invoice_date": "2024-12-15",
      "total_amount": "12450.00",
      "currency": "USD",
      "tax_amount": "1245.00"
    }
  ]
}`}
            </code>
          </div>

          <Button
            size="lg"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-sm rounded-xl h-12"
            onClick={() => handleExport("json")}
          >
            <Download className="w-4 h-4 mr-2" />
            Download JSON
          </Button>

          {exportedFormat === "json" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              JSON export downloaded successfully
            </div>
          )}
        </Card>

        {/* CSV Export */}
        <Card className="p-8 border-slate-200 shadow-sm hover:shadow-lg transition-shadow bg-white">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-semibold text-slate-900 mb-2">
                Export as CSV
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Export all extracted data in CSV format, perfect for spreadsheet
                analysis and reporting.
              </p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-200">
            <code className="text-xs text-slate-700 font-mono block">
              {`id,vendor_name,invoice_date,total_amount,currency,tax_amount
1,Acme Corporation,2024-12-15,12450.00,USD,1245.00
2,TechStore Inc.,2024-03-16,3299.99,USD,264.00`}
            </code>
          </div>

          <Button
            size="lg"
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm rounded-xl h-12"
            onClick={() => handleExport("csv")}
          >
            <Download className="w-4 h-4 mr-2" />
            Download CSV
          </Button>

          {exportedFormat === "csv" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              CSV export downloaded successfully
            </div>
          )}
        </Card>
      </div>

      {/* Info Cards */}
      <div className="space-y-6">
        <Card className="p-6 border-blue-200 bg-gradient-to-br from-blue-50 to-white shadow-sm">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-slate-900 mb-1">
                Corrected Values Priority
              </h4>
              <p className="text-sm text-slate-700 leading-relaxed">
                When you export data, corrected values are used whenever
                available. If a field hasn't been corrected, the original
                AI-extracted value is used instead.
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6 border-violet-200 bg-gradient-to-br from-violet-50 to-white shadow-sm">
          <div className="flex gap-3">
            <CheckCircle2 className="w-5 h-5 text-violet-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-slate-900 mb-1">
                Export Contents
              </h4>
              <p className="text-sm text-slate-700 leading-relaxed mb-3">
                Both JSON and CSV exports include all completed documents with
                the following fields:
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="secondary"
                  className="bg-white border-violet-200 text-slate-700"
                >
                  Vendor Name
                </Badge>
                <Badge
                  variant="secondary"
                  className="bg-white border-violet-200 text-slate-700"
                >
                  Invoice Date
                </Badge>
                <Badge
                  variant="secondary"
                  className="bg-white border-violet-200 text-slate-700"
                >
                  Total Amount
                </Badge>
                <Badge
                  variant="secondary"
                  className="bg-white border-violet-200 text-slate-700"
                >
                  Currency
                </Badge>
                <Badge
                  variant="secondary"
                  className="bg-white border-violet-200 text-slate-700"
                >
                  Tax Amount
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
