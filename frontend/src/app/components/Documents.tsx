import { useState } from "react";
import { Link } from "react-router";
import {
  FileText,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  Download,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { mockDocuments, DocumentStatus } from "../data/mockData";

export function Documents() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredDocuments = mockDocuments.filter((doc) => {
    const matchesSearch = doc.fileName
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || doc.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

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
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-semibold text-slate-900 mb-2 tracking-tight">
          Documents
        </h1>
        <p className="text-lg text-slate-600">
          View and manage all uploaded documents
        </p>
      </div>

      {/* Filters and Search */}
      <div className="flex items-center gap-4 mb-8">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white border-slate-300 rounded-xl h-11"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-white border-slate-300 rounded-xl h-11">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          className="border-slate-300 hover:bg-slate-50 rounded-xl h-11"
        >
          <Download className="w-4 h-4 mr-2" />
          Export All
        </Button>
      </div>

      {/* Documents Table */}
      <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">
                  File Name
                </th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">
                  Type
                </th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">
                  Upload Date
                </th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">
                  Vendor
                </th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">
                  Total Amount
                </th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">
                  Confidence
                </th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">
                  Status
                </th>
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDocuments.map((doc) => (
                <tr
                  key={doc.id}
                  className="hover:bg-slate-50 transition-colors group"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-slate-600" />
                      </div>
                      <div className="font-medium text-slate-900 truncate max-w-[280px]">
                        {doc.fileName}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <Badge
                      variant="secondary"
                      className="bg-slate-100 text-slate-700 border-slate-200"
                    >
                      {doc.fileType}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {doc.uploadDate}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-900">
                    {doc.vendor || (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                    {doc.totalAmount || (
                      <span className="text-slate-400 font-normal">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {doc.confidence !== undefined ? (
                      <div className="flex items-center gap-2">
                        <Progress
                          value={doc.confidence}
                          className="h-1.5 w-16"
                        />
                        <span className="text-xs text-slate-600 w-8">
                          {doc.confidence}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">{getStatusBadge(doc.status)}</td>
                  <td className="px-6 py-4">
                    <Link to={`/documents/${doc.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        View
                        <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredDocuments.length === 0 && (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              No documents found
            </h3>
            <p className="text-slate-600">
              {searchQuery || statusFilter !== "all"
                ? "Try adjusting your filters"
                : "Upload your first document to get started"}
            </p>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {filteredDocuments.length > 0 && (
        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-slate-600">
            Showing {filteredDocuments.length} of {mockDocuments.length}{" "}
            documents
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-slate-300 hover:bg-slate-50 rounded-lg"
              disabled
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-slate-300 hover:bg-slate-50 rounded-lg bg-blue-50 text-blue-600 border-blue-200"
            >
              1
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-slate-300 hover:bg-slate-50 rounded-lg"
              disabled
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
