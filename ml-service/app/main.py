import asyncio
import io
import logging
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from time import perf_counter
from threading import Event
from typing import Optional

import numpy as np
import pymupdf as fitz
from PIL import Image, ImageFilter, ImageOps
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR



app = FastAPI(title="DocuMind ML Service", version="0.5.0")
logger = logging.getLogger("uvicorn.error")

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

CURRENCY_MAP = {
    "myr": "MYR",
    "rm": "MYR",
    "ringgit": "MYR",
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
    "solutions", "systems", "services", "group", "sdn bhd", "sdn. bhd.", "perniagaan",
    "store", "shop", "market", "trading",
]

ocr = PaddleOCR(
    lang="pl",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
)
ocr_lock = asyncio.Lock()


class InferenceCancelled(Exception):
    pass


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/infer")
async def infer(request: Request, file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {file.content_type}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    started = perf_counter()
    traceparent = request.headers.get("traceparent", "")
    cancelled = Event()
    try:
        async with ocr_lock:
            if await request.is_disconnected():
                raise InferenceCancelled()
            extraction = asyncio.create_task(asyncio.to_thread(
                read_document, content, file.content_type, cancelled))
            try:
                while not extraction.done():
                    await asyncio.wait({extraction}, timeout=.25)
                    if await request.is_disconnected():
                        cancelled.set()
                lines = extraction.result()
            finally:
                if not extraction.done():
                    cancelled.set()
                    await extraction
        if cancelled.is_set():
            raise InferenceCancelled()
        if not lines:
            raise HTTPException(status_code=422, detail="No text could be extracted")
        return extract_document(lines)
    except InferenceCancelled:
        raise HTTPException(status_code=499, detail="Inference cancelled")
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"Inference failed: {str(ex)}")
    finally:
        logger.info("Inference finished in %.2fs traceparent=%r", perf_counter() - started, traceparent)


def read_document(content: bytes, content_type: str, cancelled: Event | None = None) -> list[dict]:
    if content_type != "application/pdf":
        with Image.open(io.BytesIO(content)) as image:
            return sort_page(extract_lines_with_paddleocr(ImageOps.exif_transpose(image)), 1)

    lines = []
    with fitz.open(stream=content, filetype="pdf") as document:
        if document.page_count > 20:
            raise HTTPException(status_code=422, detail="PDFs are limited to 20 pages")

        for page_index, page in enumerate(document, start=1):
            if cancelled is not None and cancelled.is_set():
                raise InferenceCancelled()
            page_lines = []
            for block in page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)["blocks"]:
                for line in block.get("lines", []):
                    text = normalize_spaces("".join(span["text"] for span in line["spans"]))
                    if text:
                        left, top, right, bottom = line["bbox"]
                        page_lines.append({"text": text, "conf": 1.0, "top": top, "left": left,
                                           "right": right, "bottom": bottom})
            if not page_lines:
                pixmap = page.get_pixmap(dpi=180, alpha=False)
                with Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples) as image:
                    page_lines = extract_lines_with_paddleocr(image)
            lines.extend(sort_page(page_lines, page_index))
    return lines


def sort_page(lines: list[dict], page: int) -> list[dict]:
    return [
        {**line, "page": page}
        for line in sorted(lines, key=lambda line: (line["top"], line["left"]))
    ]


def group_rows(lines: list[dict]) -> list[dict]:
    groups = []
    for number, line in enumerate(lines, start=1):
        height = max(1, line["bottom"] - line["top"])
        center = line["top"] + height / 2
        row = groups[-1] if groups else None
        if (row is None or row["page"] != line["page"] or
                abs(center - row["center"]) > 0.4 * min(height, row["height"])):
            row = {"page": line["page"], "center": center, "height": height, "cells": []}
            groups.append(row)
        row["cells"].append({**line, "line": number})
    for row in groups:
        row["cells"].sort(key=lambda cell: cell["left"])
        row["text"] = " ".join(cell["text"] for cell in row["cells"])
        row["line"] = min(cell["line"] for cell in row["cells"])
    return groups


