import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

import pymupdf as fitz
import pytesseract
from PIL import Image
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pytesseract import Output


app = FastAPI(title="DocuMind ML Service", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}

TOTAL_KEYWORDS = [
    "do zapłaty",
    "do zaplaty",
    "należność ogółem",
    "naleznosc ogolem",
    "razem",
    "suma",
    "wartość brutto",
    "wartosc brutto",
    "brutto",
    "total",
]

TAX_KEYWORDS = [
    "vat",
    "podatek",
    "kwota vat",
]

VENDOR_SKIP_WORDS = [
    "faktura",
    "invoice",
    "paragon",
    "rachunek",
    "nip",
    "regon",
    "sprzedawca",
    "nabywca",
    "data",
    "razem",
    "brutto",
    "netto",
    "vat",
    "telefon",
    "tel.",
    "ul.",
    "www",
    "http",
    "@",
]

DATE_LABELS = [
    "data wystawienia",
    "data sprzedaży",
    "data sprzedazy",
    "date",
    "invoice date",
]

CURRENCY_MAP = {
    "pln": "PLN",
    "zł": "PLN",
    "zl": "PLN",
    "eur": "EUR",
    "€": "EUR",
    "usd": "USD",
    "$": "USD",
}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/infer")
async def infer(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {file.content_type}"
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        images = load_images_from_upload(content, file.content_type)
        lines = []
        for image in images:
            lines.extend(extract_lines_with_confidence(image))

        if not lines:
            raise HTTPException(status_code=422, detail="OCR did not extract any text")

        text = "\n".join(line["text"] for line in lines)

        vendor_name, vendor_conf = extract_vendor_name(lines)
        invoice_date, date_conf = extract_invoice_date(lines, text)
        total_amount, total_conf = extract_total_amount(lines, text)
        currency, currency_conf = extract_currency(text)
        tax_amount, tax_conf = extract_tax_amount(lines, text)

        result = {
            "fields": {
                "vendor_name": {
                    "value": vendor_name,
                    "confidence": round(vendor_conf, 2)
                },
                "invoice_date": {
                    "value": invoice_date,
                    "confidence": round(date_conf, 2)
                },
                "total_amount": {
                    "value": total_amount,
                    "confidence": round(total_conf, 2)
                },
                "currency": {
                    "value": currency,
                    "confidence": round(currency_conf, 2)
                },
                "tax_amount": {
                    "value": tax_amount,
                    "confidence": round(tax_conf, 2)
                }
            },
            "model_version": "ocr-tesseract-v1"
        }

        return result

    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"Inference failed: {str(ex)}")


def load_images_from_upload(content: bytes, content_type: str) -> list[Image.Image]:
    if content_type == "application/pdf":
        return render_pdf_to_images(content)

    image = Image.open(io.BytesIO(content)).convert("RGB")
    return [image]


def render_pdf_to_images(pdf_bytes: bytes, max_pages: int = 3) -> list[Image.Image]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []

    for page_index in range(min(len(doc), max_pages)):
        page = doc.load_page(page_index)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        images.append(image)

    return images


def extract_lines_with_confidence(image: Image.Image) -> list[dict]:
    data = pytesseract.image_to_data(
        image,
        lang="pol+eng",
        config="--oem 3 --psm 6",
        output_type=Output.DICT
    )

    grouped = {}

    for i, raw_text in enumerate(data["text"]):
        text = normalize_spaces(raw_text)
        conf = safe_float(data["conf"][i], default=-1)

        if not text:
            continue

        key = (
            data["block_num"][i],
            data["par_num"][i],
            data["line_num"][i],
        )

        if key not in grouped:
            grouped[key] = {
                "texts": [],
                "confs": [],
                "top": data["top"][i],
                "left": data["left"][i],
            }

        grouped[key]["texts"].append(text)
        if conf >= 0:
            grouped[key]["confs"].append(conf)

        grouped[key]["top"] = min(grouped[key]["top"], data["top"][i])
        grouped[key]["left"] = min(grouped[key]["left"], data["left"][i])

    lines = []
    for value in grouped.values():
        joined = normalize_spaces(" ".join(value["texts"]))
        if not joined:
            continue

        avg_conf = 0.55
        if value["confs"]:
            avg_conf = max(0.0, min(1.0, sum(value["confs"]) / len(value["confs"]) / 100.0))

        lines.append({
            "text": joined,
            "conf": avg_conf,
            "top": value["top"],
            "left": value["left"],
        })

    lines.sort(key=lambda x: (x["top"], x["left"]))
    return lines


