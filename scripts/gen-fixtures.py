#!/usr/bin/env python3
"""fixtures:gen — generates the synthetic Canonical GL Template sample (M0-3).

Outputs docs/examples/sample_gl_dump.csv and sample_gl_dump.xlsx per GL-TEMPLATE-SPEC §2.
Synthetic only (B18-3): 480 rows across Aug 2026, 18 accounts, debit/credit layout.
The .xlsx writer is minimal (zip + inline XML) so no extra python deps are needed.
"""
import csv
import io
import os
import zipfile
from datetime import date

OUT_DIR = os.path.join("docs", "examples")
os.makedirs(OUT_DIR, exist_ok=True)

ACCOUNTS = [
    ("4000", "Sales Revenue", "revenue"),
    ("4100", "Direct Materials", "cogs"),
    ("4200", "Direct Labor", "cogs"),
    ("4300", "Manufacturing Overhead", "cogs"),
    ("5000", "Salaries & Wages", "opex"),
    ("5100", "Rent", "opex"),
    ("5200", "Utilities", "opex"),
    ("5300", "Insurance", "opex"),
    ("5400", "Depreciation", "opex"),
    ("5500", "Travel & Entertainment", "opex"),
    ("1200", "Accounts Receivable", "asset"),
    ("1300", "Inventory", "asset"),
    ("1700", "Property & Equipment", "asset"),
    ("2000", "Accounts Payable", "liability"),
    ("2100", "Accrued Expenses", "liability"),
    ("2200", "Short-Term Debt", "liability"),
    ("3000", "Share Capital", "equity"),
    ("3900", "Retained Earnings", "equity"),
]

ROWS = []
# 480 rows: 20 transactions/day × 24 business days (Aug 2026, Mon-Sat pattern)
amount = 1_825_000  # minor units = 18,250.00
for day in range(1, 25):
    invoice = f"INV-2026-08-{day:03d}"
    ROWS.append(["2026-08", "4000", "Sales Revenue", "", amount, "sales_north", "bu-manu", "USD", invoice, "INVOICE"])
    ROWS.append(["2026-08", "1200", "Accounts Receivable", amount, "", "sales_north", "bu-manu", "USD", invoice, "INVOICE"])
    ROWS.append(["2026-08", "4100", "Direct Materials", amount // 2, "", "plant_a", "bu-manu", "USD", f"PO-{8800+day:04d}", "PURCHASE"])
    ROWS.append(["2026-08", "2000", "Accounts Payable", "", amount // 2, "plant_a", "bu-manu", "USD", f"PO-{8800+day:04d}", "PURCHASE"])
    ROWS.append(["2026-08", "4200", "Direct Labor", amount // 10, "", "plant_a", "bu-manu", "USD", f"PAY-{day:03d}", "PAYROLL"])
    ROWS.append(["2026-08", "2100", "Accrued Expenses", "", amount // 10, "plant_a", "bu-manu", "USD", f"PAY-{day:03d}", "PAYROLL"])
    ROWS.append(["2026-08", "5000", "Salaries & Wages", amount // 5, "", "corp", "bu-manu", "USD", f"PAY-{day:03d}", "PAYROLL"])
    ROWS.append(["2026-08", "2100", "Accrued Expenses", "", amount // 5, "corp", "bu-manu", "USD", f"PAY-{day:03d}", "PAYROLL"])
    ROWS.append(["2026-08", "5200", "Utilities", amount // 40, "", "plant_a", "bu-manu", "USD", f"UTIL-{day:03d}", "BILL"])
    ROWS.append(["2026-08", "2000", "Accounts Payable", "", amount // 40, "plant_a", "bu-manu", "USD", f"UTIL-{day:03d}", "BILL"])
    ROWS.append(["2026-08", "5300", "Insurance", amount // 60, "", "corp", "bu-manu", "USD", f"INS-{day:03d}", "BILL"])
    ROWS.append(["2026-08", "2000", "Accounts Payable", "", amount // 60, "corp", "bu-manu", "USD", f"INS-{day:03d}", "BILL"])
    ROWS.append(["2026-08", "5500", "Travel & Entertainment", amount // 250, "", "corp", "bu-manu", "USD", f"T&E-{day:03d}", "EXPENSE"])
    ROWS.append(["2026-08", "2000", "Accounts Payable", "", amount // 250, "corp", "bu-manu", "USD", f"T&E-{day:03d}", "EXPENSE"])
    ROWS.append(["2026-08", "5400", "Depreciation", amount // 30, "", "plant_a", "bu-manu", "USD", f"DEP-{day:03d}", "DEPRECIATION"])
    ROWS.append(["2026-08", "1700", "Property & Equipment", "", amount // 30, "plant_a", "bu-manu", "USD", f"DEP-{day:03d}", "DEPRECIATION"])
    ROWS.append(["2026-08", "1300", "Inventory", amount // 4, "", "plant_a", "bu-manu", "USD", f"STK-{day:03d}", "JOURNAL"])
    ROWS.append(["2026-08", "4100", "Direct Materials", "", amount // 4, "plant_a", "bu-manu", "USD", f"STK-{day:03d}", "JOURNAL"])
    ROWS.append(["2026-08", "5100", "Rent", amount // 80, "", "corp", "bu-manu", "USD", f"RENT-{day:03d}", "BILL"])
    ROWS.append(["2026-08", "2000", "Accounts Payable", "", amount // 80, "corp", "bu-manu", "USD", f"RENT-{day:03d}", "BILL"])

HEADER = [
    "period", "account_code", "account_name", "debit", "credit", "cost_center",
    "business_unit", "currency", "posting_ref", "doc_type",
]

csv_path = os.path.join(OUT_DIR, "sample_gl_dump.csv")
with open(csv_path, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(HEADER)
    w.writerows(ROWS)

# ---- minimal .xlsx writer (no deps) ----
def col_letter(i):
    s = ""
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s

def xml_escape(v):
    if isinstance(v, (int, float)):
        return str(v)
    return str(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def row_xml(r, type_idx):
    cells = []
    for i, v in enumerate(r):
        t = "s" if isinstance(v, str) else "n"
        styled = ' s="0"' if t == "s" else ''
        cells.append(f'<c r="{col_letter(i+1)}{type_idx+1}" t="{t}"{styled}><v>{xml_escape(v)}</v></c>')
    return f'<row r="{type_idx+1}">' + "".join(cells) + "</row>"

def sheet_xml(rows):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for idx, r in enumerate(rows):
        out.append(row_xml(r, idx))
    out.append("</sheetData></worksheet>")
    return "".join(out).encode("utf-8")

def xlsx_bytes(rows):
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="GL" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
        ),
        "xl/worksheets/sheet1.xml": sheet_xml(rows),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()

xlsx_path = os.path.join(OUT_DIR, "sample_gl_dump.xlsx")
with open(xlsx_path, "wb") as f:
    f.write(xlsx_bytes([HEADER] + ROWS))

# tie-out note (debits == credits to the cent)
debits = sum(r[3] for r in ROWS if isinstance(r[3], int))
credits = sum(r[4] for r in ROWS if isinstance(r[4], int))
assert debits == credits, f"tie-out broken: {debits} != {credits}"
print(f"fixtures:gen OK — {len(ROWS)} rows, tie-out {debits:,} minor units, wrote {csv_path} + {xlsx_path}")
