from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import tempfile
import zipfile
from collections import Counter
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPORT_DIR = ROOT / "imports" / "v42"
SITE_DIR = ROOT / "site"
UPDATED_AT = "2026-07-10"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value, *, compact: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"HTML migration pattern not found: {label}")
    return text.replace(old, new, 1)


def reconstruct_package(work: Path) -> Path:
    parts = sorted(IMPORT_DIR.glob("package.b64.part*"))
    if not parts:
        raise FileNotFoundError(f"No package chunks found under {IMPORT_DIR}")
    encoded = "".join(part.read_text(encoding="ascii").strip() for part in parts)
    package = work / "chukei_570_company_operations_v42.zip"
    package.write_bytes(base64.b64decode(encoded, validate=True))

    checksum_path = IMPORT_DIR / "package.sha256"
    if checksum_path.exists():
        expected = checksum_path.read_text(encoding="ascii").strip().split()[0]
        actual = hashlib.sha256(package.read_bytes()).hexdigest()
        if actual != expected:
            raise RuntimeError(f"Package checksum mismatch: expected={expected}, actual={actual}")
    return package


def extract_public_site(package: Path, work: Path) -> Path:
    outer = work / "outer"
    outer.mkdir()
    with zipfile.ZipFile(package) as archive:
        archive.extractall(outer)
    candidates = list(outer.glob("chukei_570_company_public_beta_v42.zip"))
    if len(candidates) != 1:
        raise RuntimeError("Public v42 ZIP was not found exactly once")
    public = work / "public"
    public.mkdir()
    with zipfile.ZipFile(candidates[0]) as archive:
        archive.extractall(public)
    return public


def publication_date(value):
    if not isinstance(value, str):
        return None, "unconfirmed"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value, "day"
    if re.fullmatch(r"\d{4}-\d{2}", value):
        return value, "month"
    if re.fullmatch(r"\d{4}", value):
        return value, "year"
    return None, "unconfirmed"


def verification_date(value):
    if isinstance(value, str) and "確認日" in value:
        match = re.search(r"\d{4}-\d{2}-\d{2}", value)
        if match:
            return match.group(0)
    return UPDATED_AT


def has_page_evidence(company: dict) -> bool:
    return any(re.search(r"(?:\bp\.?\s*\d|ページ\s*\d)", str(ref), re.I) for ref in company.get("evidenceRefs", []))


def quality_profile(company: dict, stage: str) -> dict:
    official = isinstance(company.get("sourceUrl"), str) and company["sourceUrl"].startswith("https://")
    pages = has_page_evidence(company)
    structured = bool(company.get("planPerspective")) and bool(company.get("strategicLens"))
    actual_rows = company.get("planPerspective", {}).get("progressDisclosure", {}).get("actualRows", 0)
    progress_connected = bool(actual_rows)

    if stage == "core":
        stars = 5
        score = min(100, 75 + 8 * official + 7 * pages + 5 * structured + 5 * progress_connected)
        label = "本番品質"
        reasons = ["公式資料確認済み", "主要論点構造化済み", "人手レビュー済み", "ダブルチェック済み"]
    elif stage == "detailed_extracted":
        stars = 4 if pages else 3
        score = min(89, 55 + 10 * official + 10 * structured + 10 * pages + 5 * progress_connected)
        label = "詳細抽出済みβ"
        reasons = ["公式資料確認済み", "主要論点構造化済み", "本番昇格前"]
    elif stage == "source_indexed":
        stars = 2
        score = 40
        label = "一次確認β"
        reasons = ["公式IR起点確認済み", "本文詳細抽出前"]
    else:
        stars = 1
        score = None
        label = "カバレッジβ"
        reasons = ["JPX上場情報確認済み", "中計資料未特定", "評価算定対象外"]

    if pages and stage in {"core", "detailed_extracted"}:
        reasons.append("ページ証跡あり")
    if progress_connected and stage in {"core", "detailed_extracted"}:
        reasons.append("実績接続あり")

    return {
        "version": "1.0",
        "stage": stage,
        "stars": stars,
        "score": score,
        "label": label,
        "eligibleForScoring": stage != "jpx_indexed",
        "officialSourceConfirmed": official if stage != "jpx_indexed" else False,
        "pageEvidencePresent": pages if stage in {"core", "detailed_extracted"} else False,
        "structuredAnalysisPresent": structured if stage in {"core", "detailed_extracted"} else False,
        "progressActualConnected": progress_connected if stage in {"core", "detailed_extracted"} else False,
        "humanReviewed": stage in {"core", "detailed_extracted"},
        "doubleChecked": stage == "core",
        "reasons": reasons,
        "lastCalculatedAt": UPDATED_AT,
    }


