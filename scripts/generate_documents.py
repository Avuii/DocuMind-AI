"""Generate annotated synthetic Polish business documents for OCR/VLM."""

import argparse
import base64
from collections import defaultdict
from datetime import date, timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import qrcode


LABELS = {
    "pl": ("FAKTURA VAT", "PARAGON FISKALNY", "DOKUMENT SYNTETYCZNY", "Sprzedawca", "Nabywca",
           "Data wystawienia", "Data sprzedaży", "Termin płatności", "Pozycja", "Ilość", "Cena netto",
           "Netto", "Brutto", "SUMA PLN", "Nr paragonu", "Płatność kartą", "Rozliczenie VAT"),
    "en": ("VAT INVOICE", "FISCAL RECEIPT", "SYNTHETIC DOCUMENT", "Seller", "Buyer",
           "Issue date", "Sale date", "Due date", "Item", "Qty", "Unit net",
           "Net", "Gross", "TOTAL PLN", "Receipt no.", "Card payment", "VAT breakdown"),
    "de": ("UMSATZSTEUERRECHNUNG", "KASSENBELEG", "SYNTHETISCHES DOKUMENT", "Verkäufer", "Käufer",
           "Rechnungsdatum", "Leistungsdatum", "Fälligkeitsdatum", "Position", "Menge", "Einzelpreis netto",
           "Netto", "Brutto", "GESAMT PLN", "Belegnummer", "Kartenzahlung", "MwSt.-Übersicht"),
}

CATALOG = {
    "retail": [("Chleb żytni", "Rye bread", "Roggenbrot", 599, 5),
               ("Kawa ziarnista", "Coffee beans", "Kaffeebohnen", 2480, 23),
               ("Olej rzepakowy", "Rapeseed oil", "Rapsöl", 850, 5)],
    "construction": [("Zaprawa murarska", "Masonry mortar", "Mauermörtel", 2790, 23),
                     ("Poziomica", "Spirit level", "Wasserwaage", 4500, 23),
                     ("Wiertło do betonu", "Masonry drill bit", "Betonbohrer", 1690, 23)],
    "technology": [("Konfiguracja systemu", "System setup", "Systemeinrichtung", 18500, 23),
                   ("Dysk zewnętrzny", "External drive", "Externe Festplatte", 24490, 23),
                   ("Kabel sieciowy", "Network cable", "Netzwerkkabel", 850, 23)],
    "hospitality": [("Nocleg", "Accommodation", "Übernachtung", 18900, 8),
                    ("Śniadanie", "Breakfast", "Frühstück", 3200, 8),
                    ("Woda mineralna", "Mineral water", "Mineralwasser", 500, 23)],
    "automotive": [("Filtr oleju", "Oil filter", "Ölfilter", 2880, 23),
                   ("Wymiana oleju", "Oil change", "Ölwechsel", 7400, 23),
                   ("Płyn do szyb", "Washer fluid", "Scheibenreiniger", 1370, 23)],
    "office": [("Papier do drukarki", "Printer paper", "Druckerpapier", 2480, 23),
               ("Teczka kartonowa", "Cardboard folder", "Kartonmappe", 670, 23),
               ("Korekta tekstu", "Proofreading", "Korrekturlesen", 8000, 23)],
}


def nip(rng):
    while True:
        digits = [9, 9, 9] + [rng.randrange(10) for _ in range(6)]
        check = sum(a * b for a, b in zip(digits, (6, 5, 7, 2, 3, 4, 5, 6, 7))) % 11
        if check < 10:
            return "".join(map(str, [*digits, check]))


def amount(cents):
    return f"{'-' if cents < 0 else ''}{abs(cents) // 100}.{abs(cents) % 100:02}"