def extract_document(lines: list[dict]) -> dict:
    rows = group_rows(lines)
    text = "\n".join(row["text"] for row in rows)
    language = detect_language(text)
    invoice_number = extract_invoice_number(rows)
    explicit_receipt = re.search(r"^\s*(?:paragon(?:\s+fiskalny)?|cash bill|receipt)\s*$", text, re.I | re.M)
    document_type = (
        "receipt" if explicit_receipt
        else "invoice" if invoice_number or re.search(
            r"^\s*(?:faktura|(?:(?:simplified\s+tax|commercial|tax|pro\s*forma)\s+)?invoice|rechnung|facture)\b",
            text, re.I | re.M)
        else "receipt" if re.search(r"\b(?:paragon|fiskalny|receipt|kassenbon|ticket de caisse)\b", text, re.I)
        or (re.search(r"^(?:cash|card|change|gotówka|karta|reszta)\b", text, re.I | re.M)
            and re.search(r"^(?:total|razem|suma|do zapłaty)\b", text, re.I | re.M))
        else "unknown"
    )
    fields = {}

    def add(key, value, confidence=0.8, row=None):
        field = {"value": value, "confidence": confidence if value is not None and value != "" else 0}
        if row:
            field["evidence"] = {"text": row["text"], "page": row["page"], "line": row["line"]}
        fields[key] = field

    def labelled(key, pattern, match_to_value=lambda match: match.group(1).strip()):
        for row in rows:
            match = re.search(pattern, row["text"], re.I)
            if match:
                add(key, match_to_value(match), row=row)
                return

    party_names = extract_polish_party_names(lines)
    vendor_name, vendor_conf = party_names.get("seller", (None, 0))
    if not vendor_name:
        vendor_name, vendor_conf = extract_vendor_name(lines)
    add("vendor_name", vendor_name, vendor_conf, next((row for row in rows if vendor_name and vendor_name in row["text"]), None))
    add("document_type", document_type, 0.9 if document_type != "unknown" else 0)
    add("document_language", language, 0.85 if language != "unknown" else 0)
    if document_type != "receipt":
        add("invoice_number", invoice_number, row=next((row for row in rows if invoice_number and invoice_number in row["text"]), None))
    labelled("buyer_name", r"\b(?:bill(?:ed)? to|buyer|customer|nabywca|odbiorca)\s*:\s*(.+?)(?=\s+(?:invoice\s*#|date\s*:|nip\s*:)|$)")
    if "buyer" in party_names:
        buyer_name, buyer_conf = party_names["buyer"]
        add("buyer_name", buyer_name, buyer_conf, next((row for row in rows if buyer_name in row["text"]), None))
    buyer_address = extract_buyer_address(lines)
    if buyer_address:
        add("buyer_address", buyer_address["text"], 0.75, buyer_address)
    labelled("seller_address", r"\b(?:seller address|vendor address|adres sprzedawcy)\s*:\s*(.+)")
    labelled("seller_nip", r"\b(?:seller nip|seller tax id|nip sprzedawcy)\s*:\s*((?:PL)?[\d -]{10,14})")
    labelled("buyer_nip", r"\b(?:buyer nip|buyer tax id|nip nabywcy)\s*:\s*((?:PL)?[\d -]{10,14})")
    labelled("regon", r"\bREGON\s*:?\s*(\d{14}|\d{9})\b")
    labelled("seller_gst_id", r"\bGST\s*(?:ID|Reg(?:istration)?|No\.?)\s*(?:No\.?)?\s*:\s*([0-9]{8,16})\b")
    labelled("purchase_order_number", r"\b(?:P\.?O\.?\s*(?:number|no\.?|#)|nr zam[oó]wienia)\s*[:#]?\s*([\w./-]+)")
    labelled("receipt_number", r"\b(?:(?:rece[iIl]pt|paragon(?: fiskalny)?)\s*(?:number|no\.?|nr|#)|(?:numer|nr)\s+paragonu)\s*[:#]?\s*([\w./-]+)")
    if document_type == "receipt" and invoice_number and "receipt_number" not in fields:
        add("receipt_number", invoice_number, row=next((row for row in rows if invoice_number in row["text"]), None))
    labelled("sale_date", r"(?:data sprzedaży|sale date|transaction date)\s*:?\s*(.+)", lambda match: find_date_in_text(match.group(1)))
    for index, row in enumerate(rows):
        if re.search(r"\b(?:termin płatności|termin zapłaty|due date|payment due date)\b", row["text"], re.I):
            date = find_date_in_text(row["text"])
            source = row
            if not date and index + 1 < len(rows) and rows[index + 1]["page"] == row["page"]:
                following = rows[index + 1]
                date = normalize_date(following["text"])
                if date:
                    source = following
            if date:
                add("due_date", date, row=source)
                break
    labelled("payment_terms", r"(?:notes?\s*:|uwagi\s*:|payment terms\s*:|warunki płatności\s*:)\s*(.+)")
    labelled("payment_method", r"(?:payment method|forma płatności|metoda płatności|sposób zapłaty)\s*:?\s*(.+)")
    if "payment_method" not in fields:
        labelled("payment_method", r"^(?:zapłacono\s+)?(got[óo]wk[ąa]|karta|cash|(?:visa |mastercard )?card)\b")
    labelled("email", r"([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})")
    labelled("website", r"(https?://[^\s]+|www\.[^\s]+)")
    labelled("phone", r"(?:tel(?:ephone)?\.?|phone)\s*:\s*([+()\d][+()\d .-]+)")
    labelled("bank_account", r"(?:IBAN|rachunek bankowy|nr konta|bank account(?: number)?)\s*:?\s*((?:[A-Z]{2}\s*)?\d(?:[\d -]*\d){14,33})")

    date, confidence = extract_invoice_date(lines, text)
    add("invoice_date", date, confidence, next((row for row in rows if date and date in find_dates_in_text(row["text"])), None))
    summary = extract_summary(rows)
    total_source = summary.get("total_amount", (None, None))[1]
    currency, confidence = extract_currency(text, total_source["text"] if total_source else "")
    add("currency", currency, confidence, total_source if total_source and currency_from_text(total_source["text"]) else None)
    for key in ("net_amount", "tax_amount", "total_amount"):
        amount, source = summary.get(key, (None, None))
        add(key, amount, source.get("confidence", 0.9) if source else 0.9, source)
    tax_source = summary.get("tax_amount", (None, None))[1]
    if tax_source:
        tax_text = tax_source["text"]
        rate = re.search(r"(\d+(?:[.,]\d+)?)\s*%", tax_text)
        if rate:
            add("vat_rate", rate.group(1) + "%", row=tax_source)
        if re.search(r"\bGST\b", tax_text, re.I) or any(re.search(r"^GST\s+SUMMARY\b", row["text"], re.I) for row in rows):
            add("tax_type", "GST", row=tax_source)

    nip_pattern = r"\bNIP[ \t:.-]*(?:PL[ \t]*)?((?:\d[ \t-]*){9}\d)(?![ \t-]*\d)"
    nip_rows = {}
    for row in rows:
        for segment in [*(cell["text"] for cell in row["cells"]), row["text"]]:
            for match in re.findall(nip_pattern, segment, re.I):
                nip_rows.setdefault(re.sub(r"\D", "", match), row)
    for key, (nip, row) in extract_party_nips(rows, nip_pattern).items():
        if key not in fields:
            add(key, nip, 0.85, row)
    if document_type == "receipt" and "seller_nip" not in fields:
        for row in rows:
            if re.match(r"^paragon fiskalny\b", row["text"], re.I):
                break
            match = re.match(nip_pattern, row["text"], re.I)
            if match:
                add("seller_nip", re.sub(r"\D", "", match.group(1)), 0.85, row)
                break
    if len(nip_rows) == 1:
        nip, row = next(iter(nip_rows.items()))
        add("nip", nip, row=row)
    elif nip_rows:
        add("tax_ids", ", ".join(sorted(nip_rows)), 0.75)

    return {
        "fields": fields,
        "line_items": extract_line_items(rows, document_type),
        "model_version": "pymupdf-paddleocr-v4",
        "debug": {"raw_lines": lines, "full_text": text},
    }


