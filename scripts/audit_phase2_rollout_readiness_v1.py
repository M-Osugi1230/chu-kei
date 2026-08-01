#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import sys
from collections import Counter
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
QUEUE = ROOT / 'operations/quality-rebase/phase2-queue-500-v1.json'
OUT = ROOT / 'operations/quality-rebase/phase2/rollout-readiness-v1.json'


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> int:
    queue = json.loads(QUEUE.read_text())
    batches = queue.get('batches', [])
    if [row.get('batch') for row in batches] != list(range(2, 11)):
        fail('Phase 2 batches must be exactly 2-10')

    companies: list[dict] = []
    batch_rows: list[dict] = []
    for batch in batches:
        rows = batch.get('companies', [])
        if len(rows) != 50:
            fail(f"batch {batch.get('batch')} must contain 50 companies, found {len(rows)}")
        companies.extend(rows)
        batch_rows.append({
            'batch': batch['batch'],
            'companies': len(rows),
            'uniqueCodes': len({str(row.get('code', '')).strip() for row in rows}),
        })

    codes = [str(row.get('code', '')).strip() for row in companies]
    names = [str(row.get('name', '')).strip() for row in companies]
    duplicate_codes = sorted(code for code, count in Counter(codes).items() if count > 1)
    missing_codes = [index + 1 for index, code in enumerate(codes) if not code]
    missing_names = [codes[index] for index, name in enumerate(names) if not name]

    url_issues: list[dict] = []
    domain_counts: Counter[str] = Counter()
    direct_pdf = 0
    page_sources = 0
    for row in companies:
        url = str(row.get('sourceUrl', '')).strip()
        parsed = urlparse(url)
        if parsed.scheme != 'https' or not parsed.netloc:
            url_issues.append({'code': row.get('code'), 'url': url, 'reason': 'invalid_https_url'})
            continue
        domain_counts[parsed.netloc.lower()] += 1
        if parsed.path.lower().endswith('.pdf'):
            direct_pdf += 1
        else:
            page_sources += 1

    policy = queue.get('approvalPolicy', {})
    unsafe_policy = []
    for key in ('automaticFactCompletionAllowed', 'automaticCompanySelectionAsApprovalAllowed', 'automaticDeepApprovalAllowed'):
        if policy.get(key) is not False:
            unsafe_policy.append(key)
    if int(policy.get('minimumReviewers', 0)) < 2:
        unsafe_policy.append('minimumReviewers')
    if policy.get('reviewerIndependenceRequired') is not True:
        unsafe_policy.append('reviewerIndependenceRequired')

    report = {
        'schemaVersion': 'phase2-rollout-readiness-v1',
        'queueGeneratedAt': queue.get('generatedAt'),
        'targetAdditionalCompanies': 450,
        'companiesFound': len(companies),
        'uniqueCompanyCodes': len(set(codes)),
        'batches': batch_rows,
        'directPdfSources': direct_pdf,
        'officialPageSources': page_sources,
        'domains': dict(domain_counts.most_common()),
        'duplicateCodes': duplicate_codes,
        'missingCodeIndexes': missing_codes,
        'missingNameCodes': missing_names,
        'urlIssues': url_issues,
        'unsafeApprovalPolicy': unsafe_policy,
        'automaticApprovalAllowed': False,
        'ready': (
            len(companies) == 450
            and len(set(codes)) == 450
            and not duplicate_codes
            and not missing_codes
            and not missing_names
            and not url_issues
            and not unsafe_policy
        ),
        'executionPlan': {
            'batches': 9,
            'wavesPerBatch': 5,
            'companiesPerWave': 10,
            'totalWaves': 45,
            'checkpointAfterEachWave': True,
            'continueOnCompanyFailure': True,
            'approvalGeneratedByCollection': False,
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report['ready']:
        fail('Phase 2 rollout readiness audit failed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
