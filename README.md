# 🧾 DocuMind-AI — Invoice & Receipt Extraction (Document Intelligence)

🚧 **Status: In Progress (under active development)**  

Full-stack project for **extracting key business fields** from **invoices and receipts** (PDF/JPG/PNG), with a built-in **review & correction workflow** and **JSON/CSV export**.

📌 **Scope (MVP):** `vendor_name`, `invoice_date`, `total_amount`, `currency`, `tax_amount`  
🗂️ **Statuses:** `queued → processing → done / failed`  
📝 **Correction:** inline editing + saved as `corrected_result`

---
## 🚀 Live Demo

You can try the current frontend demo here:

👉 **[Open DocuMind-AI Demo](https://avuii.github.io/DocuMind-AI/)**

> Note: This is a frontend demo deployed with GitHub Pages.  
> Some backend/ML features may be mocked or limited in the demo version.
---

## 🎯 Goal
Build an end-to-end system that:
- uploads documents (PDF/JPG/PNG),
- runs an extraction pipeline (OCR / ML),
- stores results and confidence,
- allows manual corrections in UI,
- exports final structured data to **JSON** and **CSV**.

---

## 🧩 What’s inside 

├─ backend/ ASP.NET Core Web API + background worker  
├─ frontend/ Angular UI (document list, details, corrections)  
├─ ml-service/ Python FastAPI inference (stub → OCR → ML model)  
├─ docs/ notes, diagrams, roadmap  
├─ data/ datasets (ignored by git)  
└─ docker-compose.yml  


---

## 🔁 Processing flow (MVP)
1. **Upload** document → saved to storage + DB record created (`queued`)
2. **Analyze** → background worker picks queued docs
3. Worker sets `processing` → calls **ml-service** `/infer`
4. Store **raw_result** + confidence summary → status `done` / `failed`
5. User can **correct fields** → saved as **corrected_result**
6. **Export** final result (corrected if exists, else raw) → JSON / CSV

---

## ✅ Current progress
> This section will be updated as MVP features land.

### Backend (ASP.NET Core)
- [x] Basic document processing foundations (statuses + DTOs)
- [x] Storage-related changes (local MVP storage)
- [x] Processing pipeline groundwork (worker/pipeline merged)
- [ ] Results storage (`document_results`: raw/corrected JSON, model_version, confidence)
- [ ] Analyze endpoint wiring (`POST /api/documents/{id}/analyze`)
- [x] Export endpoints (JSON/CSV)

### Frontend (Angular)
- [ ] Upload page (drag & drop + progress)
- [ ] Documents list + filters + pagination
- [ ] Document details + extracted fields table
- [ ] Inline correction + “edited” highlighting
- [ ] Export buttons (JSON/CSV)

### ML Service (FastAPI)
- [x] `/infer` stub (to unblock end-to-end demo)
- [x] OCR baseline switched to paddle
- [x] ML model integration (layout-aware document understanding)

---

## 🧠 AI / Extraction plan
### Phase 1 — Stub (end-to-end demo)
- `/infer` returns fixed JSON in the final contract format  
- Goal: validate pipeline + UI + DB before real extraction

### Phase 2 — OCR baseline (practical results fast)
- PDF → images
- OCR with **Polish characters** support (UTF-8 end-to-end)
- heuristics for totals / tax / dates / currency

### Phase 3 — ML model (better generalization)
Train / fine-tune on public datasets (then extend with Polish samples):
- **SROIE** (receipts)
- **CORD** (receipts)
- **FATURA (Zenodo)** (synthetic invoices)

---

## 📦 Output format (API contract)
```json
{
  "fields": {
    "vendor_name":   {"value":"...",       "confidence":0.82},
    "invoice_date":  {"value":"YYYY-MM-DD","confidence":0.77},
    "total_amount":  {"value":123.45,      "confidence":0.91},
    "currency":      {"value":"PLN",       "confidence":0.88},
    "tax_amount":    {"value":23.45,       "confidence":0.69}
  },
  "model_version": "stub-v0"
}
```
---

## 🛠️ Tech stack
Backend: ASP.NET Core  
Frontend: Angular  
ML Service: Python + FastAPI  
Database: PostgreSQL (dev)  
Containers: Docker Compose  

---
### 🧑‍💻 Author

Created by Avuii