MONEY_LABEL_END = r"(?=\s*(?:(?:\(\s*(?:RM|MYR|PLN|USD|EUR|GBP)\s*\)|RM|MYR|PLN|USD|EUR|GBP|ZŁ|\$|€|£)\s*)?(?:[:=]|[-−]?\d))"
SUMMARY_LABELS = {
    "total_amount": (
        r"(?:total\s+(?:(?:amt|amount)\s+)?payable|amount due|balance due|(?:razem\s+)?do zap[łl]aty|nale[żz]no[śs][ćc]\s+og[óo][łl]em)",
        r"(?:(?:grand\s+|invoice\s+)?total(?:\s+(?:amount|rounded))?|(?:razem|warto[śs][ćc]|suma)\s+brutto|suma|razem)",
        r"(?:(?:take\s*out\s+)?total(?:\s+(?:amt|amount|sales|RM))?\s+\(?inc(?!ludes\b)[a-z]*\.?(?:\s+of)?\s*GST)(?:\s*@?\s*\d+(?:[.,]\d+)?\s*%)?\)?",
    ),
    "net_amount": (
        r"(?:total(?:\s+sales)?\s+exclud(?:e|ed|ing)\s+GST|(?:suma|razem|warto[śs][ćc])\s+netto|net\s+(?:amount|total)|netto)",
        r"(?:\(?excluded GST\)?\s+)?sub[\s_-]*total",
    ),
    "tax_amount": (
        r"(?:total\s+includes?\s+\d+(?:[.,]\d+)?\s*%\s+GST|(?:total\s+)?GST|tax\s*:\s*VAT|tax amount|vat amount|kwota\s+(?:podatku\s+)?vat|(?:razem|suma)\s+(?:vat|ptu)|podatek(?:\s+vat)?|ptu|vat|tax)(?:\s*[\(@]*\s*\d+(?:[.,]\d+)?\s*%\s*\)?)?",
    ),
}
SUMMARY_PATTERNS = {
    key: tuple(re.compile(r"^" + pattern + MONEY_LABEL_END, re.I) for pattern in patterns)
    for key, patterns in SUMMARY_LABELS.items()
}


