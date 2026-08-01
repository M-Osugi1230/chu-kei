#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "phase2_source_relevance_gate_v2.py"
SPEC = importlib.util.spec_from_file_location("phase2_source_relevance_gate_v2", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class SourceRelevanceGateV2Test(unittest.TestCase):
    def classify(self, code: str, text: str, **overrides):
        with tempfile.TemporaryDirectory() as tmp:
            company_dir = Path(tmp) / code
            company_dir.mkdir(parents=True)
            (company_dir / "full-text.txt").write_text(text, encoding="utf-8")
            collection = {
                "status": "collection_complete_primary_human_review_pending",
                "company": {
                    "code": code,
                    "name": "テスト会社",
                    "document": "中期経営計画",
                },
                "resolvedPageUrl": "https://example.com/ir/",
                "resolvedPdfUrl": "https://example.com/plan.pdf",
                "documentTypeCandidate": "formal_management_plan",
                "pageCount": 20,
                "textCharacters": len(text),
                **overrides,
            }
            return MODULE.classify(company_dir, collection)

    def test_formal_plan_is_primary_review_candidate(self):
        text = (
            "中期経営計画 2026年度から2028年度。重点戦略、成長戦略、事業戦略、"
            "ポートフォリオ改革、DX、人材戦略、研究開発、資本政策を推進する。"
            "2028年度 売上収益 5,000億円、営業利益 500億円、ROE 10%、ROIC 8%。"
            "営業キャッシュフロー 1,000億円、成長投資 700億円、総還元性向 50%。"
        ) * 30
        row = self.classify("9999", text)
        self.assertEqual(row["queue"], "primary_review_candidate")
        self.assertFalse(row["automaticApprovalAllowed"])
        self.assertFalse(row["deepVerificationApproved"])

    def test_holiday_notice_is_likely_wrong_document(self):
        text = (
            "夏季休業のお知らせ。誠に勝手ながら以下の期間を休日といたします。"
            "年末年始休業、採用情報、会社説明会のお知らせ。"
        ) * 20
        row = self.classify("9998", text, pageCount=1, textCharacters=len(text))
        self.assertEqual(row["queue"], "likely_wrong_document")
        self.assertLess(row["relevanceScore"], 0)

    def test_collection_failure_goes_to_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            company_dir = Path(tmp) / "9997"
            company_dir.mkdir(parents=True)
            collection = {
                "status": "collection_failed",
                "company": {"code": "9997", "name": "失敗会社"},
                "error": "timeout",
            }
            row = MODULE.classify(company_dir, collection)
            self.assertEqual(row["queue"], "source_recovery_required")

    def test_pdf_not_found_goes_to_identification(self):
        with tempfile.TemporaryDirectory() as tmp:
            company_dir = Path(tmp) / "9996"
            company_dir.mkdir(parents=True)
            collection = {
                "status": "pdf_not_found",
                "company": {"code": "9996", "name": "未特定会社"},
                "requiresManualPdfIdentification": True,
            }
            row = MODULE.classify(company_dir, collection)
            self.assertEqual(row["queue"], "pdf_identification_required")

    def test_image_pdf_goes_to_visual_review(self):
        row = self.classify(
            "9995",
            "",
            pageCount=30,
            textCharacters=0,
        )
        self.assertEqual(row["queue"], "visual_or_ocr_review_required")

    def test_known_false_positive_cannot_be_promoted(self):
        text = (
            "中期経営計画 2028年度 売上収益 5,000億円 営業利益 500億円 ROE 10%。"
            "重点戦略 成長戦略 ポートフォリオ DX 人材戦略 資本政策。"
        ) * 40
        with self.assertRaises(SystemExit):
            self.classify("4063", text)


if __name__ == "__main__":
    unittest.main()
