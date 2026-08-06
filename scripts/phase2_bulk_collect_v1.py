#!/usr/bin/env python3
import argparse
import hashlib
import io
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
QUEUE_PATH = ROOT / 'operations' / 'quality-rebase' / 'phase2-queue-500-v1.json'
OUT_ROOT = ROOT / 'operations' / 'quality-rebase' / 'phase2' / 'bulk-collection'
USER_AGENT = 'Chu-keiQualityRebase/1.0 (+https://github.com/M-Osugi1230/chu-kei)'
TIMEOUT = 45
MAX_PDF_BYTES = 80 * 1024 * 1024

PLAN_WORDS = re.compile(r'(中期経営計画|中長期経営計画|経営計画|経営戦略|事業計画|成長可能性|management\s*plan|mid[-\s]?term)', re.I)
METRIC_WORDS = re.compile(r'(売上|収益|営業利益|事業利益|経常利益|当期利益|純利益|ROE|ROIC|ROA|DOE|EBITDA|EPS|配当|還元|投資|キャッシュフロー|D/E|自己資本比率)', re.I)
NUMBER_WORDS = re.compile(r'(?P<number>-?\d[\d,]*(?:\.\d+)?)\s*(?P<unit>兆円|億円|百万円|千円|円|%|％|倍|人|件|社|店舗|拠点)')
YEAR_WORDS = re.compile(r'(20\d{2}(?:年度|年|年\d{1,2}月期)|FY\s*20\d{2}|20\d{2}/\d{1,2})', re.I)


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def sha256(data: bytes):
    return hashlib.sha256(data).hexdigest()


def normalize_space(text: str):
    return re.sub(r'\s+', ' ', text or '').strip()


def official_host(url: str, source_url: str):
    try:
        return urlparse(url).netloc.lower() == urlparse(source_url).netloc.lower()
    except Exception:
        return False


def request(session, url, allow_large=False):
    response = session.get(url, timeout=TIMEOUT, allow_redirects=True, stream=True)
    response.raise_for_status()
    chunks = []
    size = 0
    limit = MAX_PDF_BYTES if allow_large else 12 * 1024 * 1024
    for chunk in response.iter_content(1024 * 128):
        if not chunk:
            continue
        size += len(chunk)
        if size > limit:
            raise ValueError(f'response_too_large:{size}')
        chunks.append(chunk)
    return response, b''.join(chunks)


def score_pdf_link(anchor_text, href, source_url):
    text = normalize_space(anchor_text)
    score = 0
    if href.lower().split('?')[0].endswith('.pdf'):
        score += 40
    if PLAN_WORDS.search(text + ' ' + href):
        score += 30
    if official_host(href, source_url):
        score += 15
    if re.search(r'(決算短信|有価証券報告書|招集通知|株主総会)', text):
        score -= 25
    if re.search(r'(訂正|修正|update|アップデート)', text, re.I):
        score += 5
    return score


def discover_pdf(session, source_url):
    response, body = request(session, source_url)
    content_type = (response.headers.get('content-type') or '').lower()
    final_url = response.url
    if 'application/pdf' in content_type or body[:5] == b'%PDF-':
        return {
            'status': 'direct_pdf',
            'pageUrl': source_url,
            'pdfUrl': final_url,
            'htmlTitle': None,
            'candidates': [],
            'bytes': body,
        }
    soup = BeautifulSoup(body, 'html.parser')
    title = normalize_space(soup.title.get_text(' ', strip=True)) if soup.title else None
    candidates = []
    for anchor in soup.find_all('a', href=True):
        href = urljoin(final_url, anchor.get('href'))
        anchor_text = normalize_space(anchor.get_text(' ', strip=True))
        score = score_pdf_link(anchor_text, href, final_url)
        if score <= 0:
            continue
        candidates.append({'url': href, 'text': anchor_text, 'score': score})
    candidates.sort(key=lambda row: (-row['score'], row['url']))
    errors = []
    for candidate in candidates[:12]:
        try:
            pdf_response, pdf_body = request(session, candidate['url'], allow_large=True)
            pdf_type = (pdf_response.headers.get('content-type') or '').lower()
            if 'application/pdf' in pdf_type or pdf_body[:5] == b'%PDF-':
                return {
                    'status': 'pdf_discovered',
                    'pageUrl': final_url,
                    'pdfUrl': pdf_response.url,
                    'htmlTitle': title,
                    'candidates': candidates[:12],
                    'bytes': pdf_body,
                }
        except Exception as exc:
            errors.append({'url': candidate['url'], 'error': str(exc)})
    return {
        'status': 'pdf_not_found',
        'pageUrl': final_url,
        'pdfUrl': None,
        'htmlTitle': title,
        'candidates': candidates[:12],
        'candidateErrors': errors,
        'bytes': None,
        'htmlText': normalize_space(soup.get_text(' ', strip=True))[:250000],
    }


