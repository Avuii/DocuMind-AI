import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

import numpy as np
import pymupdf as fitz
from PIL import Image, ImageFilter, ImageOps
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR



app = FastAPI(title="DocuMind ML Service", version="0.5.0")

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
    "do zapłaty", "do zaplaty", "należność ogółem", "naleznosc ogolem",
    "razem", "suma", "wartość brutto", "wartosc brutto", "brutto",
    "total", "grand total", "amount due", "balance due", "total due",
    "kwota do zapłaty", "kwota do zaplaty", "sum total", "invoice total",
]

TAX_KEYWORDS = [
    "vat", "podatek", "kwota vat", "tax", "sales tax", "tax amount",
]

DATE_LABELS = [
    "data wystawienia", "data sprzedaży", "data sprzedazy",
    "date", "invoice date", "issue date", "sale date",
    "document date", "transaction date",
]

CURRENCY_MAP = {
    "pln": "PLN",
    "zł": "PLN",
    "zl": "PLN",
    "eur": "EUR",
    "€": "EUR",
    "usd": "USD",
    "$": "USD",
    "gbp": "GBP",
    "£": "GBP",
}

VENDOR_SKIP_WORDS = [
    "faktura", "invoice", "receipt", "paragon", "rachunek",
    "bill to", "ship to", "sold to", "buyer", "customer", "client",
    "nabywca", "odbiorca", "terms", "conditions", "payment",
    "bank", "iban", "swift", "bic", "account", "konto",
    "description", "item", "service", "qty", "quantity",
    "unit price", "price", "amount", "subtotal", "discount",
    "total", "balance", "due", "nip", "regon", "pesel",
    "date", "data", "razem", "brutto", "netto", "vat", "tax",
    "telefon", "phone", "tel.", "fax", "mobile",
    "ul.", "street", "avenue", "road", "www", "http", "https", "@",
]

COMPANY_MARKERS = [
    "sp. z o.o", "sp z o.o", "spółka z o.o", "spolka z o.o",
    "s.a.", "sa", "ltd", "llc", "inc", "corp", "corporation",
    "gmbh", "srl", "oy", "ab", "company", "co.", "limited",
    "enterprise", "solutions", "systems", "services", "group",
    "store", "shop", "market", "trading",
]