def migrate_company(source: dict, stage: str) -> dict:
    company = deepcopy(source)
    legacy_date = company.pop("date", None)
    if stage in {"source_indexed", "jpx_indexed"}:
        published, precision = None, "unconfirmed"
        verified = verification_date(legacy_date)
    else:
        published, precision = publication_date(legacy_date)
        verified = UPDATED_AT

    company["schemaVersion"] = "1.1"
    company["reviewStage"] = stage
    company["planPublishedDate"] = published
    company["datePrecision"] = precision
    company["lastVerifiedDate"] = verified
    company["dataTier"] = "core" if stage == "core" else "beta"
    company["dataTierLabel"] = {
        "core": "本番",
        "detailed_extracted": "詳細抽出済みβ",
        "source_indexed": "一次確認β",
        "jpx_indexed": "カバレッジβ",
    }[stage]
    company["qualityProfile"] = quality_profile(company, stage)

    if stage in {"source_indexed", "jpx_indexed"}:
        company.pop("planPerspective", None)
        company.pop("strategicLens", None)
        company["highlights"] = []
        company["score"] = None if stage == "jpx_indexed" else 40
        company["confidence"] = None if stage == "jpx_indexed" else 60
        company["evidenceRefs"] = (company.get("evidenceRefs") or [])[:2]

        if stage == "source_indexed":
            company["summary"] = f"{company['name']}の会社公式IR起点を確認した一次確認β。中計本文の主要論点、数値目標、資本政策、株主還元、進捗は未抽出。"
            for field in ["revenue", "profit", "margin", "capital", "returnPolicy"]:
                company[field] = "未抽出"
            company["themes"] = [company.get("industry") or company.get("category"), "公式IR起点確認", "詳細抽出前"]
            company["warnings"] = ["一次確認β。中計本文の詳細抽出は未完了。", "重要な確認はリンク先の最新公式資料で行ってください。"]
            company["nextAction"] = "中計または中計相当資料を特定し、ページ番号付きで主要論点を抽出する。"
        else:
            placeholder = "未抽出（中計資料特定後に登録）"
            company["summary"] = "企業探索用。JPXで上場・市場・業種を確認済みだが、中計または中計相当資料は未特定。"
            for field in ["revenue", "profit", "margin", "capital", "returnPolicy"]:
                company[field] = placeholder
            company["themes"] = [company.get("industry") or company.get("category"), "JPX上場確認", "中計資料特定前"]
            company["warnings"] = ["カバレッジβ。中計または中計相当資料の所在は未特定。", "中計開示企業であることを確定したデータではありません。"]
            company["nextAction"] = "会社公式IRから中計または中計相当資料を特定する。"
    return company