def classify_document(title, document_name, text):
    combined = ' '.join(filter(None, [title, document_name, text[:8000]]))
    if re.search(r'事業計画及び成長可能性', combined):
        return 'growth_potential_document'
    if re.search(r'(見直し|修正|改定|アップデート|update)', combined, re.I):
        return 'plan_revision_or_update'
    if re.search(r'(中期経営計画|中長期経営計画|経営計画)', combined):
        return 'formal_management_plan'
    if re.search(r'(経営方針|経営戦略)', combined):
        return 'management_policy_or_strategy'
    return 'manual_classification_required'


def extract_pdf(pdf_bytes):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages = []
    all_text = []
    extraction_errors = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ''
        except Exception as exc:
            text = ''
            extraction_errors.append({'page': index, 'error': str(exc)})
        normalized = normalize_space(text)
        pages.append({'page': index, 'text': normalized})
        all_text.append(normalized)
    return pages, '\n'.join(all_text), extraction_errors


def metric_candidates(pages):
    rows = []
    seen = set()
    for page in pages:
        text = page['text']
        if not METRIC_WORDS.search(text):
            continue
        sentences = re.split(r'(?<=[。！？])|\s{2,}', text)
        for sentence in sentences:
            sentence = normalize_space(sentence)
            if len(sentence) < 8 or len(sentence) > 600:
                continue
            if not METRIC_WORDS.search(sentence) or not NUMBER_WORDS.search(sentence):
                continue
            numbers = [
                {'value': match.group('number'), 'unit': match.group('unit')}
                for match in NUMBER_WORDS.finditer(sentence)
            ]
            years = YEAR_WORDS.findall(sentence)
            key = (page['page'], sentence)
            if key in seen:
                continue
            seen.add(key)
            rows.append({
                'page': page['page'],
                'text': sentence,
                'numbers': numbers,
                'years': years,
                'requiresHumanValidation': True,
            })
    return rows[:300]


def strategy_candidates(pages):
    keywords = re.compile(r'(重点戦略|基本戦略|成長戦略|事業戦略|経営課題|価値創造|ポートフォリオ|構造改革|DX|M&A|研究開発|人材|サステナビリティ)', re.I)
    rows = []
    for page in pages:
        if not keywords.search(page['text']):
            continue
        excerpt = page['text'][:1600]
        rows.append({'page': page['page'], 'excerpt': excerpt, 'requiresHumanValidation': True})
    return rows[:80]


def build_review_template(company, collection):
    return {
        'schemaVersion': 'deep-verification-primary-review-template-v1',
        'company': {
            'code': company['code'],
            'name': company['name'],
            'market': company.get('market'),
            'industry': company.get('industry'),
        },
        'document': {
            'candidateTitle': company.get('document'),
            'candidatePublishedDate': company.get('planPublishedDate'),
            'sourceUrl': company.get('sourceUrl'),
            'resolvedPageUrl': collection.get('resolvedPageUrl'),
            'resolvedPdfUrl': collection.get('resolvedPdfUrl'),
            'documentTypeCandidate': collection.get('documentTypeCandidate'),
            'pageCount': collection.get('pageCount'),
            'pdfSha256': collection.get('pdfSha256'),
            'formalPlanConfirmed': False,
            'fullTextHumanReviewComplete': False,
        },
        'structuredAnalysis': {
            'summary': None,
            'period': None,
            'strategyThemes': [],
            'financialTargets': [],
            'capitalPolicy': None,
            'shareholderReturnPolicy': None,
            'nonFinancialTargets': [],
            'importantDefinitions': [],
        },
        'validation': {
            'companyIdentityConfirmed': False,
            'publicationDateConfirmed': False,
            'strategyStructured': False,
            'metricsValidated': False,
            'fieldLevelEvidenceLinked': False,
            'yearValidated': False,
            'unitValidated': False,
            'scopeValidated': False,
            'forecastActualSeparated': False,
            'templateTextRemaining': False,
            'independentDoubleCheck': False,
            'postPublicationLinkAndRenderCheck': False,
        },
        'review': {
            'status': 'collection_complete_primary_human_review_pending',
            'automaticFactCompletionAllowed': False,
            'automaticApprovalAllowed': False,
            'deepVerificationApproved': False,
            'reviewers': [],
        },
    }


