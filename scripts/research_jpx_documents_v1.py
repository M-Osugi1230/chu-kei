#!/usr/bin/env python3
"""Build reviewable structured-data candidates from official JPX disclosures.

This script never mutates company records and never approves or promotes companies.
It only creates evidence-backed candidates for an explicitly selected research batch.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import re
import time
import unicodedata
import urllib.parse
import zlib
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

ROOT = Path.cwd()
DATA_DIR = ROOT / "site" / "data"
SEARCH_URL = "https://www2.jpx.co.jp/tseHpFront/JJK010010Action.do"
DETAIL_URL = "https://www2.jpx.co.jp/tseHpFront/JJK010030Action.do"
USER_AGENT = "Chu-keiSourceResearch/1.0 (+https://github.com/M-Osugi1230/chu-kei)"
TIMEOUT = 35
MAX_PDF_BYTES = 32 * 1024 * 1024
MAX_PAGES = 100

NEGATIVE_TITLE = re.compile(
    r"招集通知|株主総会|定款|自己株式の取得状況|人事異動|大量保有|月次|決議通知|議決権|有価証券報告書|四半期報告書"
)

TITLE_RULES: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"中期経営計画|中長期経営計画|長期経営計画"), 130),
    (re.compile(r"事業計画及び成長可能性|事業計画と成長可能性"), 125),
    (re.compile(r"経営計画|経営戦略|成長戦略|経営方針|企業価値向上"), 105),
    (re.compile(r"決算説明資料|決算補足資料|決算説明会"), 85),
    (re.compile(r"統合報告書|統合レポート"), 75),
    (re.compile(r"決算短信"), 55),
]

THEME_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("M&A", re.compile(r"M&A|Ｍ＆Ａ|買収|事業承継")),
    ("資本効率", re.compile(r"ROE|ROIC|資本効率|資本コスト|PBR")),
    ("株主還元", re.compile(r"株主還元|配当|自己株式|総還元|DOE")),
    ("海外", re.compile(r"海外|グローバル|北米|欧州|中国|アジア")),
    ("DX", re.compile(r"DX|デジタル|クラウド|データ活用|システム刷新")),
    ("AI", re.compile(r"AI|人工知能|生成AI|機械学習")),
    ("人的資本", re.compile(r"人的資本|人材|人財|採用|育成|エンゲージメント")),
    ("新規事業", re.compile(r"新規事業|新領域|新市場|インキュベーション")),
    ("事業再編", re.compile(r"構造改革|事業再編|ポートフォリオ|選択と集中|収益改善")),
    ("研究開発", re.compile(r"研究開発|R&D|技術開発|知的財産")),
    ("設備投資", re.compile(r"設備投資|成長投資|投資計画|生産能力")),
    ("サステナビリティ", re.compile(r"サステナ|脱炭素|環境|ESG|GX")),
    ("顧客基盤", re.compile(r"顧客基盤|会員|契約数|店舗網|販売網")),
    ("生産性", re.compile(r"生産性|効率化|省人化|自動化|コスト削減")),
]

METRIC_RULES = {
    "revenue": ("売上高", re.compile(r"売上高|売上収益|営業収益|取扱高")),
    "profit": ("利益", re.compile(r"営業利益|事業利益|経常利益|純利益|EBITDA")),
    "margin": ("収益性・資本効率", re.compile(r"利益率|ROE|ROIC|DOE|PBR|マージン")),
    "capital": ("投資・資本配分", re.compile(r"成長投資|設備投資|研究開発投資|投資額|キャッシュアロケーション")),
    "returnPolicy": ("株主還元", re.compile(r"株主還元|配当性向|総還元性向|自己株式|累進配当|DOE")),
}

TARGET_PATTERN = re.compile(r"目標|計画|目指|見通し|方針|以上|程度|水準")
ACTUAL_PATTERN = re.compile(r"実績|結果|達成|進捗")
NUMBER_PATTERN = re.compile(r"(?:20\d{2}年(?:度|\d{1,2}月期)?|\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:億円|百万円|兆円|%|％|倍|店|人))")
PERIOD_PATTERNS = [
    re.compile(r"(20\d{2}年(?:度|\d{1,2}月期)?)[^\n]{0,18}(?:から|～|〜|-)[^\n]{0,18}(20\d{2}年(?:度|\d{1,2}月期)?)"),
    re.compile(r"(20\d{2}年度)[^\n]{0,18}(20\d{2}年度)"),
]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = value.replace("\u3000", " ")
    return re.sub(r"\s+", " ", value).strip()


def normalize_name(value: str) -> str:
    value = normalize_text(value)
    value = re.sub(r"株式会社|有限会社|ホールディングス|ホールディング|グループ|HD|GROUP", "", value, flags=re.I)
    return re.sub(r"[^0-9A-Za-z一-龥ぁ-んァ-ン]", "", value).lower()


def read_bundle() -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = read_json(DATA_DIR / "bundle.manifest.json")
    compressed = b"".join((DATA_DIR / part["file"]).read_bytes() for part in manifest["parts"])
    digest = hashlib.sha256(compressed).hexdigest()
    if digest != manifest["sha256"]:
        raise RuntimeError(f"Bundle SHA-256 mismatch: {digest}")
    return manifest, json.loads(zlib.decompress(compressed, 16 + zlib.MAX_WBITS).decode("utf-8"))


def parse_date(value: str) -> str | None:
    value = normalize_text(value)
    match = re.search(r"(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?", value)
    if not match:
        return None
    return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"


def score_company(company: dict[str, Any]) -> int:
    market_score = {"Prime": 30, "Growth": 24, "Standard": 18}.get(company.get("market"), 10)
    industry = str(company.get("industry") or "")
    industry_score = 0
    for pattern, score in [
        (r"情報・通信|電気機器|機械|精密機器", 20),
        (r"サービス|医薬品|化学|輸送用機器", 18),
        (r"銀行|証券|保険|その他金融|不動産|卸売", 16),
        (r"小売|建設|陸運|海運|空運|倉庫", 14),
        (r"食料品|金属|鉄鋼|非鉄", 12),
    ]:
        if re.search(pattern, industry):
            industry_score = score
            break
    group_bonus = 8 if re.search(r"ホールディングス|グループ|HD", str(company.get("name") or ""), re.I) else 0
    return market_score + industry_score + group_bonus


def session_cookie(response: requests.Response) -> str:
    cookies = response.cookies.get_dict()
    return "; ".join(f"{key}={value}" for key, value in cookies.items())


def get_hidden(soup: BeautifulSoup, name: str, default: str = "") -> str:
    element = soup.select_one(f'input[name="{name}"]')
    return str(element.get("value", default)) if element else default


def fetch_jpx_detail(code: str) -> tuple[BeautifulSoup, list[dict[str, Any]]]:
    manager_code = f"{code}0"
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.7"}
    session = requests.Session()
    session.headers.update(headers)
    session.get(SEARCH_URL, timeout=TIMEOUT)
    payload = {
        "ListShow": "ListShow",
        "sniMtGmnId": "",
        "dspSsuPd": "10",
        "dspSsuPdMapOut": "10>10件<50>50件<100>100件<200>200件<",
        "mgrMiTxtBx": "",
        "eqMgrCd": manager_code,
        "szkbuChkbxMapOut": "011>プライム<012>スタンダード<013>グロース<008>TOKYO PRO Market<bj1>-<be1>-<111>外国株プライム<112>外国株スタンダード<113>外国株グロース<bj2>-<be2>-<ETF>ETF<ETN>ETN<RET>不動産投資信託(REIT)<IFD>インフラファンド<999>その他<",
    }
    search_response = session.post(SEARCH_URL, data=payload, timeout=TIMEOUT)
    search_response.raise_for_status()
    search_soup = BeautifulSoup(search_response.content, "html.parser")
    result_code = get_hidden(search_soup, "ccJjCrpSelKekkLst_st[0].eqMgrCd")
    if result_code != manager_code:
        raise RuntimeError(f"JPX search mismatch: {result_code or 'none'} != {manager_code}")

    detail_payload = {
        "BaseJh": get_hidden(search_soup, "BaseJh"),
        "lstDspPg": get_hidden(search_soup, "lstDspPg"),
        "dspGs": get_hidden(search_soup, "dspGs"),
        "souKnsu": get_hidden(search_soup, "souKnsu"),
        "sniMtGmnId": get_hidden(search_soup, "sniMtGmnId"),
        "dspJnKbn": get_hidden(search_soup, "dspJnKbn"),
        "dspJnKmkNo": get_hidden(search_soup, "dspJnKmkNo"),
        "mgrCd": manager_code,
        "jjHisiFlg": get_hidden(search_soup, "jjHisiFlg"),
        "ccJjCrpSelKekkLst_st[0].eqMgrCd": result_code,
        "ccJjCrpSelKekkLst_st[0].eqMgrNm": get_hidden(search_soup, "ccJjCrpSelKekkLst_st[0].eqMgrNm"),
        "ccJjCrpSelKekkLst_st[0].szkbuNm": get_hidden(search_soup, "ccJjCrpSelKekkLst_st[0].szkbuNm"),
        "ccJjCrpSelKekkLst_st[0].gyshDspNm": get_hidden(search_soup, "ccJjCrpSelKekkLst_st[0].gyshDspNm"),
        "ccJjCrpSelKekkLst_st[0].dspYuKssnKi": get_hidden(search_soup, "ccJjCrpSelKekkLst_st[0].dspYuKssnKi"),
    }
    detail_response = session.post(DETAIL_URL, data=detail_payload, timeout=TIMEOUT)
    detail_response.raise_for_status()
    detail_soup = BeautifulSoup(detail_response.content, "html.parser")

    documents: list[dict[str, Any]] = []
    for table in detail_soup.select('table[id*="KaiJi"], table[id*="Kaiji"], table[id*="Fili"]'):
        table_id = str(table.get("id") or "")
        if "open" in table_id.lower():
            continue
        for row in table.select("tr[id]"):
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            anchor = cells[1].find("a", href=True)
            if not anchor:
                continue
            title = normalize_text(anchor.get_text(" ", strip=True))
            href = urllib.parse.urljoin("https://www2.jpx.co.jp", str(anchor.get("href")))
            date_text = normalize_text(cells[0].get_text(" ", strip=True))
            documents.append({
                "date": parse_date(date_text),
                "dateText": date_text,
                "title": title,
                "url": href,
                "tableId": table_id,
            })

    if not documents:
        for anchor in detail_soup.find_all("a", href=True):
            title = normalize_text(anchor.get_text(" ", strip=True))
            href = urllib.parse.urljoin("https://www2.jpx.co.jp", str(anchor.get("href")))
            if not re.search(r"\.pdf(?:$|[?#])", href, re.I):
                continue
            parent = anchor.find_parent("tr")
            date_text = normalize_text(parent.get_text(" ", strip=True) if parent else "")
            documents.append({"date": parse_date(date_text), "dateText": date_text, "title": title, "url": href, "tableId": "fallback"})

    return detail_soup, documents


def score_document(document: dict[str, Any]) -> int:
    title = normalize_text(document.get("title") or "")
    if NEGATIVE_TITLE.search(title):
        return -100
    score = 0
    for pattern, weight in TITLE_RULES:
        if pattern.search(title):
            score = max(score, weight)
    if document.get("date"):
        year = int(document["date"][:4])
        score += max(0, year - 2022) * 6
    if re.search(r"\.pdf(?:$|[?#])", str(document.get("url") or ""), re.I):
        score += 15
    if "www2.jpx.co.jp/disc/" in str(document.get("url") or ""):
        score += 10
    return score


def select_document(documents: list[dict[str, Any]]) -> dict[str, Any] | None:
    ranked = [{**row, "score": score_document(row)} for row in documents]
    ranked = [row for row in ranked if row["score"] >= 55]
    ranked.sort(key=lambda row: (row["score"], row.get("date") or "", row.get("title") or ""), reverse=True)
    return ranked[0] if ranked else None


def extract_pdf(session: requests.Session, url: str) -> tuple[list[str], int]:
    response = session.get(url, timeout=TIMEOUT, stream=True)
    response.raise_for_status()
    content = response.content
    if len(content) > MAX_PDF_BYTES:
        raise RuntimeError(f"PDF too large: {len(content)}")
    if not content.startswith(b"%PDF"):
        raise RuntimeError("PDF signature missing")
    reader = PdfReader(io.BytesIO(content), strict=False)
    pages: list[str] = []
    for page in reader.pages[:MAX_PAGES]:
        try:
            pages.append(normalize_text(page.extract_text() or ""))
        except Exception:
            pages.append("")
    return pages, len(content)


def page_score(text: str) -> int:
    score = 0
    for pattern, weight in [
        (re.compile(r"中期経営計画|長期経営計画|成長戦略|経営方針"), 25),
        (re.compile(r"売上高|営業利益|経常利益|ROE|ROIC"), 20),
        (re.compile(r"目標|計画|実績|進捗"), 15),
        (re.compile(r"成長投資|株主還元|配当"), 12),
    ]:
        if pattern.search(text):
            score += weight
    score += min(20, len(NUMBER_PATTERN.findall(text)) * 2)
    return score


def find_period(pages: list[str]) -> str:
    text = "\n".join(pages[:20])
    for pattern in PERIOD_PATTERNS:
        match = pattern.search(text)
        if match:
            return f"{match.group(1)}～{match.group(2)}"
    years = sorted(set(re.findall(r"20\d{2}年度", text)))
    if len(years) >= 2:
        return f"{years[0]}～{years[-1]}"
    return "最新公式開示資料の対象期間"


def metric_value(pages: list[str], key: str) -> tuple[str, int | None, bool, bool]:
    label, pattern = METRIC_RULES[key]
    best: tuple[int, str, list[str], bool, bool] | None = None
    for index, text in enumerate(pages):
        if not text or not pattern.search(text):
            continue
        target = bool(TARGET_PATTERN.search(text))
        actual = bool(ACTUAL_PATTERN.search(text))
        numbers = NUMBER_PATTERN.findall(text)
        score = (20 if target else 0) + (12 if actual else 0) + min(15, len(numbers) * 3) + page_score(text)
        if best is None or score > best[0]:
            best = (score, text, numbers, target, actual)
            best_index = index
    if best is None:
        return f"固定の中期{label}目標は当該公式資料の抽出範囲で確認できない。", None, False, False
    numbers = list(dict.fromkeys(best[2]))[:4]
    number_note = f"（{'、'.join(numbers)}）" if numbers else ""
    return f"公式PDF p.{best_index + 1}で{label}に関する数値・方針{number_note}を確認。詳細は原文の定義を参照する。", best_index + 1, best[3], best[4]


def build_candidate(company: dict[str, Any], document: dict[str, Any], pages: list[str], pdf_bytes: int) -> dict[str, Any]:
    full_text = "\n".join(pages)
    theme_counts = [(name, len(pattern.findall(full_text))) for name, pattern in THEME_RULES]
    themes = [name for name, count in sorted(theme_counts, key=lambda row: (-row[1], row[0])) if count > 0][:8]

    metric_results = {key: metric_value(pages, key) for key in METRIC_RULES}
    evidence_pages: list[tuple[int, str]] = []
    ranked_pages = sorted(((page_score(text), index + 1, text) for index, text in enumerate(pages) if text), reverse=True)
    for _, page_number, text in ranked_pages:
        descriptors = []
        if re.search(r"中期経営計画|長期経営計画|成長戦略|経営方針", text):
            descriptors.append("計画・成長戦略")
        if re.search(r"売上高|営業利益|ROE|ROIC|目標", text):
            descriptors.append("財務目標・KPI")
        if re.search(r"成長投資|株主還元|配当", text):
            descriptors.append("投資・株主還元")
        if not descriptors:
            continue
        evidence_pages.append((page_number, "・".join(descriptors)))
        if len({page for page, _ in evidence_pages}) >= 3:
            break
    unique_evidence = []
    seen_pages: set[int] = set()
    for page_number, description in evidence_pages:
        if page_number in seen_pages:
            continue
        seen_pages.add(page_number)
        unique_evidence.append(f"公式PDF p.{page_number}: {description}に関する記載を確認する。")
    if len(unique_evidence) < 2:
        for _, page_number, _ in ranked_pages[:3]:
            if page_number not in seen_pages:
                unique_evidence.append(f"公式PDF p.{page_number}: 主要な事業方針・数値記載を確認する。")
                seen_pages.add(page_number)
            if len(unique_evidence) >= 2:
                break

    target_pages = [result for result in metric_results.values() if result[2]]
    actual_pages = [result for result in metric_results.values() if result[3]]
    if target_pages and actual_pages:
        assessment_status = "connected"
        assessment_reason = "公式PDF内で固定目標と実績・進捗に関する記載を確認できる。数値比較時は対象年度、単位、連結範囲を原文で再確認する。"
    elif target_pages:
        assessment_status = "not_comparable"
        assessment_reason = "公式PDFで目標・計画は確認できるが、同一定義の確定実績を安全に接続できないため、単純な進捗率を作成しない。"
    else:
        assessment_status = "not_disclosed"
        assessment_reason = "当該公式資料の抽出範囲では固定中期財務目標を確認できないため、推計値や架空の進捗率を補完しない。"

    flags = {
        "ma": "M&A" in themes,
        "capitalEfficiency": "資本効率" in themes,
        "shareholderReturn": "株主還元" in themes,
        "progress": False,
        "overseas": "海外" in themes,
        "dx": "DX" in themes or "AI" in themes,
        "humanCapital": "人的資本" in themes,
        "newBusiness": "新規事業" in themes,
        "restructuring": "事業再編" in themes,
    }

    normalized_name = normalize_name(company["name"])
    identity_text = normalize_name(" ".join(pages[:8]))
    identity_match = bool(normalized_name and normalized_name[:5] in identity_text) or str(company["code"]) in " ".join(pages[:8])
    confidence = 25  # JPX code-specific disclosure linkage
    confidence += 15 if document.get("date") else 0
    confidence += 20 if len(unique_evidence) >= 2 else 0
    confidence += 15 if len(themes) >= 4 else (8 if len(themes) >= 2 else 0)
    confidence += 15 if sum(result[1] is not None for result in metric_results.values()) >= 2 else 0
    confidence += 10 if identity_match else 5

    top_themes = themes[:4] or [company.get("industry") or "事業戦略"]
    summary = f"公式開示資料では、{'、'.join(top_themes)}を主要論点として示し、事業基盤と企業価値の向上に向けた施策を進める。"
    highlights = [
        f"{document['title']}を{document.get('date') or '公表日確認対象'}に公表した。",
        f"公式資料では{'、'.join(top_themes[:3])}を主要テーマとして示す。",
    ]
    metric_highlight = next((value for value, page, _, _ in metric_results.values() if page is not None), None)
    if metric_highlight:
        highlights.append(metric_highlight)

    warnings = [
        "目標値、確定実績、会社予想の区分は、原文の対象年度・単位・連結範囲を確認する。",
        "計画改定や後発開示の有無を最新の公式資料で確認し、古い数値を最新目標として扱わない。",
    ]

    record = {
        "code": str(company["code"]),
        "name": company["name"],
        "category": f"{company.get('industry') or '業種未確認'}/公式開示資料",
        "sourceUrl": document["url"],
        "document": document["title"],
        "period": find_period(pages),
        "planPublishedDate": document["date"],
        "themes": top_themes,
        "summary": summary,
        "revenue": metric_results["revenue"][0],
        "profit": metric_results["profit"][0],
        "margin": metric_results["margin"][0],
        "capital": metric_results["capital"][0],
        "returnPolicy": metric_results["returnPolicy"][0],
        "highlights": highlights,
        "warnings": warnings,
        "evidenceRefs": unique_evidence[:3],
        "flags": flags,
        "progressAssessment": {
            "status": assessment_status,
            "reason": assessment_reason,
            "sourceRef": unique_evidence[0] if unique_evidence else f"公式資料: {document['url']}",
        },
    }
    return {
        "code": str(company["code"]),
        "name": company["name"],
        "market": company.get("market"),
        "industry": company.get("industry"),
        "status": "eligible" if confidence >= 80 and len(unique_evidence) >= 2 and document.get("date") else "needs_review",
        "confidence": confidence,
        "identityMatch": identity_match,
        "pdfBytes": pdf_bytes,
        "pageCount": len(pages),
        "document": document,
        "record": record,
    }


def research_company(company: dict[str, Any]) -> dict[str, Any]:
    started = time.time()
    try:
        _, documents = fetch_jpx_detail(str(company["code"]))
        document = select_document(documents)
        if not document:
            return {"code": str(company["code"]), "name": company["name"], "status": "no_candidate_document", "documentCount": len(documents)}
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.7"})
        pages, pdf_bytes = extract_pdf(session, document["url"])
        if sum(len(page) for page in pages) < 500:
            return {"code": str(company["code"]), "name": company["name"], "status": "pdf_text_insufficient", "document": document}
        result = build_candidate(company, document, pages, pdf_bytes)
        result["elapsedSeconds"] = round(time.time() - started, 2)
        result["documentCount"] = len(documents)
        return result
    except Exception as error:  # noqa: BLE001
        return {
            "code": str(company["code"]),
            "name": company["name"],
            "status": "error",
            "error": f"{type(error).__name__}: {error}"[:500],
            "elapsedSeconds": round(time.time() - started, 2),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config_path = ROOT / args.config
    config = read_json(config_path)
    if config.get("schemaVersion") != "source-research-batch-v1":
        raise RuntimeError(f"Unsupported config schema: {config.get('schemaVersion')}")

    manifest, bundle = read_bundle()
    company_by_code = {str(row["code"]): row for row in bundle["companies"]}
    explicit_codes = [str(code) for code in config.get("codes", [])]
    if explicit_codes:
        selected = [company_by_code[code] for code in explicit_codes if code in company_by_code]
    else:
        eligible = [row for row in bundle["companies"] if row.get("stage") == "jpx_indexed"]
        eligible.sort(key=lambda row: (-score_company(row), str(row["code"])))
        excluded = set(str(code) for code in config.get("excludeCodes", []))
        selected = [row for row in eligible if str(row["code"]) not in excluded][: int(config.get("batchSize", 100))]

    if not selected:
        raise RuntimeError("No companies selected for source research")

    workers = max(1, min(int(config.get("concurrency", 8)), 12))
    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {executor.submit(research_company, company): company for company in selected}
        for index, future in enumerate(concurrent.futures.as_completed(future_map), start=1):
            result = future.result()
            results.append(result)
            print(f"{index}/{len(selected)} {result['code']} {result['status']}", flush=True)

    results.sort(key=lambda row: str(row["code"]))
    eligible_results = [row for row in results if row.get("status") == "eligible"]
    output_path = ROOT / config.get("outputPath", f"operations/source-research/{config['batchId']}-candidates.json")
    output = {
        "schemaVersion": "source-research-candidates-v1",
        "batchId": config["batchId"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceBundleSha256": manifest["sha256"],
        "automaticFactCompletion": False,
        "automaticApproval": False,
        "selectedCount": len(selected),
        "eligibleCount": len(eligible_results),
        "needsReviewCount": len([row for row in results if row.get("status") == "needs_review"]),
        "failureCount": len([row for row in results if row.get("status") not in {"eligible", "needs_review"}]),
        "selectedCodes": [str(row["code"]) for row in selected],
        "eligibleCodes": [row["code"] for row in eligible_results],
        "results": results,
    }
    write_json(output_path, output)
    print(json.dumps({key: output[key] for key in ["batchId", "selectedCount", "eligibleCount", "needsReviewCount", "failureCount"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
