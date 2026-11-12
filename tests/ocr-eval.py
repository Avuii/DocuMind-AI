"""Measure extraction against synthetic ground truth through the real /infer API."""

import argparse
from collections import defaultdict
from decimal import Decimal, InvalidOperation
import json
import mimetypes
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "frontend/src/app/demo/fixtures"
TOTALS = {"net_amount", "tax_amount", "total_amount"}
CORE = ("document_type", "currency", "total_amount")


def expected(label):
    kind = label["document_type"]
    result = {
        "document_type": kind,
        "document_language": label["language"],
        "currency": label["currency"],
        "invoice_date": label["issue_date"],
        "invoice_number" if kind == "invoice" else "receipt_number": label["number"],
        "vendor_name": label["seller"]["name"],
        "seller_nip": label["seller"]["nip"],
        "buyer_nip": label["buyer"].get("nip"),
        "tax_amount": label["totals"]["vat"],
        "total_amount": label["totals"]["gross"],
    }
    if kind == "invoice":
        result["net_amount"] = label["totals"]["net"]
    if "line_items" in label:
        result["line_item_count"] = len(label["line_items"])
    return {key: value for key, value in result.items() if value is not None}


def pdf(objects):
    content = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(content))
        content.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(content)
    content.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        content.extend(f"{offset:010d} 00000 n \n".encode())
    content.extend(f"trailer\n<< /Root 1 0 R /Size {len(offsets)} >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(content)


def stream(content, properties=b""):
    return b"<< /Length " + str(len(content)).encode() + b" " + properties + b">>\nstream\n" + content + b"\nendstream"


def text_pdf():
    def lines(*rows):
        return stream(b"BT /F1 14 Tf 18 TL 45 760 Td " + b" T* ".join(
            b"(" + row.encode() + b") Tj" for row in rows) + b" ET")

    return pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
        lines("Example Office Ltd", "Invoice No. FV/2026/TEST", "Issue date: 15-Mar-2026", "Subtotal: 100.00 EUR"),
        lines("VAT: 23.00 EUR", "TOTAL: 123.00 EUR"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ])


def scanned_pdf(jpeg):
    return pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 424] /Contents 4 0 R /Resources << /XObject << /Im 5 0 R >> >> >>",
        stream(b"q 240 0 0 424 0 0 cm /Im Do Q"),
        stream(jpeg, b"/Type /XObject /Subtype /Image /Width 600 /Height 1060 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "),
    ])


def infer(base_url, name, content, content_type):
    boundary = uuid4().hex
    prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
              f"Content-Type: {content_type}\r\n\r\n").encode()
    request = Request(base_url.rstrip("/") + "/infer",
                      data=prefix + content + f"\r\n--{boundary}--\r\n".encode(),
                      headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urlopen(request, timeout=150) as response:
        return json.load(response)


def match(key, actual, truth):
    if actual is None or isinstance(actual, bool):
        return False
    if key in TOTALS:
        try:
            return abs(Decimal(str(actual)) - Decimal(str(truth))) <= Decimal("0.01")
        except InvalidOperation:
            return False
    if key.endswith("_nip"):
        return re.sub(r"\D", "", str(actual)) == str(truth)
    return " ".join(str(actual).casefold().split()) == " ".join(str(truth).casefold().split())


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def benchmark_cases(dataset):
    layout_by_name = {"invoice-pl": "sidebar", "invoice-en": "framed", "receipt-pl": "thermal_stacked"}
    for stem, layout in layout_by_name.items():
        label = expected(read_json(FIXTURES / (stem + ".json")))
        jpeg = (FIXTURES / (stem + ".jpg")).read_bytes()
        yield stem + ".jpg", jpeg, "image/jpeg", layout, label, CORE, None
        if stem == "receipt-pl":
            yield "receipt-scan.pdf", scanned_pdf(jpeg), "application/pdf", "scanned_pdf", label, CORE, None
    native = {"document_type": "invoice", "document_language": "en", "currency": "EUR",
              "invoice_number": "FV/2026/TEST", "invoice_date": "2026-03-15", "tax_amount": 23, "total_amount": 123}
    yield "multi-page.pdf", text_pdf(), "application/pdf", "native_pdf", native, (
        *CORE, "invoice_number", "invoice_date", "tax_amount"), {1, 2}

    if dataset:
        for index, row in enumerate(read_json(dataset / "manifest.json"), start=1):
            path = dataset / row["image"]
            label = expected(read_json(dataset / row["ground_truth"]))
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            yield f"dataset-{index}{path.suffix}", path.read_bytes(), mime, row["layout"], label, (), None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8001")
    parser.add_argument("--dataset", type=Path, help="Optional generated dataset root containing manifest.json")
    parser.add_argument("--report", type=Path, help="Write a JSON report with aggregate counts and field pass/fail results")
    args = parser.parse_args()
    report = {"fields": defaultdict(lambda: [0, 0]), "layouts": defaultdict(lambda: [0, 0]), "cases": []}
    passed = True
    for name, content, mime, layout, truth, required, pages in benchmark_cases(args.dataset):
        try:
            result = infer(args.url, name, content, mime)
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            print(f"FAIL {name}: {type(error).__name__}", file=sys.stderr)
            report["cases"].append({"document": name, "layout": layout, "error": type(error).__name__})
            passed = False
            continue
        observed = result.get("fields", {})
        hits = {key: match(key, observed.get(key, {}).get("value"), value)
                for key, value in truth.items() if key != "line_item_count"}
        if "line_item_count" in truth:
            hits["line_item_count"] = len(result.get("line_items", [])) == truth["line_item_count"]
        page_set = {line.get("page") for line in result.get("debug", {}).get("raw_lines", [])}
        missing = [key for key in required if not hits[key]]
        if pages and not pages <= page_set:
            missing.append("page_positions")
        for field, hit in hits.items():
            report["fields"][field][0] += int(hit)
            report["fields"][field][1] += 1
        report["layouts"][layout][0] += sum(hits.values())
        report["layouts"][layout][1] += len(hits)
        report["cases"].append({"document": name, "layout": layout, "fields": hits, "required_failures": missing})
        print(f"{'FAIL' if missing else 'OK'} {name} [{layout}] {sum(hits.values())}/{len(hits)}"
              + (f" failed regression assertions: {', '.join(missing)}" if missing else ""))
        passed &= not missing
    for field, (correct, count) in sorted(report["fields"].items()):
        print(f"{field:24} {correct:3}/{count:<3} {correct/count:6.1%}")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