def extract_summary(rows: list[dict]) -> dict:
    found = {}
    tax_summary_page = None
    gst_rows = []
    for row in rows:
        text = row["text"]
        if re.match(r"^GST\s+SUMMARY\b", text, re.I):
            tax_summary_page = row["page"]
            continue
        if tax_summary_page == row["page"]:
            tax_text = re.sub(r"\d+(?:[.,]\d+)?\s*%", "", text)
            amounts = extract_all_amounts(tax_text)
            if len(amounts) == 2 and re.match(r"^(?:[A-Z]{1,3}\b|TOTAL\b)", text, re.I):
                gst_rows.append((bool(re.match(r"^TOTAL\b", text, re.I)), amounts, row, False))
            elif len(amounts) == 1 and re.match(r"^(?:SR|ZR|ES|A)\b", text, re.I):
                digits = re.search(r"\s(\d{3})$", tax_text)
                if digits:
                    gst_rows.append((False, [amounts[0], int(digits.group(1)) / 100], row, True))
            continue
        combined = re.match(r"^(?:razem|suma)\s*[:=]?\s+[-−]?\d", text, re.I)
        if combined and "%" not in text:
            amounts = extract_all_amounts(text)
            if len(amounts) == 3 and abs(amounts[0] + amounts[1] - amounts[2]) < 0.005:
                for key, amount in zip(("net_amount", "tax_amount", "total_amount"), amounts):
                    if key not in found or found[key][0] >= 1:
                        found[key] = (1, amount, row)
                continue
        for key, patterns in SUMMARY_PATTERNS.items():
            for priority, pattern in enumerate(patterns):
                match = next((match for segment in summary_segments(row) if (match := pattern.match(segment))), None)
                if not match:
                    continue
                tail = match.string[match.end():]
                amounts = extract_all_amounts(re.sub(r"\d+(?:[.,]\d+)?\s*%", "", tail))
                if amounts and (key not in found or priority <= found[key][0]):
                    found[key] = (priority, amounts[-1], row)
                break
    if gst_rows:
        totals = [entry for entry in gst_rows if entry[0]]
        entry = totals[-1] if totals else gst_rows[0] if len(gst_rows) == 1 else None
        if entry:
            _, (net, tax), row, reconstructed = entry
            gross = found.get("total_amount")
            matches_gross = gross is not None and abs(net + tax - gross[1]) < 0.005
            if not reconstructed or matches_gross:
                if matches_gross and found.get("net_amount", (0, None, None))[0] > 0:
                    found["net_amount"] = (9, net, row)
                else:
                    found.setdefault("net_amount", (9, net, row))
                found.setdefault("tax_amount", (9, tax, {**row, "confidence": 0.7} if reconstructed else row))
    return {key: (value, row) for key, (_, value, row) in found.items()}


