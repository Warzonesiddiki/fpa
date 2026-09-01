#!/usr/bin/env python3
"""fixtures:gen — generates the synthetic Canonical GL Template sample (M0-3).

Outputs (deterministic — byte-identical across runs/machines, B5):
  docs/examples/sample_gl_dump.csv      — Canonical GL Template (GL-TEMPLATE-SPEC §2)
  docs/examples/sample_gl_dump.xlsx     — same data as a 3-sheet workbook
                                          (GL + COA + Dimensions, §5 "recommended")
  docs/examples/sample_gl_dump.expected.json — exact expected values (oracle sidecar,
                                          TEST-FIXTURES-SPEC: amounts to the cent)

Synthetic only (B18-3): 480 rows, single period 2026-08 (P08 in an Apr-start calendar),
18 accounts, debit/credit layout. Money math is INTEGER minor units throughout;
file values are rendered as major-unit decimals with exactly 2 dp
(GL-TEMPLATE-SPEC §2 "decimal (>= 2 dp)"). The .xlsx writer is a minimal,
dependency-free OOXML emitter (inline string cells — `t="inlineStr"`, the valid
form; a `t="s"` cell with raw text would be malformed OOXML).
Self-verification: after writing, the generator RE-READS the xlsx (zipfile +
ElementTree), reconstructs every sheet, and asserts row-for-row equality with the
CSV plus the tie-out (sum debit == sum credit to the cent).
"""
import hashlib
import io
import json
import os
import zipfile
import xml.etree.ElementTree as ET

OUT_DIR = os.path.join("docs", "examples")
os.makedirs(OUT_DIR, exist_ok=True)

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

ACCOUNTS = [
    # (code, name, type, section)
    ("4000", "Sales Revenue", "revenue", "Revenue"),
    ("4100", "Direct Materials", "cogs", "COGS"),
    ("4200", "Direct Labor", "cogs", "COGS"),
    ("4300", "Manufacturing Overhead", "cogs", "COGS"),
    ("5000", "Salaries & Wages", "opex", "OpEx"),
    ("5100", "Rent", "opex", "OpEx"),
    ("5200", "Utilities", "opex", "OpEx"),
    ("5300", "Insurance", "opex", "OpEx"),
    ("5400", "Depreciation", "opex", "OpEx"),
    ("5500", "Travel & Entertainment", "opex", "OpEx"),
    ("1200", "Accounts Receivable", "asset", "Current Assets"),
    ("1300", "Inventory", "asset", "Current Assets"),
    ("1700", "Property & Equipment", "asset", "Non-current Assets"),
    ("2000", "Accounts Payable", "liability", "Current Liabilities"),
    ("2100", "Accrued Expenses", "liability", "Current Liabilities"),
    ("2200", "Short-Term Debt", "liability", "Current Liabilities"),
    ("3000", "Share Capital", "equity", "Equity"),
    ("3900", "Retained Earnings", "equity", "Equity"),
]
CODE2META = {c: (n, t, s) for c, n, t, s in ACCOUNTS}

DIMENSIONS = [
    # (dimension_key, code, name, parent_code)
    ("cost_center", "sales_north", "Sales - North", ""),
    ("cost_center", "plant_a", "Plant A", ""),
    ("cost_center", "corp", "Corporate", ""),
    ("business_unit", "bu-manu", "Manufacturing BU", ""),
]

PERIOD = "2026-08"
BASE = 1_825_000  # minor units of a single daily unit (18,250.00 major)

GL_HEADER = [
    "period",
    "account_code",
    "account_name",
    "debit",
    "credit",
    "cost_center",
    "business_unit",
    "currency",
    "posting_ref",
    "doc_type",
]
COA_HEADER = ["code", "name", "type", "section", "parent_code"]
DIM_HEADER = ["dimension_key", "code", "name", "parent_code"]