ocr = PaddleOCR(
    lang="pl",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/infer")
async def infer(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {file.content_type}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        images = load_images_from_upload(content, file.content_type)

        lines = []
        for page_index, image in enumerate(images):
            page_lines = extract_lines_with_paddleocr(image)
            for line in page_lines:
                line["top"] += page_index * 10000
            lines.extend(page_lines)

        if not lines:
            raise HTTPException(status_code=422, detail="OCR did not extract any text")

        lines.sort(key=lambda x: (x["top"], x["left"]))
        full_text = "\n".join(line["text"] for line in lines)

        vendor_name, vendor_conf = extract_vendor_name(lines)
        invoice_date, date_conf = extract_invoice_date(lines, full_text)
        total_amount, total_conf = extract_total_amount(lines, full_text)
        currency, currency_conf = extract_currency(full_text)
        tax_amount, tax_conf = extract_tax_amount(lines, full_text, total_amount)

        return {
            "fields": {
                "vendor_name": {"value": vendor_name, "confidence": round(vendor_conf, 2)},
                "invoice_date": {"value": invoice_date, "confidence": round(date_conf, 2)},
                "total_amount": {"value": total_amount, "confidence": round(total_conf, 2)},
                "currency": {"value": currency, "confidence": round(currency_conf, 2)},
                "tax_amount": {"value": tax_amount, "confidence": round(tax_conf, 2)}
            },
            "model_version": "paddleocr-v1",
            "debug": {
                "raw_lines": lines,
                "full_text": full_text
            }
        }

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
        pix = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
        image = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        images.append(image)

    return images


def preprocess_image(image: Image.Image) -> Image.Image:
    img = image.convert("L")
    width, height = img.size

    if max(width, height) < 1800:
        img = img.resize((width * 2, height * 2), Image.Resampling.LANCZOS)

    img = ImageOps.autocontrast(img)
    img = img.filter(ImageFilter.MedianFilter(size=3))
    img = img.filter(ImageFilter.SHARPEN)
    return img.convert("RGB")


def extract_lines_with_paddleocr(image: Image.Image) -> list[dict]:
    processed = preprocess_image(image)
    arr = np.array(processed)

    result = ocr.predict(arr)

    lines = []
    for page in result:
        res = page.get("res", {})
        rec_texts = res.get("rec_texts", [])
        rec_scores = res.get("rec_scores", [])
        dt_polys = res.get("dt_polys", [])

        for idx, text in enumerate(rec_texts):
            text = normalize_spaces(text)
            if not text:
                continue

            score = 0.45
            if idx < len(rec_scores):
                try:
                    score = float(rec_scores[idx])
                except Exception:
                    score = 0.45

            top = 0
            left = 0
            if idx < len(dt_polys):
                poly = dt_polys[idx]
                xs = [int(p[0]) for p in poly]
                ys = [int(p[1]) for p in poly]
                left = min(xs) if xs else 0
                top = min(ys) if ys else 0

            lines.append({
                "text": text,
                "conf": max(0.0, min(1.0, score)),
                "top": top,
                "left": left,
            })

    return lines


def extract_vendor_name(lines: list[dict]) -> tuple[str, float]:
    candidates = []

    for line in lines[:30]:
        text = normalize_spaces(line["text"])
        lower = text.lower()

        if len(text) < 4 or len(text) > 100:
            continue
        if any(word in lower for word in VENDOR_SKIP_WORDS):
            continue
        if has_url_or_email(text):
            continue
        if find_date_in_text(text):
            continue
        if extract_amount_from_text(text) is not None:
            continue

        letters_count = sum(ch.isalpha() for ch in text)
        digits_count = sum(ch.isdigit() for ch in text)
        word_count = len(text.split())

        if letters_count < 4:
            continue

        score = line["conf"]
        score += 0.20 if digits_count == 0 else -0.10
        score += 0.15 if 2 <= word_count <= 6 else 0
        score += 0.25 if any(marker in lower for marker in COMPANY_MARKERS) else 0
        score += 0.08 if line["left"] < 250 else 0

        candidates.append((score, text, line["conf"]))

    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0]
        return best[1], max(0.45, min(0.95, best[2] + 0.10))

    return "", 0.1


def extract_invoice_date(lines: list[dict], full_text: str) -> tuple[str, float]:
    for i, line in enumerate(lines):
        lower = line["text"].lower()
        if any(label in lower for label in DATE_LABELS):
            candidates = [line["text"]]
            if i + 1 < len(lines):
                candidates.append(line["text"] + " " + lines[i + 1]["text"])

            for candidate_text in candidates:
                dates = find_dates_in_text(candidate_text)
                if dates:
                    return dates[0], max(0.60, line["conf"])

    dates = find_dates_in_text(full_text)
    if dates:
        return dates[0], 0.55

    return "", 0.1


def extract_currency(full_text: str) -> tuple[str, float]:
    lower = full_text.lower()

    for token, normalized in CURRENCY_MAP.items():
        if token in lower:
            return normalized, 0.85

    return "", 0.1


def extract_total_amount(lines: list[dict], full_text: str) -> tuple[Optional[float], float]:
    candidates = []

    for line in lines:
        lower = line["text"].lower()
        amounts = extract_all_amounts(line["text"])
        if not amounts:
            continue

        amount = amounts[-1]
        score = line["conf"]

        if any(keyword in lower for keyword in TOTAL_KEYWORDS):
            score += 0.45

        candidates.append((score, amount, line["conf"]))

    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0]
        return best[1], max(0.45, min(0.92, best[2] + 0.10))

    all_amounts = extract_all_amounts(full_text)
    if all_amounts:
        return max(all_amounts), 0.40

    return None, 0.1


def extract_tax_amount(lines: list[dict], full_text: str, total_amount: Optional[float]) -> tuple[Optional[float], float]:
    candidates = []

    for line in lines:
        lower = line["text"].lower()
        amounts = extract_all_amounts(line["text"])
        if not amounts:
            continue

        for amount in amounts:
            if not any(keyword in lower for keyword in TAX_KEYWORDS):
                continue

            score = line["conf"]
            if total_amount is not None and amount > total_amount:
                score -= 0.40

            candidates.append((score, amount, line["conf"]))

    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0]
        return best[1], max(0.40, min(0.90, best[2] + 0.08))

    return None, 0.1


def find_dates_in_text(text: str) -> list[str]:
    patterns = [
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{4}[./]\d{2}[./]\d{2}\b",
        r"\b\d{2}[./-]\d{2}[./-]\d{4}\b",
        r"\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b",
        r"\b[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b",
    ]

    results = []
    seen = set()

    for pattern in patterns:
        for match in re.finditer(pattern, text):
            normalized = normalize_date(match.group(0))
            if normalized and normalized not in seen:
                seen.add(normalized)
                results.append(normalized)

    return results


def find_date_in_text(text: str) -> Optional[str]:
    dates = find_dates_in_text(text)
    return dates[0] if dates else None


def normalize_date(raw: str) -> Optional[str]:
    raw = normalize_spaces(raw)

    formats = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d.%m.%Y",
        "%d %B %Y",
        "%d %b %Y",
        "%B %d, %Y",
        "%b %d, %Y",
    ]

    for fmt in formats:
        try:
            parsed = datetime.strptime(raw, fmt)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            continue

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


def has_url_or_email(text: str) -> bool:
    lower = text.lower()
    return (
        "@" in lower
        or "www." in lower
        or "http://" in lower
        or "https://" in lower
        or ".com" in lower
        or ".pl" in lower
        or ".eu" in lower
    )


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()