def summary_segments(row: dict) -> list[str]:
    cells = [cell["text"] for cell in row["cells"]]
    return [" ".join(cells[index:]) for index in range(len(cells))]


def extract_party_nips(rows: list[dict], nip_pattern: str) -> dict:
    anchors = {}
    found = {}
    for position, row in enumerate(rows):
        if re.match(r"^(?:razem|suma|opis|nazwa towaru|lp\.|do zapłaty)\b", row["text"], re.I):
            anchors.clear()
        for cell, segment in zip(row["cells"], summary_segments(row)):
            heading = re.match(r"^(sprzedawca|wystawca|nabywca|odbiorca|seller|buyer|bill to)\b", cell["text"], re.I)
            if heading:
                side = "seller" if heading.group(1).casefold() in {"sprzedawca", "wystawca", "seller"} else "buyer"
                anchors[side] = (row["page"], cell["left"], position)
            match = None
            if re.search(r"\bNIP\b", cell["text"], re.I):
                match = re.search(nip_pattern, cell["text"], re.I) or re.search(nip_pattern, segment, re.I)
            active = [(abs(left - cell["left"]), anchor_row, side)
                      for side, (page, left, anchor_row) in anchors.items() if page == row["page"]]
            if match and active:
                nearest = min(distance for distance, _, _ in active)
                # Slight OCR drift should not pick an older heading in the same column.
                _, _, side = max((item for item in active if item[0] <= nearest + 12),
                                 key=lambda item: item[1])
                found.setdefault(side + "_nip", (re.sub(r"\D", "", match.group(1)), row))
    return found


def extract_polish_party_names(lines: list[dict]) -> dict:
    names = {}
    for index, line in enumerate(lines):
        match = re.fullmatch(r"(sprzedawca|wystawca|nabywca|odbiorca)\s*:?\s*(.*)", line["text"], re.I)
        if not match:
            continue
        side = "seller" if match.group(1).casefold() in {"sprzedawca", "wystawca"} else "buyer"
        name = match.group(2)
        confidence = line["conf"]
        if not name:
            aligned = [cell for cell in lines[index + 1:index + 10]
                       if cell["page"] == line["page"] and cell["top"] > line["top"]
                       and abs(cell["left"] - line["left"]) <= max(5, line["bottom"] - line["top"])]
            if not aligned or not re.search(r"[^\W\d_]{3}", aligned[0]["text"]) or re.match(
                r"^(?:nip|regon|adres|ul\.|data)\b", aligned[0]["text"], re.I
            ):
                continue
            name = aligned[0]["text"]
            confidence = aligned[0]["conf"]
            if len(aligned) > 1 and re.search(r"\bograniczon[aą]$", name, re.I) and re.match(
                r"^odpowiedzialno", aligned[1]["text"], re.I
            ):
                name += " " + aligned[1]["text"]
        names.setdefault(side, (name, min(round(confidence, 2), 0.9)))
    return names


def extract_buyer_address(lines: list[dict]) -> dict | None:
    for index, heading in enumerate(lines):
        if not re.match(r"^(?:bill(?:ed)? to|buyer|customer|nabywca|odbiorca)\s*:", heading["text"], re.I):
            continue
        parts = []
        first = None
        for number in range(index + 1, min(index + 12, len(lines))):
            line = lines[number]
            if line["page"] != heading["page"]:
                break
            if abs(line["left"] - heading["left"]) > max(5, heading["bottom"] - heading["top"]):
                continue
            text = line["text"]
            if re.search(r"^(?:tel|phone|email|site|nip|vat|date|invoice|faktura|qty|description)\b|@|https?://", text, re.I):
                break
            if len(parts) == 3:
                break
            first = first or number + 1
            parts.append(text)
        if parts and any(char.isdigit() for char in " ".join(parts)):
            return {"text": ", ".join(parts), "page": heading["page"], "line": first}
    return None