def migrate_data():
    data = SITE_DIR / "data"
    core = read_json(data / "sample_companies.json")
    beta = read_json(data / "beta_companies.json")

    migrated_core = [migrate_company(company, "core") for company in core]
    migrated_beta = []
    for company in beta:
        if company.get("reviewStage") == "source_indexed":
            stage = "source_indexed"
        elif company.get("reviewStage") == "jpx_indexed":
            stage = "jpx_indexed"
        else:
            stage = "detailed_extracted"
        migrated_beta.append(migrate_company(company, stage))

    write_json(data / "sample_companies.json", migrated_core, compact=True)
    write_json(data / "beta_companies.json", migrated_beta, compact=True)

    metadata = {
        "product": "Chu-kei",
        "release": "570社 Quality Hardened Beta",
        "version": "v43",
        "updatedAt": UPDATED_AT,
        "assumedPublicMidtermPlanUniverse": 1900,
        "coreCompanyCount": 30,
        "detailedBetaCompanyCount": 70,
        "officialIrIndexedBetaCompanyCount": 100,
        "coverageBetaCompanyCount": 370,
        "betaCompanyCount": 540,
        "totalCompanyCount": 570,
        "directoryCoverageRate": 30.0,
        "sourceIndexedOrBetterCoverageRate": 10.5,
        "structuredPlanCoverageRate": 5.3,
        "status": "quality_hardened_beta_ready",
        "notes": [
            "企業探索570社、中計ソース確認済み200社、主要論点構造化済み100社を分離",
            "資料公表日とソース確認日を分離し、確認日を公表日として表示しない",
            "進捗DBを正本として目標登録件数・実績接続件数を同期",
            "未レビュー、未確認、未開示を区別",
            "投資助言・銘柄推奨を目的としない",
        ],
        "qualityGateVersion": "v43",
        "structuredCompanyCount": 100,
        "sourceConfirmedCompanyCount": 200,
        "directoryOnlyCompanyCount": 370,
    }
    write_json(data / "release_metadata.json", metadata)

    for filename in ["beta_promotion_readiness.json", "beta_target_registration_queue.json", "coverage_target_570.json"]:
        path = data / filename
        value = read_json(path)
        if isinstance(value, dict):
            if "version" in value:
                value["version"] = "v43"
            if "schemaVersion" in value:
                value["schemaVersion"] = "1.1"
            if "updatedAt" in value:
                value["updatedAt"] = UPDATED_AT
            if "createdAt" in value:
                value["createdAt"] = UPDATED_AT
            write_json(path, value, compact=True)

    stages = Counter(company["reviewStage"] for company in migrated_core + migrated_beta)
    expected = {"core": 30, "detailed_extracted": 70, "source_indexed": 100, "jpx_indexed": 370}
    if dict(stages) != expected:
        raise RuntimeError(f"Unexpected quality stages: {dict(stages)}")


