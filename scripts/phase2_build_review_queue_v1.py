#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COLLECTION_ROOT = ROOT / 'operations' / 'quality-rebase' / 'phase2' / 'bulk-collection'
OUTPUT = ROOT / 'operations' / 'quality-rebase' / 'phase2' / 'review-queue-v1.json'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def classify(collection):
    status = collection.get('status')
    if status == 'collection_complete_primary_human_review_pending':
        if collection.get('pageCount', 0) > 0 and collection.get('textCharacters', 0) >= 500:
            return 'ready_for_primary_human_review'
        return 'blocked_low_text_extraction'
    if status == 'pdf_not_found':
        return 'blocked_manual_pdf_identification'
    if status == 'collection_failed':
        return 'blocked_source_recovery'
    return 'blocked_manual_classification'


def required_actions(queue_status, row):
    if queue_status == 'ready_for_primary_human_review':
        return [
            '正式資料種別と計画期間を確認する',
            'PDF全文と主要図表を確認する',
            '戦略・数値・資本政策を構造化する',
            '各項目へページ証跡を紐付ける',
            '年度・単位・連結範囲・実績/予想/目標を検査する',
            '一次レビュー完了後に独立再確認へ送る',
        ]
    if queue_status == 'blocked_manual_pdf_identification':
        return [
            '公式IRページから正式PDFを特定する',
            '資料名・公表日・会社コードを照合する',
            'PDF特定後に収集処理を再実行する',
        ]
    if queue_status == 'blocked_low_text_extraction':
        return [
            '画像中心PDFとして主要ページを原寸確認する',
            '必要に応じて会社公式HTML・適時開示の代替証跡を固定する',
            '人手で数値・年度・単位を転記し独立確認へ送る',
        ]
    return [
        '到達失敗または資料競合の原因を確認する',
        '会社公式IRまたは適時開示から代替URLを探索する',
        'URL修復後に収集処理を再実行する',
    ]


def main():
    packets = []
    for path in sorted(COLLECTION_ROOT.glob('batch-*/wave-*/*/collection.json')):
        row = read_json(path)
        queue_status = classify(row)
        company = row['company']
        packets.append({
            'order': row['order'],
            'code': str(company['code']),
            'name': company['name'],
            'market': company.get('market'),
            'industry': company.get('industry'),
            'batch': int(path.parts[-4].split('-')[1]),
            'wave': int(path.parts[-3].split('-')[1]),
            'collectionStatus': row.get('status'),
            'queueStatus': queue_status,
            'documentTypeCandidate': row.get('documentTypeCandidate'),
            'resolvedPageUrl': row.get('resolvedPageUrl'),
            'resolvedPdfUrl': row.get('resolvedPdfUrl'),
            'pageCount': row.get('pageCount'),
            'textCharacters': row.get('textCharacters'),
            'metricCandidateCount': row.get('metricCandidateCount'),
            'strategyCandidateCount': row.get('strategyCandidateCount'),
            'collectionFile': str(path.relative_to(ROOT)),
            'reviewTemplateFile': str((path.parent / 'primary-review-template.json').relative_to(ROOT)),
            'requiredActions': required_actions(queue_status, row),
            'automaticApprovalAllowed': False,
            'deepVerificationApproved': False,
        })
    packets.sort(key=lambda row: row['order'])
    counts = {}
    for row in packets:
        counts[row['queueStatus']] = counts.get(row['queueStatus'], 0) + 1
    codes = [row['code'] for row in packets]
    report = {
        'schemaVersion': 'phase2-review-queue-v1',
        'targetAdditionalCompanies': 450,
        'collectedCompanies': len(packets),
        'uniqueCompanies': len(set(codes)),
        'counts': counts,
        'automaticFactCompletionAllowed': False,
        'automaticApprovalAllowed': False,
        'deepVerificationApproved': 0,
        'approvalRule': {
            'primaryCollectionDoesNotEqualReview': True,
            'primaryReviewDoesNotEqualApproval': True,
            'minimumDistinctReviewers': 2,
            'fieldLevelEvidenceRequired': True,
            'postPublicationLinkAndRenderCheckRequired': True,
        },
        'packets': packets,
    }
    write_json(OUTPUT, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