def detect_language(text: str) -> str:
    words = set(re.findall(r"[^\W\d_]+", text.casefold()))
    signals = {
        "pl": {"faktura", "paragon", "sprzedawca", "nabywca", "sprzedaży", "zapłaty", "brutto", "kwota", "ilość", "razem"},
        "en": {"invoice", "receipt", "date", "amount", "subtotal", "bill", "quantity", "description", "payment", "due"},
        "de": {"rechnung", "kassenbon", "betrag", "steuer", "menge", "gesamt"},
        "fr": {"facture", "quantité", "montant", "paiement", "acheteur", "vendeur"},
    }
    scores = sorted(((len(words & vocabulary), language) for language, vocabulary in signals.items()), reverse=True)
    return scores[0][1] if scores[0][0] > scores[1][0] else "unknown"


def extract_line_items(rows: list[dict], document_type: str) -> list[dict]:
    aliases = {
        "quantity": {"qty", "quantity", "ilosc", "ilość"},
        "id": {"id", "sku", "kod", "lp", "lp."},
        "description": {"description", "item", "items", "product", "nazwa", "nazwa towaru",
                        "nazwa towaru/usługi", "nazwa towaru/ustugi", "towar", "opis"},
        "unit_price": {"unit price", "price", "rsp", "cena", "cena jedn.", "cena jednostkowa", "cena netto", "cena netto vat"},
        "amount": {"amount", "total", "wartość", "wartosc", "kwota", "kwota brutto", "wartość brutto"},
        "net_amount": {"kwota netto", "wartość netto"},
        "tax_amount": {"kwota vat", "wartość vat"},
        "tax_rate": {"vat", "stawka vat"},
        "unit": {"jm", "j.m.", "im"},
    }
    items = []
    columns = []
    header_page = None
    retail_header = None
    pending_description = ""
    finished_pages = set()
    for row in rows:
        text = row["text"]
        if re.match(r"^(?:GST SUMMARY|PTU\s+[A-G]\s*=|total in words|round(?:ing)?|discount|tot qty|qty:.*total item discount)\b", text, re.I) or any(
            pattern.match(segment) for patterns in SUMMARY_PATTERNS.values() for pattern in patterns
            for segment in summary_segments(row)
        ):
            columns = []
            finished_pages.add(row["page"])
            continue
        if row["page"] in finished_pages:
            continue
        retail_layout = {
            "QTY ITEM TOTAL": "quantity-first", "QTY RM TAX": "quantity-last", "RM CODE": "split-unit"
        }.get(text.upper())
        if retail_layout:
            retail_header = (row["page"], retail_layout)
            pending_description = ""
            continue
        matched = [(cell["left"], key) for cell in row["cells"] for key, labels in aliases.items()
                   if cell["text"].casefold() in labels]
        if len(matched) >= 2 and any(key == "description" for _, key in matched):
            columns, header_page = matched, row["page"]
            continue
        if columns and row["page"] == header_page:
            item = {}
            for cell in row["cells"]:
                _, key = min(columns, key=lambda column: abs(column[0] - cell["left"]))
                item[key] = (item.get(key, "") + " " + cell["text"]).strip()
            quantity_and_price = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s+(\d+[.,]\d{2})", item.get("quantity", ""))
            if quantity_and_price and not item.get("unit_price"):
                item["quantity"], item["unit_price"] = quantity_and_price.groups()
            price_and_tax = re.fullmatch(r"(\d+[.,]\d{2})\s+(\d+(?:[.,]\d+)?%)", item.get("unit_price", ""))
            if price_and_tax and not item.get("tax_rate"):
                item["unit_price"], item["tax_rate"] = price_and_tax.groups()
            if item.get("description") and (item.get("amount") or item.get("unit_price")):
                if item["description"].isdigit():
                    item["id"] = item.pop("description")
                items.append({**item, "page": row["page"], "line": row["line"]})
            elif items and items[-1]["page"] == row["page"] and items[-1].get("id") and item.get("description"):
                description = items[-1].get("description", "")
                items[-1]["description"] = (description + " " + item["description"]).strip()
        elif retail_header and row["page"] == retail_header[0]:
            layout = retail_header[1]
            if layout == "split-unit":
                match = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(?:PC|PCS)\s*X\s*(-?\d+[.,]\d{2})", text, re.I)
                if match and pending_description:
                    quantity, amount = match.groups()
                    items.append({"description": pending_description, "quantity": quantity, "amount": amount,
                                  "page": row["page"], "line": row["line"]})
                    pending_description = ""
                elif re.search(r"[A-Z]{3}", text, re.I) and not re.match(r"^\d+[.,]\d+\s+(?:SR|ZR|ES)\b", text, re.I):
                    pending_description = text
                continue
            if layout == "quantity-first":
                match = re.fullmatch(r"(\d+)\s+(.+?)\s+(-?\d+[.,]\d{2})", text)
                if match:
                    quantity, description, amount = match.groups()
            else:
                match = re.fullmatch(r"(.+?)\s+(\d+)\s+(-?\d+[.,]\d{2})(?:\s+(?:SR|ZR|ES))?", text)
                if match:
                    description, quantity, amount = match.groups()
                else:
                    match = re.fullmatch(r"(.+?)\s+(-?\d+[.,]\d{2})\s+(?:SR|ZR|ES)", text)
                    if match:
                        description, amount = match.groups()
                        quantity = None
            if match:
                item = {"description": description, "amount": amount, "page": row["page"], "line": row["line"]}
                if quantity is not None:
                    item["quantity"] = quantity
                items.append(item)
        elif match := re.fullmatch(r"[A-G]\s+(\d+)\s+(.+?)\s+(-?\d+[.,]\d{2})", text):
            quantity, description, amount = match.groups()
            items.append({"description": description, "quantity": quantity, "amount": amount,
                          "page": row["page"], "line": row["line"]})
        elif document_type == "receipt":
            fiscal_item = re.fullmatch(
                r"(\d+(?:[.,]\d+)?)\s*(?:szt\.?|kg|l|m)\s*[*x×]\s*(\d+[.,]\d{2})\s*=\s*(\d+[.,]\d{2})(?:\s*[A-G])?",
                text, re.I)
            if fiscal_item and pending_description:
                quantity, unit_price, amount = fiscal_item.groups()
                items.append({"description": pending_description, "quantity": quantity,
                              "unit_price": unit_price, "amount": amount, "page": row["page"], "line": row["line"]})
                pending_description = ""
                continue
            match = re.match(r"^([^\d].*?[^\d ])\s+(-?\d+[.,]\d{2})\s*[A-G]?$", row["text"])
            if match and not re.search(r"^(?:sp\.?\s*op\.?|reszta|gotówka|karta|cash|change|card|rabat|discount)\b", text, re.I):
                items.append({"description": match.group(1), "amount": match.group(2),
                              "page": row["page"], "line": row["line"]})
            elif re.match(r"^\D{3,}$", text) and not re.match(r"^(?:paragon|cash bill|receipt)\b", text, re.I):
                pending_description = text
    return items