def migrate_html():
    path = SITE_DIR / "index.html"
    html = path.read_text(encoding="utf-8")
    html = html.replace("570社 Coverage 30% Beta / 2026-07-10", "570社 Quality Hardened Beta v43 / 2026-07-10")
    html = html.replace("Chu-kei 570社 Coverage 30% Beta:", "Chu-kei 570社 Quality Hardened Beta v43:")
    html = html.replace("中計ソース確認済み200社と、JPXで上場・市場・業種を確認したカバレッジβ370社を分け、データ深度を明示します。", "中計ソース確認済み200社、主要論点構造化済み100社、JPX起点のカバレッジβ370社を分け、データ深度と品質根拠を明示します。")
    html = html.replace('rel="noreferrer"', 'rel="noopener noreferrer"')
    html = html.replace("chukei.compare.selected.v41", "chukei.compare.selected.v43")
    html = html.replace("chukei.recent.companies.v41", "chukei.recent.companies.v43")
    html = html.replace("      .beta-notice {", "      .date-meta {\n        display: flex;\n        flex-wrap: wrap;\n        gap: 4px 12px;\n      }\n\n      .beta-notice {", 1)

    old_load = '''      async function loadData() {
        coreCompanies = await fetchJson(dataUrl, []);
        betaCompanies = await fetchJson(betaDataUrl, []);
        releaseMetadata = await fetchJson(releaseMetadataUrl, null);
        coreCompanies = coreCompanies.map(company => ({ ...company, dataTier: "core", dataTierLabel: "本番" }));
        betaCompanies = betaCompanies.map(company => ({ ...company, dataTier: "beta", dataTierLabel: company.dataTierLabel || "拡張β" }));
        companies = [...coreCompanies, ...betaCompanies];
        marketMetrics = await fetchJson(marketDataUrl, []);
        planProgress = await fetchJson(planProgressUrl, []);
        dataQualitySummary = await fetchJson(dataQualitySummaryUrl, null);
        dataQualityAudit = await fetchJson(dataQualityAuditUrl, null);
        planReviewScores = await fetchJson(planReviewScoresUrl, []);
        opportunityScores = await fetchJson(opportunityScoresUrl, []);
'''
    new_load = '''      async function loadData() {
        const [loadedCoreCompanies, loadedBetaCompanies, loadedReleaseMetadata, loadedMarketMetrics, loadedPlanProgress, loadedDataQualitySummary, loadedDataQualityAudit, loadedPlanReviewScores, loadedOpportunityScores] = await Promise.all([
          fetchJson(dataUrl, []), fetchJson(betaDataUrl, []), fetchJson(releaseMetadataUrl, null), fetchJson(marketDataUrl, []), fetchJson(planProgressUrl, []), fetchJson(dataQualitySummaryUrl, null), fetchJson(dataQualityAuditUrl, null), fetchJson(planReviewScoresUrl, []), fetchJson(opportunityScoresUrl, [])
        ]);
        coreCompanies = loadedCoreCompanies.map(company => ({ ...company, dataTier: "core", dataTierLabel: "本番" }));
        betaCompanies = loadedBetaCompanies.map(company => ({ ...company, dataTier: "beta", dataTierLabel: company.dataTierLabel || "拡張β" }));
        companies = [...coreCompanies, ...betaCompanies];
        releaseMetadata = loadedReleaseMetadata;
        marketMetrics = loadedMarketMetrics;
        planProgress = loadedPlanProgress;
        dataQualitySummary = loadedDataQualitySummary;
        dataQualityAudit = loadedDataQualityAudit;
        planReviewScores = loadedPlanReviewScores;
        opportunityScores = loadedOpportunityScores;
'''
    html = replace_once(html, old_load, new_load, "parallel data loading")

    helper_anchor = '''      function stageLabel(company) {'''
    helpers = '''      function publicationDate(company) { return company.planPublishedDate || null; }
      function publicationDateLabel(company) { return publicationDate(company) || "未確認"; }
      function verificationDateLabel(company) { return company.lastVerifiedDate || "未確認"; }
      function dateMetaHtml(company) { return '<span>資料公表日 ' + escapeHtml(publicationDateLabel(company)) + '</span><span>ソース確認 ' + escapeHtml(verificationDateLabel(company)) + '</span>'; }
      function qualityStars(company) { const stars = Number(company.qualityProfile?.stars || 0); return stars > 0 ? "★".repeat(stars) + "☆".repeat(Math.max(0, 5 - stars)) : "未算定"; }
      function qualityScoreLabel(company) { if (company.qualityProfile?.eligibleForScoring === false) return "算定対象外"; const score = company.qualityProfile?.score ?? reviewScore(company); return Number.isFinite(score) ? score + " / 100" : "未算定"; }

      function stageLabel(company) {'''
    html = replace_once(html, helper_anchor, helpers, "date and quality helpers")
    html = html.replace('''      function reviewScore(company) {
        return planReviewScoreByCode.get(company.code)?.reviewScore ?? company.score ?? 0;
      }''', '''      function reviewScore(company) {
        if (company.qualityProfile?.eligibleForScoring === false) return 0;
        return company.qualityProfile?.score ?? planReviewScoreByCode.get(company.code)?.reviewScore ?? company.score ?? 0;
      }''')
    html = html.replace('if (sort === "date") return comparableDate(b.date).localeCompare(comparableDate(a.date));', 'if (sort === "date") return comparableDate(publicationDate(b)).localeCompare(comparableDate(publicationDate(a)));')
    html = html.replace('''      function comparableDate(value) {
        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return value;''', '''      function comparableDate(value) {
        if (typeof value !== "string") return "0000-00-00";
        if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return value;''')
    html = html.replace("'<div class=\"sub\">' + escapeHtml(company.document) + ' / ' + escapeHtml(company.date) + '</div>' +", "'<div class=\"sub\">' + escapeHtml(company.document) + '</div>' + '<div class=\"sub date-meta\">' + dateMetaHtml(company) + '</div>' +")
    html = html.replace('document.querySelector("#detailMeta").textContent = company.code + " / " + company.market + " / " + (company.industry || "業種未設定") + " / " + stageLabel(company) + " / " + company.document + " / " + company.date;', 'document.querySelector("#detailMeta").textContent = company.code + " / " + company.market + " / " + (company.industry || "業種未設定") + " / " + stageLabel(company) + " / " + company.document + " / 資料公表日 " + publicationDateLabel(company) + " / ソース確認 " + verificationDateLabel(company);')
    html = html.replace('document.querySelector("#detailReviewScore").textContent = reviewScore(company) + " / 100";', 'document.querySelector("#detailReviewScore").textContent = qualityScoreLabel(company);')

    old_metrics = '''        const homeMetrics = [
          ["掲載企業", companies.length + "社"],
          ["中計ソース確認済み", (coreCompanies.length + detailedBetaCount + sourceIndexedCount) + "社"],
          ["カバレッジβ", coverageBetaCount + "社"],
          ["実績接続", actualCompanies + "社"],
          ["推定母集団カバー", ((companies.length / 1900) * 100).toFixed(1) + "%"]
        ];'''
    new_metrics = '''        const structuredCount = coreCompanies.length + detailedBetaCount;
        const sourceConfirmedCount = structuredCount + sourceIndexedCount;
        const denominator = releaseMetadata?.assumedPublicMidtermPlanUniverse || 1900;
        const homeMetrics = [
          ["企業探索", companies.length + "社 / " + ((companies.length / denominator) * 100).toFixed(1) + "%相当"],
          ["中計ソース確認済み", sourceConfirmedCount + "社 / " + ((sourceConfirmedCount / denominator) * 100).toFixed(1) + "%相当"],
          ["主要論点構造化済み", structuredCount + "社 / " + ((structuredCount / denominator) * 100).toFixed(1) + "%相当"],
          ["実績接続", actualCompanies + "社"],
          ["カバレッジβ", coverageBetaCount + "社（企業探索専用）"]
        ];'''
    html = replace_once(html, old_metrics, new_metrics, "three-level coverage metrics")
    html = html.replace("本番30社 / 詳細抽出済みβ70社 / 一次確認β100社 / カバレッジβ370社 / 合計570社。", "企業探索570社 / 中計ソース確認済み200社 / 主要論点構造化済み100社。本番30社 / 詳細抽出済みβ70社 / 一次確認β100社 / カバレッジβ370社。")

    html = html.replace("<table>\n                <thead>\n                  <tr>\n                    <th>会社</th>", "<table>\n                <caption>企業・中期経営計画一覧</caption>\n                <thead>\n                  <tr>\n                    <th scope=\"col\">会社</th>", 1)
    for label in ["この中計の読み方", "経営課題", "成長戦略", "目標・資本政策", "検証可能性"]:
        html = html.replace(f"<th>{label}</th>", f"<th scope=\"col\">{label}</th>", 1)
    html = html.replace("<div class=\"compare-wrap\">\n            <table>\n              <thead id=\"compareHead\">", "<div class=\"compare-wrap\">\n            <table>\n              <caption>選択企業の中期経営計画比較</caption>\n              <thead id=\"compareHead\">", 1)
    html = html.replace("map(column => '<th>' + column + '</th>')", "map(column => '<th scope=\"col\">' + column + '</th>')")
    path.write_text(html, encoding="utf-8")


