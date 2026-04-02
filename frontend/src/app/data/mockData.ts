export type DocumentStatus = "queued" | "processing" | "done" | "failed";

export interface ExtractedField {
  value: string;
  confidence: number;
  corrected?: string;
}

export interface Document {
  id: string;
  fileName: string;
  fileType: string;
  uploadDate: string;
  status: DocumentStatus;
  vendor?: string;
  totalAmount?: string;
  confidence?: number;
  extractedFields?: {
    vendor_name: ExtractedField;
    invoice_date: ExtractedField;
    total_amount: ExtractedField;
    currency: ExtractedField;
    tax_amount: ExtractedField;
  };
}

export const mockDocuments: Document[] = [
  {
    id: "1",
    fileName: "invoice_acme_corp_2024.pdf",
    fileType: "PDF",
    uploadDate: "2026-03-31",
    status: "done",
    vendor: "Acme Corporation",
    totalAmount: "$12,450.00",
    confidence: 98,
    extractedFields: {
      vendor_name: {
        value: "Acme Corporation",
        confidence: 98,
      },
      invoice_date: {
        value: "2024-12-15",
        confidence: 99,
      },
      total_amount: {
        value: "12450.00",
        confidence: 97,
      },
      currency: {
        value: "USD",
        confidence: 100,
      },
      tax_amount: {
        value: "1245.00",
        confidence: 95,
      },
    },
  },
  {
    id: "2",
    fileName: "receipt_techstore_march.jpg",
    fileType: "JPG",
    uploadDate: "2026-03-30",
    status: "done",
    vendor: "TechStore Inc.",
    totalAmount: "$3,299.99",
    confidence: 94,
    extractedFields: {
      vendor_name: {
        value: "TechStore Inc.",
        confidence: 96,
      },
      invoice_date: {
        value: "2024-03-15",
        confidence: 92,
        corrected: "2024-03-16",
      },
      total_amount: {
        value: "3299.99",
        confidence: 98,
      },
      currency: {
        value: "USD",
        confidence: 100,
      },
      tax_amount: {
        value: "264.00",
        confidence: 89,
      },
    },
  },
  {
    id: "3",
    fileName: "invoice_global_services.pdf",
    fileType: "PDF",
    uploadDate: "2026-03-29",
    status: "processing",
    vendor: "Global Services Ltd.",
    totalAmount: "$8,750.50",
    confidence: undefined,
  },
  {
    id: "4",
    fileName: "receipt_office_supplies.png",
    fileType: "PNG",
    uploadDate: "2026-03-28",
    status: "done",
    vendor: "Office Depot",
    totalAmount: "$542.30",
    confidence: 91,
    extractedFields: {
      vendor_name: {
        value: "Office Depot",
        confidence: 94,
      },
      invoice_date: {
        value: "2024-03-20",
        confidence: 88,
      },
      total_amount: {
        value: "542.30",
        confidence: 96,
        corrected: "545.30",
      },
      currency: {
        value: "USD",
        confidence: 100,
      },
      tax_amount: {
        value: "42.30",
        confidence: 87,
      },
    },
  },
  {
    id: "5",
    fileName: "invoice_cloud_platform.pdf",
    fileType: "PDF",
    uploadDate: "2026-03-27",
    status: "failed",
    vendor: undefined,
    totalAmount: undefined,
    confidence: undefined,
  },
  {
    id: "6",
    fileName: "receipt_restaurant_march.jpg",
    fileType: "JPG",
    uploadDate: "2026-03-26",
    status: "queued",
    vendor: undefined,
    totalAmount: undefined,
    confidence: undefined,
  },
  {
    id: "7",
    fileName: "invoice_consulting_services.pdf",
    fileType: "PDF",
    uploadDate: "2026-03-25",
    status: "done",
    vendor: "Strategic Consulting Group",
    totalAmount: "$25,000.00",
    confidence: 96,
    extractedFields: {
      vendor_name: {
        value: "Strategic Consulting Group",
        confidence: 97,
      },
      invoice_date: {
        value: "2024-03-01",
        confidence: 99,
      },
      total_amount: {
        value: "25000.00",
        confidence: 98,
      },
      currency: {
        value: "USD",
        confidence: 100,
      },
      tax_amount: {
        value: "2000.00",
        confidence: 94,
      },
    },
  },
  {
    id: "8",
    fileName: "receipt_hotel_conference.pdf",
    fileType: "PDF",
    uploadDate: "2026-03-24",
    status: "done",
    vendor: "Grand Plaza Hotel",
    totalAmount: "$1,850.00",
    confidence: 93,
    extractedFields: {
      vendor_name: {
        value: "Grand Plaza Hotel",
        confidence: 95,
      },
      invoice_date: {
        value: "2024-03-18",
        confidence: 97,
      },
      total_amount: {
        value: "1850.00",
        confidence: 91,
      },
      currency: {
        value: "USD",
        confidence: 100,
      },
      tax_amount: {
        value: "185.00",
        confidence: 89,
      },
    },
  },
];