def make_data(kind, language, index, rng):
    industry = list(CATALOG)[index % len(CATALOG)]
    issue = date(2025, 1, 1) + timedelta(days=rng.randrange(650))
    layout = (("classic", "framed", "sidebar") if kind == "invoice"
              else ("thermal_columns", "thermal_stacked"))[index % (3 if kind == "invoice" else 2)]
    names = ("Makieta", "Próbka", "Model", "Szablon", "Fikcja", "Wzorzec")
    seller = {"name": f"{rng.choice(names)} {rng.randrange(100, 999)} Sp. z o.o.",
              "nip": nip(rng), "address": f"ul. Testowa {rng.randrange(1, 90)}, 00-000 Miasto"}
    buyer = {"nip": nip(rng)}
    if kind == "invoice":
        buyer |= {"name": f"Próba {rng.randrange(100, 999)} Sp. z o.o.",
                  "address": f"ul. Przykładowa {rng.randrange(1, 90)}, 00-000 Miasto"}
    rows, by_rate = [], defaultdict(lambda: [0, 0, 0])
    for item in rng.sample(CATALOG[industry], rng.randint(2, 3)):
        *translations, base, rate = item
        quantity, unit = rng.randint(1, 7), base + rng.randrange(-100, 501)
        if kind == "receipt":
            # A receipt prints a gross unit price. Split each printed line into net and VAT.
            unit_gross = (unit * (100 + rate) + 50) // 100
            gross = unit_gross * quantity
            net = (gross * 100 + (100 + rate) // 2) // (100 + rate)
            tax = gross - net
            prices = {"unit_gross": amount(unit_gross)}
        else:
            net = quantity * unit
            tax = (net * rate + 50) // 100
            gross = net + tax
            prices = {"unit_net": amount(unit)}
        rows.append({"description": translations[list(LABELS).index(language)], "quantity": quantity,
                     "vat_rate": rate, **prices, "net": amount(net), "vat": amount(tax), "gross": amount(gross)})
        for pos, value in enumerate((net, tax, gross)):
            by_rate[rate][pos] += value
    totals = ("net", "vat", "gross")
    return {
        "schema_version": 1, "synthetic": True, "document_type": kind, "language": language,
        "layout": layout, "industry": industry, "currency": "PLN",
        "number": f"{'FV' if kind == 'invoice' else 'PF'}/{issue:%Y/%m}/{index + 1:04d}",
        "issue_date": issue.isoformat(), "sale_date": issue.isoformat(),
        **({"due_date": (issue + timedelta(days=14)).isoformat()} if kind == "invoice" else {}),
        "seller": seller, "buyer": buyer, "line_items": rows,
        "totals": {name: amount(sum(values[i] for values in by_rate.values())) for i, name in enumerate(totals)},
        "tax_breakdown": [{"vat_rate": rate, **dict(zip(totals, map(amount, values)))}
                          for rate, values in sorted(by_rate.items())],
        **({"payment_method": "card"} if kind == "receipt" else {}),
    }


def find_fonts(folder):
    candidates = [Path(folder)] if folder else [
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
        Path("/usr/share/fonts/truetype/dejavu"),
    ]
    for path in candidates:
        for names in (("arial.ttf", "arialbd.ttf", "consola.ttf"),
                      ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSansMono.ttf")):
            files = [path / name for name in names]
            if all(file.is_file() for file in files):
                return files
    raise SystemExit("Provide --font-dir with Arial + Consolas or DejaVu Sans fonts.")


class Page:
    def __init__(self, width, height, paper, font_files):
        self.image = Image.new("RGB", (width, height), paper)
        self.draw = ImageDraw.Draw(self.image)
        self.fonts = font_files
        self.cache = {}
        self.annotations = []

    def write(self, x, y, value, field=None, *, size=24, style=0, anchor="lt", color="#20262d", item=None):
        if (style, size) not in self.cache:
            self.cache[style, size] = ImageFont.truetype(str(self.fonts[style]), size)
        font = self.cache[style, size]
        value = str(value)
        box = self.draw.textbbox((x, y), value, font=font, anchor=anchor)
        if not (0 <= box[0] < box[2] <= self.image.width and 0 <= box[1] < box[3] <= self.image.height):
            raise ValueError(f"Text outside the image: {value!r}, {box}")
        self.draw.text((x, y), value, font=font, anchor=anchor, fill=color)
        self.annotations.append({"text": value, "bbox": list(box),
                                 **({"field": field} if field else {}),
                                 **({"item_index": item} if item is not None else {})})


def render(data, fonts, rng):
    inv, receipt, sample, seller, buyer, issued, sold, due, desc, qty, unit, net, gross, total, ref, card, tax = LABELS[data["language"]]
    language = data["language"]
    invoice = data["document_type"] == "invoice"
    layout = data["layout"]
    money = lambda value: value if language == "en" else value.replace(".", ",")
    formatted = lambda value: date.fromisoformat(value).strftime("%d.%m.%Y")
    accent = rng.choice(["#254a67", "#5b3857", "#22574b", "#4b4b56"])
    if invoice:
        p = Page(1180, 1390, "#fffefb", fonts)
        w = p.write
        x, y = 62, 68
        if layout == "framed":
            p.draw.rounded_rectangle((44, 40, 1136, 192), radius=18, outline=accent, width=4, fill="#eef3f4")
            x, y = 74, 75
        elif layout == "sidebar":
            p.draw.rectangle((40, 219, 438, 1072), fill="#eff2f3")
        w(x, y, inv, "document_type", size=46, style=1, color=accent)
        w(x, y + 68, ("Nr " if language != "en" else "No. ") + data["number"], "number", size=27)
        w(1118, 198, sample, "synthetic", anchor="rt", size=21, color=accent)
        left = 63
        table = 468 if layout == "sidebar" else left
        for side, label, px, py in (
            ("seller", seller, left, 252),
            ("buyer", buyer, left if layout == "sidebar" else 630, 399 if layout == "sidebar" else 252),
        ):
            w(px, py, label, size=24, style=1, color=accent)
            for row, key in enumerate(("name", "address", "nip"), 1):
                value = data[side][key]
                w(px, py + row * 30, ("NIP: " if key == "nip" else "") + value, f"{side}.{key}", size=18)
        date_x = left if layout == "sidebar" else 65
        date_y = 568 if layout == "sidebar" else 414
        for i, (label, key) in enumerate(((issued, "issue_date"), (sold, "sale_date"), (due, "due_date"))):
            w(date_x, date_y + i * 33, f"{label}: {formatted(data[key])}", key, size=19)
        table_y = 270 if layout == "sidebar" else 555
        cols = (table + 20, 775, 934, 1002, 1110)
        p.draw.rectangle((table, table_y - 10, 1130, table_y + 41), fill=accent)
        for i, (px, label) in enumerate(zip(cols, (desc, qty, unit, "VAT", gross))):
            w(px, table_y, label, size=16 if i == 2 else 20, style=1, anchor="lt" if i == 0 else "rt", color="white")
        for i, row in enumerate(data["line_items"]):
            py = table_y + 53 + i * 53
            if i % 2 == 0:
                p.draw.rectangle((table, py - 7, 1130, py + 39), fill="#eef3f4")
            for col, (px, key) in enumerate(zip(cols, ("description", "quantity", "unit_net", "vat_rate", "gross"))):
                value = row[key]
                if key in ("unit_net", "gross"):
                    value = money(value)
                if key == "vat_rate":
                    value = f"{value}%"
                w(px, py, value, f"line_items.{key}", item=i, size=20, anchor="lt" if col == 0 else "rt")
        totals_y = table_y + 74 + len(data["line_items"]) * 53
        w(table + 18, totals_y, tax, size=22, style=1, color=accent)
        for i, row in enumerate(data["tax_breakdown"]):
            value = f"{row['vat_rate']}%   {net}: {money(row['net'])}   VAT: {money(row['vat'])}"
            w(table + 18, totals_y + 37 + i * 34, value, f"tax_breakdown.{i}", size=20)
        for i, (label, key) in enumerate(((net, "net"), ("VAT", "vat"), (total, "gross"))):
            w(1118, totals_y + 125 + i * 35, f"{label}: {money(data['totals'][key])}", "totals." + key,
              size=29 if key == "gross" else 21, style=1, anchor="rt")

        payload_data = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
        digest = base64.urlsafe_b64encode(sha256(payload_data).digest()).decode().rstrip("=")
        qr_date = date.fromisoformat(data["issue_date"]).strftime("%d-%m-%Y")
        payload = f"https://ksef-demo.example.invalid/invoice/{data['seller']['nip']}/{qr_date}/{digest}"
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=4, border=4)
        qr.add_data(payload)
        qr_image = qr.make_image().convert("RGB")
        qr_x, qr_y = 57, 1092
        p.image.paste(qr_image, (qr_x, qr_y))
        data["ksef_qr"] = {"test_only": True, "payload": payload, "hash_source": "canonical_synthetic_json",
                           "bbox": [qr_x, qr_y, qr_x + qr_image.width, qr_y + qr_image.height]}
        w(75, qr_y + qr_image.height + 6, "KSeF – TEST", "ksef_qr.label", size=19, style=1)
        sx, sy = 761, 1122
        stamp = Image.new("RGBA", (334, 113))
        ink = (34, 64, 141, 155)
        stamp_draw = ImageDraw.Draw(stamp)
        stamp_draw.rounded_rectangle((6, 6, 327, 106), radius=11, outline=ink, width=4)
        stamp_lines = (data["seller"]["name"], f"NIP {data['seller']['nip']}", "TEST")
        for i, value in enumerate(stamp_lines):
            stamp_draw.text((167, 20 + i * 25), value, fill=ink, anchor="mt",
                            font=ImageFont.truetype(str(fonts[1]), 18))
        stamp = stamp.rotate(rng.uniform(-9, 9), expand=True, resample=Image.Resampling.BICUBIC)
        p.image.paste(stamp, (sx, sy), stamp)
        data["stamp"] = {"text": list(stamp_lines), "bbox": [sx, sy, sx + stamp.width, sy + stamp.height]}
    else:
        p = Page(600, 1060, "#fffdf5", fonts)

        def r(y, value, field=None, x=36, anchor="lt", size=21, item=None):
            p.write(x, y, value, field, anchor=anchor, size=size, style=2, item=item)

        r(42, data["seller"]["name"], "seller.name", 300, "mt", 26)
        r(83, data["seller"]["address"], "seller.address", 300, "mt")
        r(116, "NIP: " + data["seller"]["nip"], "seller.nip", 300, "mt")
        r(182, receipt, "document_type", 300, "mt", 31)
        r(230, f"{ref}: {data['number']}", "number")
        r(260, formatted(data["issue_date"]), "issue_date")
        p.draw.line((35, 301, 565, 301), fill="#555555", width=2)
        y = 324
        for i, row in enumerate(data["line_items"]):
            # Letters stay consistent within this synthetic document and are labeled in the JSON.
            code = {23: "A", 8: "B", 5: "C"}[row["vat_rate"]]
            row["tax_code"] = code
            quantity = f"{row['quantity']} x {money(row['unit_gross'])}"
            r(y, row["description"], "line_items.description", size=20, item=i)
            r(y + 28, quantity, "line_items.quantity_and_unit_gross", size=20, item=i)
            r(y + (28 if layout == "thermal_stacked" else 0), f"{money(row['gross'])} {code}",
              "line_items.gross_and_tax_code", 562, "rt", 20, i)
            y += 66
        p.draw.line((35, y, 565, y), fill="#555555", width=2)
        r(y + 18, tax, size=21)
        for i, row in enumerate(data["tax_breakdown"]):
            r(y + 53 + i * 27, f"VAT {row['vat_rate']}%  {money(row['vat'])}", f"tax_breakdown.{i}")
        y += 69 + 27 * len(data["tax_breakdown"])
        r(y, total, size=27)
        r(y, money(data["totals"]["gross"]), "totals.gross", 562, "rt", 27)
        r(y + 48, card, "payment_method")
        r(y + 85, f"{buyer} NIP: {data['buyer']['nip']}", "buyer.nip")
        r(y + 137, sample, "synthetic", 300, "mt")
    return p


def degrade(image, mode, seed):
    if mode == "clean":
        return image, {"mode": mode, "jpeg_quality": 96}
    rng = np.random.default_rng(seed)
    width, height = image.size
    y, x = np.ogrid[0:1:complex(height), 0:1:complex(width)]
    photo = mode == "photo"
    angle = float(rng.uniform(-np.pi, np.pi))
    axis = np.cos(angle) * (x - .5) + np.sin(angle) * (y - .5)
    shadow = float(rng.uniform(42, 76) if photo else rng.uniform(14, 32))
    lighting = -shadow * np.clip(axis + .29, 0, 1) ** 1.6
    lighting -= (21 if photo else 8) * np.exp(-((x + .01) / .12) ** 2)
    folds = []
    for _ in range(int(rng.integers(2, 6))):
        origin, slope, band = map(float, (rng.uniform(.08, .92), rng.uniform(-.54, .54), rng.uniform(.003, .014)))
        strength = float(rng.uniform(12, 32))
        distance = y - origin - slope * (x - .5) - .019 * np.sin(x * 8 + origin * 11)
        lighting += -strength * np.exp(-((distance + band / 2) / band) ** 2)
        lighting += strength * .72 * np.exp(-((distance - band) / (band * .9)) ** 2)
        folds.append({"offset": origin, "slope": slope, "width": band, "strength": strength})
    noise = float(rng.uniform(2.1, 5.2))
    blur = float(rng.uniform(.22, .61) if photo else rng.uniform(.07, .3))
    rgb = np.asarray(image, dtype=np.float32)
    paper = (lighting + rng.normal(0, noise, (height, width)))[:, :, None]
    image = Image.fromarray(np.clip(rgb + paper, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    return image, {"mode": mode, "seed": seed, "jpeg_quality": 87 if photo else 93, "noise_stddev": noise,
                   "blur_radius": blur, "shadow_strength": shadow, "shadow_angle": angle, "wrinkles": folds}


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", "-l", nargs="+", choices=LABELS, default=["pl"])
    parser.add_argument("--invoices", type=int, default=8, help="Invoice count per language")
    parser.add_argument("--receipts", type=int, default=8, help="Receipt count per language")
    parser.add_argument("--seed", type=int, default=20261111)
    parser.add_argument("--degradation", choices=("mixed", "scan", "photo", "clean"), default="mixed")
    parser.add_argument("--font-dir")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "datasets" / "Generated")
    args = parser.parse_args()
    if min(args.invoices, args.receipts) < 0 or args.invoices + args.receipts == 0:
        parser.error("Counts must be nonnegative, with at least one document.")
    fonts = find_fonts(args.font_dir)
    manifest = []
    for language in dict.fromkeys(args.language):
        for kind, count in (("invoice", args.invoices), ("receipt", args.receipts)):
            for i in range(count):
                rng = random.Random(f"{args.seed}:{language}:{kind}:{i}")
                data = make_data(kind, language, i, rng)
                page = render(data, fonts, rng)
                mode = ("scan", "photo")[i % 2] if args.degradation == "mixed" else args.degradation
                image, effects = degrade(page.image, mode, rng.getrandbits(64))
                stem = f"{kind}-{args.seed}-{i + 1:04d}"
                image_path = Path(language) / "images" / (stem + ".jpg")
                truth_path = Path(language) / "ground_truth" / (stem + ".json")
                for path in (image_path, truth_path):
                    (args.output / path).parent.mkdir(parents=True, exist_ok=True)
                image.save(args.output / image_path, quality=effects["jpeg_quality"], subsampling=0)
                data.update(image=image_path.as_posix(), image_width=image.width, image_height=image.height,
                            bbox_format="xyxy_pixels_exclusive", text_annotations=page.annotations, degradation=effects)
                write_json(args.output / truth_path, data)
                manifest.append({"image": image_path.as_posix(), "ground_truth": truth_path.as_posix(),
                                 "document_type": kind, "language": language, "layout": data["layout"]})
    write_json(args.output / "manifest.json", manifest)
    print(f"{len(manifest)} images and ground_truth JSON files: {args.output.resolve()}")


if __name__ == "__main__":
    main()