def extract_vendor_name(lines: list[dict]) -> tuple[str, float]:
    for line in lines[:12]:
        text = line["text"].strip()
        lower = text.lower()

        if len(text) < 4:
            continue

        if any(word in lower for word in VENDOR_SKIP_WORDS):
            continue

        digits_count = sum(ch.isdigit() for ch in text)
        if digits_count > 2:
            continue

        return text, max(0.45, line["conf"])

    return "", 0.1


def extract_invoice_date(lines: list[dict], full_text: str) -> tuple[str, float]:
    for line in lines:
        lower = line["text"].lower()
        if any(label in lower for label in DATE_LABELS):
            found = find_date_in_text(line["text"])
            if found:
                return found, max(0.55, line["conf"])

    any_date = find_date_in_text(full_text)
    if any_date:
        return any_date, 0.55

    return "", 0.1


def extract_currency(full_text: str) -> tuple[str, float]:
    lower = full_text.lower()

    for token, normalized in CURRENCY_MAP.items():
        if token in lower:
            return normalized, 0.85

    return "PLN", 0.4


def extract_total_amount(lines: list[dict], full_text: str) -> tuple[Optional[float], float]:
    for keyword in TOTAL_KEYWORDS:
        for line in lines:
            lower = line["text"].lower()
            if keyword in lower:
                amount = extract_amount_from_text(line["text"])
                if amount is not None:
                    return amount, max(0.55, line["conf"])

    all_amounts = extract_all_amounts(full_text)
    if all_amounts:
        return max(all_amounts), 0.45

    return None, 0.1


def extract_tax_amount(lines: list[dict], full_text: str) -> tuple[Optional[float], float]:
    for keyword in TAX_KEYWORDS:
        for line in lines:
            lower = line["text"].lower()
            if keyword in lower:
                amount = extract_amount_from_text(line["text"])
                if amount is not None:
                    return amount, max(0.5, line["conf"])

    vat_lines = [line for line in lines if "vat" in line["text"].lower()]
    for line in vat_lines:
        amount = extract_amount_from_text(line["text"])
        if amount is not None:
            return amount, max(0.45, line["conf"])

    return None, 0.1


def find_date_in_text(text: str) -> Optional[str]:
    patterns = [
        r"\b(\d{4}-\d{2}-\d{2})\b",
        r"\b(\d{2}[./-]\d{2}[./-]\d{4})\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            normalized = normalize_date(match.group(1))
            if normalized:
                return normalized

    return None


def normalize_date(raw: str) -> Optional[str]:
    raw = raw.strip()

    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            return datetime.strptime(raw, "%Y-%m-%d").strftime("%Y-%m-%d")

        candidate = raw.replace(".", "-").replace("/", "-")
        return datetime.strptime(candidate, "%d-%m-%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def extract_all_amounts(text: str) -> list[float]:
    matches = re.findall(r"(?<!\d)(\d{1,3}(?:[ .]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})(?!\d)", text)
    amounts = []

    for match in matches:
        value = normalize_amount(match)
        if value is not None:
            amounts.append(value)

    return amounts


def extract_amount_from_text(text: str) -> Optional[float]:
    amounts = extract_all_amounts(text)
    if not amounts:
        return None
    return amounts[-1]


def normalize_amount(raw: str) -> Optional[float]:
    raw = raw.replace("\u00A0", " ").strip()
    raw = raw.replace(" ", "")

    if "," in raw and "." in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "")
            raw = raw.replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif "," in raw:
        raw = raw.replace(",", ".")

    try:
        value = Decimal(raw)
        return float(value.quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return None


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default