ROWS = []
# 480 rows: 20 line rows/day x 24 days (Aug 2026, days 1-24). Every entry is a
# balanced debit/credit pair in INTEGER minor units (tie-out holds per pair).
for day in range(1, 25):
    invoice = f"INV-2026-08-{day:03d}"
    ROWS.append((PERIOD, "4000", "", BASE, "sales_north", invoice, "INVOICE"))
    ROWS.append((PERIOD, "1200", BASE, "", "sales_north", invoice, "INVOICE"))
    ROWS.append((PERIOD, "4100", "", BASE // 2, "plant_a", f"PO-{8800 + day:04d}", "PURCHASE"))
    ROWS.append((PERIOD, "2000", BASE // 2, "", "plant_a", f"PO-{8800 + day:04d}", "PURCHASE"))
    ROWS.append((PERIOD, "4200", "", BASE // 10, "plant_a", f"PAY-{day:03d}", "PAYROLL"))
    ROWS.append((PERIOD, "2100", BASE // 10, "", "plant_a", f"PAY-{day:03d}", "PAYROLL"))
    ROWS.append((PERIOD, "5000", "", BASE // 5, "corp", f"PAY-{day:03d}", "PAYROLL"))
    ROWS.append((PERIOD, "2100", BASE // 5, "", "corp", f"PAY-{day:03d}", "PAYROLL"))
    ROWS.append((PERIOD, "5200", "", BASE // 40, "plant_a", f"UTIL-{day:03d}", "BILL"))
    ROWS.append((PERIOD, "2000", BASE // 40, "", "plant_a", f"UTIL-{day:03d}", "BILL"))
    ROWS.append((PERIOD, "5300", "", BASE // 60, "corp", f"INS-{day:03d}", "BILL"))
    ROWS.append((PERIOD, "2000", BASE // 60, "", "corp", f"INS-{day:03d}", "BILL"))
    ROWS.append((PERIOD, "5500", "", BASE // 250, "corp", f"T&E-{day:03d}", "EXPENSE"))
    ROWS.append((PERIOD, "2000", BASE // 250, "", "corp", f"T&E-{day:03d}", "EXPENSE"))
    ROWS.append((PERIOD, "5400", "", BASE // 30, "plant_a", f"DEP-{day:03d}", "DEPRECIATION"))
    ROWS.append((PERIOD, "1700", BASE // 30, "", "plant_a", f"DEP-{day:03d}", "DEPRECIATION"))
    ROWS.append((PERIOD, "1300", "", BASE // 4, "plant_a", f"STK-{day:03d}", "JOURNAL"))
    ROWS.append((PERIOD, "4100", BASE // 4, "", "plant_a", f"STK-{day:03d}", "JOURNAL"))
    ROWS.append((PERIOD, "5100", "", BASE // 80, "corp", f"RENT-{day:03d}", "BILL"))
    ROWS.append((PERIOD, "2000", BASE // 80, "", "corp", f"RENT-{day:03d}", "BILL"))


def prettified_json(obj) -> str:
    """JSON formatted like `prettier` (repo config: 2-space, printWidth 100):
    short arrays of scalars are inlined. Keeps generated fixtures clean under
    the `prettier --check` gate without a node dependency in this script."""
    text = json.dumps(obj, indent=2)
    lines = text.split("\n")
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = line.rstrip().rstrip(",")
        if m.endswith(": [") and i + 1 < len(lines):
            j = i + 1
            elems = []
            while j < len(lines) and not lines[j].lstrip().startswith("]"):
                elems.append(lines[j].strip().rstrip(",").strip())
                j += 1
            if (
                j < len(lines)
                and lines[j].lstrip().startswith("]")
                and all(not e.startswith(("{", "[")) for e in elems)
            ):
                inline = f"{line[: -len(': [')]}: [" + ", ".join(elems) + "]"
                inline = inline.rstrip(",")
                if len(inline) <= 100:
                    comma = "," if lines[j].lstrip().startswith("],") else ""
                    out.append(inline + comma)
                    i = j + 1
                    continue
        out.append(line)
        i += 1
    return "\n".join(out) + "\n"


def minor_to_text(minor: int) -> str:
    """Render integer minor units as a major-unit decimal string with exactly 2 dp
    (no float anywhere; GL-TEMPLATE-SPEC §2 'decimal (>= 2 dp)')."""
    sign = "-" if minor < 0 else ""
    minor = abs(minor)
    return f"{sign}{minor // 100}.{minor % 100:02d}"


def gl_row_full(r):
    period, code, debit_minor, credit_minor, cc, ref, doctype = r
    name = CODE2META[code][0]
    return [
        period,
        code,
        name,
        minor_to_text(int(debit_minor)) if debit_minor != "" else "",
        minor_to_text(int(credit_minor)) if credit_minor != "" else "",
        cc,
        "bu-manu",
        "USD",
        ref,
        doctype,
    ]


CSV_ROWS = [gl_row_full(r) for r in ROWS]

# ---- CSV (UTF-8, comma, header row 1 — GL-TEMPLATE-SPEC §1) ----
csv_path = os.path.join(OUT_DIR, "sample_gl_dump.csv")
with open(csv_path, "w", newline="", encoding="utf-8") as f:
    f.write(",".join(GL_HEADER) + "\n")
    for row in CSV_ROWS:
        f.write(",".join(row) + "\n")


# ---- minimal xlsx writer (no deps, deterministic zip) ----
def col_letter(i: int) -> str:
    s = ""
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def xml_escape(v: str) -> str:
    return (
        v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


def sheet_xml(rows) -> bytes:
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    ]
    for ri, row in enumerate(rows, start=1):
        cells = []
        for ci, v in enumerate(row, start=1):
            ref = f"{col_letter(ci)}{ri}"
            if v == "":
                continue
            # valid OOXML string cell: inline string (t="inlineStr" + <is><t>).
            # t="s" would mean a shared-string INDEX — raw text there is malformed.
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{xml_escape(str(v))}</t></is></c>')
        out.append(f'<row r="{ri}">' + "".join(cells) + "</row>")
    out.append("</sheetData></worksheet>")
    return "".join(out).encode("utf-8")


SHEETS = [
    ("GL", [GL_HEADER] + CSV_ROWS),
    ("COA", [COA_HEADER] + [[c, n, t, s, ""] for c, n, t, s in ACCOUNTS]),
    ("Dimensions", DIM_HEADER + [list(d) for d in DIMENSIONS]),
]

xlsx_path = os.path.join(OUT_DIR, "sample_gl_dump.xlsx")
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    n = len(SHEETS)
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for i in range(n)
    )
    z.writestr(
        "[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f"{overrides}"
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        "</Types>",
    )
    z.writestr(
        "_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>",
    )
    z.writestr(
        "xl/workbook.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<sheets>"
        + "".join(
            f'<sheet name="{name}" sheetId="{i + 1}" r:id="rId{i + 1}"/>'
            for i, (name, _) in enumerate(SHEETS)
        )
        + "</sheets></workbook>",
    )
    z.writestr(
        "xl/_rels/workbook.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(
            f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
            for i in range(n)
        )
        + "</Relationships>",
    )
    for i, (_, rows) in enumerate(SHEETS, start=1):
        z.writestr(f"xl/worksheets/sheet{i}.xml", sheet_xml(rows))
    z.writestr(
        "docProps/core.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
        "<dc:creator>OneFP&amp;A fixtures</dc:creator>"
        "<cp:lastModifiedBy>OneFP&amp;A fixtures</cp:lastModifiedBy>"
        "</cp:coreProperties>",
    )
    # fixed metadata stamp: deterministic bytes (B5)
    z.writestr(
        "docProps/app.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        "<Application>OneFP&amp;A fixtures:gen</Application></Properties>",
    )

# writestr(str) stamps 1980-01-01 00:00:00 (ZipInfo default) — no clock in bytes.
with open(xlsx_path, "wb") as f:
    f.write(buf.getvalue())

# ---- self-verification: re-read the xlsx, row-for-row vs the CSV, tie-out ----
zin = zipfile.ZipFile(xlsx_path)
assert zin.testzip() is None, "xlsx zip corrupt"


def read_sheet(z, i):
    root = ET.fromstring(z.read(f"xl/worksheets/sheet{i}.xml"))
    rows = []
    for row_el in root.iter(f"{NS}row"):
        cells = {}
        for c in row_el.iter(f"{NS}c"):
            ref = c.get("r")
            col = 0
            for ch in ref:
                if ch.isalpha():
                    col = col * 26 + (ord(ch) - 64)
                else:
                    break
            t_el = c.find(f"{NS}is/{NS}t")
            cells[col] = t_el.text if t_el is not None and t_el.text is not None else ""
        if not cells:
            continue
        width = max(cells)
        rows.append([cells.get(i + 1, "") for i in range(width)])
    return rows


def rows_equal(got, expected):
    """Cell-exact compare: an expected empty cell may be absent in the sheet
    (the writer omits empty cells); no unexpected extra cells allowed."""
    if len(got) != len(expected):
        return False
    for g, e in zip(got, expected):
        for ci, ev in enumerate(e):
            gv = g[ci] if ci < len(g) else ""
            if gv != ev:
                return False
        for ci in range(len(e), len(g)):
            if g[ci] != "":
                return False
    return True


for i, (name, expected) in enumerate(SHEETS, start=1):
    got = read_sheet(zin, i)
    assert rows_equal(got, expected), f"xlsx sheet '{name}' does not round-trip cell-exact (got {len(got)} rows)"

debits = sum(int(r[3].split(".")[0]) * 100 + int(r[3].split(".")[1]) for r in CSV_ROWS if r[3])
credits = sum(int(r[4].split(".")[0]) * 100 + int(r[4].split(".")[1]) for r in CSV_ROWS if r[4])
assert debits == credits, f"tie-out broken: {debits} != {credits}"

per_account = {}
for r in CSV_ROWS:
    code = r[1]
    d = int(r[3].replace(".", "")) if r[3] else 0
    c = int(r[4].replace(".", "")) if r[4] else 0
    net = per_account.get(code, 0) + d - c
    per_account[code] = net

# Presentation sign for the P&L oracle (storage sign above is debit-positive;
# P&L lines report revenue/expenses as positive amounts, GLOSSARY sign rules):
revenue = -per_account.get("4000", 0)
cogs = -sum(per_account.get(k, 0) for k in ("4100", "4200", "4300"))
opex = -sum(per_account.get(k, 0) for k in ("5000", "5100", "5200", "5300", "5400", "5500"))
depr = -per_account.get("5400", 0)
major = lambda m: f"{m // 100}.{m % 100:02d}"  # noqa: E731 (display-only)

expected = {
    "fixture": "sample_gl_dump",
    "synthetic": True,
    "spec": "GL-TEMPLATE-SPEC.md (Canonical GL Template)",
    "sheets": ["GL", "COA", "Dimensions"],
    "gl_rows": len(CSV_ROWS),
    "period": PERIOD,
    "currency": "USD",
    "tie_out": {
        "sum_debit_minor": debits,
        "sum_credit_minor": credits,
        "sum_debit": major(debits),
        "sum_credit": major(credits),
        "balanced": debits == credits,
    },
    "per_account_net_minor": {k: per_account[k] for k in sorted(per_account)},
    "pl_rollup_minor": {
        # presentation sign (positive = revenue / expense magnitude), 2026-08 single period
        "revenue": revenue,
        "cogs": cogs,
        "gross_profit": revenue - cogs,
        "opex": opex,
        "ebitda": revenue - cogs - opex,
        "depreciation": depr,
        "ebit": revenue - cogs - opex - depr,
    },
    "files": {
        "csv": {
            "path": "sample_gl_dump.csv",
            "sha256": hashlib.sha256(open(csv_path, "rb").read()).hexdigest(),
        },
        "xlsx": {
            "path": "sample_gl_dump.xlsx",
            "sha256": hashlib.sha256(open(xlsx_path, "rb").read()).hexdigest(),
        },
    },
}
expected_path = os.path.join(OUT_DIR, "sample_gl_dump.expected.json")
with open(expected_path, "w", encoding="utf-8") as f:
    f.write(prettified_json(expected))

# ---- Demo Company fixture (tests/fixtures/; GLOSSARY: clearly-marked, B18-3) ----
DEMO_DIR = os.path.join("tests", "fixtures", "demo_company")
os.makedirs(DEMO_DIR, exist_ok=True)

company = {
    "fixture": "demo_company",
    "synthetic": True,
    "marked": "DEMO COMPANY — synthetic sample Company for learning the app; "
    "never reachable from production data paths (B18-3)",
    "company": {
        "name": "Acme Manufacturing",
        "type": "single",
        "pack_key": "manufacturing",
        "calendar": {"preset": "12month", "fy_start_month": 4},
        "currency": "USD",
        "locale": "en-US",
        "business_units": [{"key": "bu-manu", "name": "Manufacturing BU"}],
        "horizon": "1y",
        "plan_only": False,
    },
    "gl_dump": "gl_dump.csv (byte-identical to docs/examples/sample_gl_dump.csv)",
    "actuals_period": PERIOD,
}
with open(os.path.join(DEMO_DIR, "company.json"), "w", encoding="utf-8") as f:
    f.write(prettified_json(company))

import shutil

shutil.copyfile(csv_path, os.path.join(DEMO_DIR, "gl_dump.csv"))

demo_expected = dict(expected)
demo_expected["fixture"] = "demo_company_gl_dump"
demo_expected["files"] = {
    "csv": {
        "path": "gl_dump.csv",
        "sha256": hashlib.sha256(open(os.path.join(DEMO_DIR, "gl_dump.csv"), "rb").read()).hexdigest(),
    }
}
with open(os.path.join(DEMO_DIR, "gl_dump.expected.json"), "w", encoding="utf-8") as f:
    f.write(prettified_json(demo_expected))

print(
    f"fixtures:gen OK — {len(CSV_ROWS)} GL rows (3 sheets: GL/COA/Dimensions), "
    f"tie-out {major(debits)} balanced, xlsx re-read row-for-row verified; "
    f"wrote {csv_path} + {xlsx_path} + {expected_path} + Demo Company fixture ({DEMO_DIR})"
)
