export const PDF_PAGE_EVIDENCE_PATTERN = /(?:PDF\s+p\.?\s*\d|p\.?\s*\d|ページ\s*\d|図版\s*\d)/i;

export const OFFICIAL_WEB_HEADING_EVIDENCE_PATTERN = /^公式Webページ（見出し[:：]\s*[^）]{2,}）[:：]\s*\S.{7,}$/i;

export function isPrimaryEvidenceReference(value) {
  const reference = String(value || '').trim();
  return PDF_PAGE_EVIDENCE_PATTERN.test(reference)
    || OFFICIAL_WEB_HEADING_EVIDENCE_PATTERN.test(reference);
}

export function countPrimaryEvidenceReferences(references) {
  return (references || []).filter(isPrimaryEvidenceReference).length;
}