def extract_invoice_number(rows: list[dict]) -> str | None:
    identifier = r"[ .:#-]*((?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]*)"
    labelled = re.compile(r"^(?:faktura(?:\s+VAT)?\s+(?:nr|numer)|(?:nr|numer)\s+faktury|"
                          r"(?:tax\s+)?invoice\s*(?:no\.?|number|#)|inv\s*#)" + identifier, re.I)
    short_label = re.compile(r"^no\.?\s*:" + identifier, re.I)
    separate_label = re.compile(r"^(?:faktura(?:\s+VAT)?\s+(?:nr|numer)|invoice\s+(?:no\.?|number))\s*[:#.]?$", re.I)
    heading = re.compile(r"^(?:(?:tax|commercial)\s+)?invoice\b", re.I)
    for index, row in enumerate(rows):
        for segment in summary_segments(row):
            match = labelled.match(segment)
            if match:
                return match.group(1)
            if separate_label.fullmatch(segment) and index + 1 < len(rows) and rows[index + 1]["page"] == row["page"]:
                next_text = rows[index + 1]["text"]
                match = re.fullmatch(identifier, next_text, re.I)
                if match and not find_date_in_text(next_text):
                    return match.group(1)
            if heading.match(segment):
                nearby = [segment[heading.match(segment).end():].strip(),
                          *(following["text"] for following in rows[index + 1:index + 3]
                            if following["page"] == row["page"])]
                for line in nearby:
                    match = short_label.match(line)
                    if match:
                        return match.group(1)
    return None


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
        res = page.get("res", page)
        rec_texts = res.get("rec_texts", [])
        rec_scores = res.get("rec_scores", [])
        dt_polys = res.get("rec_polys", res.get("dt_polys", []))

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
            right = 0
            bottom = 0
            if idx < len(dt_polys):
                poly = dt_polys[idx]
                xs = [int(p[0]) for p in poly]
                ys = [int(p[1]) for p in poly]
                left = min(xs) if xs else 0
                top = min(ys) if ys else 0
                right = max(xs) if xs else 0
                bottom = max(ys) if ys else 0

            lines.append({
                "text": text,
                "conf": max(0.0, min(1.0, score)),
                "top": top,
                "left": left,
                "right": right,
                "bottom": bottom,
            })

    return lines