def process_company(session, company, order, output_dir):
    started = time.time()
    code = str(company['code'])
    company_dir = output_dir / code
    company_dir.mkdir(parents=True, exist_ok=True)
    base = {
        'schemaVersion': 'phase2-bulk-collection-company-v1',
        'order': order,
        'company': company,
        'automaticApprovalAllowed': False,
        'deepVerificationApproved': False,
    }
    try:
        discovered = discover_pdf(session, company['sourceUrl'])
        collection = {
            **base,
            'status': discovered['status'],
            'resolvedPageUrl': discovered.get('pageUrl'),
            'resolvedPdfUrl': discovered.get('pdfUrl'),
            'htmlTitle': discovered.get('htmlTitle'),
            'pdfCandidates': discovered.get('candidates', []),
            'candidateErrors': discovered.get('candidateErrors', []),
        }
        pdf_bytes = discovered.get('bytes')
        if pdf_bytes:
            pages, full_text, extraction_errors = extract_pdf(pdf_bytes)
            pdf_hash = sha256(pdf_bytes)
            document_type = classify_document(discovered.get('htmlTitle'), company.get('document'), full_text)
            collection.update({
                'status': 'collection_complete_primary_human_review_pending',
                'pdfSha256': pdf_hash,
                'pdfBytes': len(pdf_bytes),
                'pageCount': len(pages),
                'documentTypeCandidate': document_type,
                'textCharacters': len(full_text),
                'textExtractionErrors': extraction_errors,
                'metricCandidateCount': len(metric_candidates(pages)),
                'strategyCandidateCount': len(strategy_candidates(pages)),
                'requiresVisualReview': True,
                'requiresPrimaryHumanReview': True,
                'requiresIndependentReview': True,
            })
            (company_dir / 'source.pdf').write_bytes(pdf_bytes)
            (company_dir / 'full-text.txt').write_text(full_text, encoding='utf-8')
            write_json(company_dir / 'pages.json', pages)
            write_json(company_dir / 'metric-candidates.json', metric_candidates(pages))
            write_json(company_dir / 'strategy-candidates.json', strategy_candidates(pages))
        else:
            html_text = discovered.get('htmlText') or ''
            collection.update({
                'documentTypeCandidate': classify_document(discovered.get('htmlTitle'), company.get('document'), html_text),
                'htmlTextCharacters': len(html_text),
                'requiresManualPdfIdentification': True,
                'requiresPrimaryHumanReview': True,
                'requiresIndependentReview': True,
            })
            if html_text:
                (company_dir / 'source-page-text.txt').write_text(html_text, encoding='utf-8')
        collection['elapsedSeconds'] = round(time.time() - started, 3)
        write_json(company_dir / 'collection.json', collection)
        write_json(company_dir / 'primary-review-template.json', build_review_template(company, collection))
        return collection
    except Exception as exc:
        failed = {
            **base,
            'status': 'collection_failed',
            'errorType': type(exc).__name__,
            'error': str(exc),
            'elapsedSeconds': round(time.time() - started, 3),
            'requiresManualSourceRecovery': True,
        }
        write_json(company_dir / 'collection.json', failed)
        return failed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch', type=int, required=True, choices=range(2, 11))
    parser.add_argument('--wave', type=int, required=True, choices=range(1, 6))
    args = parser.parse_args()

    queue = read_json(QUEUE_PATH)
    batch = next((row for row in queue['batches'] if row['batch'] == args.batch), None)
    if not batch:
        raise SystemExit(f'batch_not_found:{args.batch}')
    start = (args.wave - 1) * 10
    companies = batch['companies'][start:start + 10]
    if len(companies) != 10:
        raise SystemExit(f'wave_company_count:{len(companies)}')

    output_dir = OUT_ROOT / f'batch-{args.batch:02d}' / f'wave-{args.wave:02d}'
    output_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({'User-Agent': USER_AGENT, 'Accept-Language': 'ja,en;q=0.8'})

    results = []
    absolute_order_start = 51 + (args.batch - 2) * 50 + start
    for offset, company in enumerate(companies):
        result = process_company(session, company, absolute_order_start + offset, output_dir)
        results.append(result)
        print(json.dumps({'code': company['code'], 'status': result['status']}, ensure_ascii=False), flush=True)

    counts = {}
    for result in results:
        counts[result['status']] = counts.get(result['status'], 0) + 1
    summary = {
        'schemaVersion': 'phase2-bulk-collection-wave-v1',
        'batch': args.batch,
        'wave': args.wave,
        'orders': f'{absolute_order_start}-{absolute_order_start + 9}',
        'targetCompanies': 10,
        'processedCompanies': len(results),
        'counts': counts,
        'automaticFactCompletionAllowed': False,
        'automaticApprovalAllowed': False,
        'deepVerificationApproved': 0,
        'companies': [
            {
                'order': row['order'],
                'code': row['company']['code'],
                'name': row['company']['name'],
                'status': row['status'],
                'resolvedPdfUrl': row.get('resolvedPdfUrl'),
                'pageCount': row.get('pageCount'),
                'documentTypeCandidate': row.get('documentTypeCandidate'),
            }
            for row in results
        ],
    }
    write_json(output_dir / 'summary.json', summary)
    if len(results) != 10:
        raise SystemExit(2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.exit(main())