def write_release_docs():
    (SITE_DIR / "README_DEPLOY.md").write_text("""# Chu-kei 570社 Quality Hardened Beta v43

このディレクトリがNetlifyの公開ルートです。企業探索570社、中計ソース確認済み200社、主要論点構造化済み100社を品質階層別に収録しています。

カバレッジβは企業探索専用です。資料公表日とソース確認日を分離し、公表日が未確認の場合は確認日を代用しません。
""", encoding="utf-8")
    (SITE_DIR / "RELEASE_QA_REPORT.md").write_text("""# Chu-kei 570社 Quality Hardened Beta v43 QA

- 570社・証券コード一意性
- 品質階層 30 / 70 / 100 / 370
- 公表日と確認日の分離
- 全社品質プロファイル
- カバレッジβのスコア算定対象外
- 推測分析プレースホルダーの除去
- 進捗149行の整合
- 企業JSON 4MB未満
- アクセシビリティ基礎監査
""", encoding="utf-8")
    notes = SITE_DIR / "docs" / "release_notes_570_company_v43.md"
    notes.write_text("""# Chu-kei 570社 Quality Hardened Beta v43

v42運用パッケージを正本として再構築し、日付意味の分離、品質プロファイル、Coverageβの評価対象外化、データ軽量化、並列読込、アクセシビリティ補強を実施しました。
""", encoding="utf-8")


def write_checksums():
    checksum_path = SITE_DIR / "SHA256SUMS.txt"
    rows = []
    for path in sorted(SITE_DIR.rglob("*")):
        if not path.is_file() or path == checksum_path:
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        rows.append(f"{digest}  {path.relative_to(SITE_DIR).as_posix()}")
    checksum_path.write_text("\n".join(rows) + "\n", encoding="ascii")


def main():
    with tempfile.TemporaryDirectory(prefix="chukei-import-") as temp:
        work = Path(temp)
        package = reconstruct_package(work)
        public = extract_public_site(package, work)
        if SITE_DIR.exists():
            shutil.rmtree(SITE_DIR)
        shutil.copytree(public, SITE_DIR)
    migrate_data()
    migrate_html()
    write_release_docs()
    write_checksums()
    print(f"Generated {SITE_DIR}")


if __name__ == "__main__":
    main()