def extract_vendor_name(lines: list[dict]) -> tuple[str, float]:
    candidates = []

    for index, line in enumerate(lines[:25]):
        text = normalize_spaces(line["text"])
        lower = text.lower()

        if re.match(r"^(?:bill to|buyer|customer|nabywca|odbiorca|qty|quantity|description|ilość)\b", lower):
            break
        explicit = re.match(r"^(?:seller|vendor|sprzedawca|wystawca)\s*:\s*(.+)", text, re.I)
        if explicit:
            return explicit.group(1), 0.9
        if re.match(r"^(?:address|adres|cashier|date|data wystawienia|invoice no|"
                    r"gst(?:in|\s+(?:id|no|reg))|no\.?\s*\d|(?:lot|jalan)\s+\w)\b", lower):
            continue
        if candidates and re.fullmatch(r"(?:(?:simplified tax|tax|commercial)\s+)?invoice|cash bill|paragon fiskalny", lower):
            break
        if re.match(r"^(?:formerly known as|licensee of|p\.?o\.? number|bank name|due date|copy)\b", lower):
            continue
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

        score = line["conf"] - index * 0.045
        score += 0.20 if digits_count == 0 else -0.10
        score += 0.15 if 2 <= word_count <= 6 else 0
        score += 0.36 if any(re.search(r"(?<!\w)" + re.escape(marker) + r"(?!\w)", lower) for marker in COMPANY_MARKERS) else 0
        score += 0.08 if line["left"] < 250 else 0

        candidates.append((score, text, line["conf"]))

    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0]
        return best[1], round(max(0.45, min(0.86, best[2])), 2)

    return "", 0.1


def extract_invoice_date(lines: list[dict], full_text: str) -> tuple[str, float]:
    for i, line in enumerate(lines):
        lower = line["text"].lower()
        if re.match(r"^(?:data wystawienia|invoice date|issue date|date|data)\b", lower):
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


def currency_from_text(text: str) -> str | None:
    lower = text.lower()

    for token, normalized in CURRENCY_MAP.items():
        if re.search(r"(?<![\w])" + re.escape(token) + r"(?![\w])", lower) or (len(token) == 1 and token in lower):
            return normalized
    return None


def extract_currency(full_text: str, total_text: str = "") -> tuple[str, float]:
    currency = currency_from_text(total_text) or currency_from_text(full_text)
    if currency:
        return currency, 0.9 if currency_from_text(total_text) else 0.85

    if (re.search(r"\b(?:sdn\.?\s+bhd\.?|perniagaan)\b|\.com\.my\b", full_text, re.I)
            and re.search(r"\b(?:johor|selangor|kuala lumpur|malaysia)\b|\.com\.my\b", full_text, re.I)):
        return "MYR", 0.7
    if re.search(r"\bparagon\s+fiskalny\b", full_text, re.I) and re.search(r"\bNIP\b", full_text, re.I):
        return "PLN", 0.7
    return "", 0.1


def find_dates_in_text(text: str) -> list[str]:
    patterns = [
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{4}[./]\d{2}[./]\d{2}\b",
        r"\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b",
        r"\b\d{1,2}-[A-Za-z]{3,9}-\d{4}\b",
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
        "%Y.%m.%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d.%m.%Y",
        "%d %B %Y",
        "%d %b %Y",
        "%d-%b-%Y",
        "%d-%B-%Y",
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
    matches = re.findall(r"(?<![\d.,])([−-]?(?:\d{1,3}(?:[ .,]\d{3})+[.,]\d{2}|\d+[.,]\d{2}))(?![\d.,])", text)
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
    raw = raw.replace("\u00A0", " ").replace("−", "-").strip()
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
