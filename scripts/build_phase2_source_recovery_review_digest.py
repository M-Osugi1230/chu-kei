#!/usr/bin/env python3
"""Build compact human-review digests for unresolved Phase 2 source recovery packets.

This tool is evidence preparation only. It does not classify a document, complete a
primary review, infer missing facts, or approve quality. Remaining company codes are
computed from the current source-recovery audit minus canonical primary-review files.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
P2 = ROOT / "operations" / "quality-rebase" / "phase2"
AUDIT = P2 / "source-relevance-audit" / "source-recovery-required.json"
RECOVERY = P2 / "source-recovery-collection-v1"
REV_DIRS = [P2 / "primary-reviews", P2 / "reviews"]
OUT = P2 / "source-repairs" / "source-recovery-review-digest-v1"
CODE_RE = re.compile(r"^(?:\d{4}|\d{3}[A-Z])$")
FILE_RE = re.compile(r"^(?P<code>(?:\d{4}|\d{3}[A-Z]))(?:-wave\d+)?-primary-review-v\d+\.json$")
KEYWORDS = [
    "中期経営計画", "中期経営戦略", "中期計画", "経営計画", "成長戦略", "事業計画",
    "長期ビジョン", "長期目標", "経営目標", "定量目標", "財務目標", "KPI", "ＲＯＥ", "ROE",
    "ＲＯＩＣ", "ROIC", "売上高", "営業利益", "EBITDA", "配当", "株主還元", "2027", "2028",
    "2029", "2030", "2031", "2035"
]

def load(path: Path): return json.loads(path.read_text(encoding="utf-8"))

def reviewed_codes():
    out=set()
    for d in REV_DIRS:
        if not d.exists(): continue
        for p in d.glob("*.json"):
            m=FILE_RE.fullmatch(p.name)
            if m: out.add(m.group("code"))
    return out

def clean(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace("\x00", " ")).strip()

def snippets(text: str):
    flat=clean(text)
    found=[]; seen=set()
    for kw in KEYWORDS:
        start=0
        while len(found)<18:
            idx=flat.find(kw,start)
            if idx<0: break
            lo=max(0,idx-220); hi=min(len(flat),idx+520)
            s=flat[lo:hi].strip()
            key=s[:120]
            if key not in seen:
                seen.add(key); found.append({"keyword":kw,"text":s})
            start=idx+len(kw)
        if len(found)>=18: break
    return found

def compact_candidates(path: Path, limit=20):
    if not path.exists(): return []
    data=load(path)
    if isinstance(data, dict):
        for key in ("candidates","metrics","strategies","items"):
            if isinstance(data.get(key),list): data=data[key]; break
    if not isinstance(data,list): return []
    return data[:limit]

def main():
    audit=load(AUDIT)
    rows={str(r["code"]):r for r in audit["companies"]}
    reviewed=reviewed_codes()
    remaining=[c for c in rows if c not in reviewed]
    remaining.sort()
    OUT.mkdir(parents=True,exist_ok=True)
    packets=[]
    for code in remaining:
        root=RECOVERY/code
        col=load(root/"collection.json") if (root/"collection.json").exists() else {}
        text=(root/"full-text.txt").read_text(encoding="utf-8",errors="replace") if (root/"full-text.txt").exists() else ""
        packet={
          "code":code,"name":rows[code].get("name"),"auditSourceUrl":rows[code].get("sourceUrl"),
          "collectionStatus":col.get("status"),"resolvedPageUrl":col.get("resolvedPageUrl"),
          "resolvedPdfUrl":col.get("resolvedPdfUrl"),"htmlTitle":col.get("htmlTitle"),
          "documentTypeCandidate":col.get("documentTypeCandidate"),"pageCount":col.get("pageCount"),
          "textCharacters":col.get("textCharacters"),"pdfSha256":col.get("pdfSha256"),
          "companyQueueMetadata":col.get("company"),"openingText":clean(text[:2200]),
          "evidenceSnippets":snippets(text),
          "metricCandidates":compact_candidates(root/"metric-candidates.json",12),
          "strategyCandidates":compact_candidates(root/"strategy-candidates.json",12),
          "automaticFactCompletionAllowed":False,"automaticApprovalAllowed":False,"deepVerificationApproved":False
        }
        packets.append(packet)
    batch_size=8
    files=[]
    for i in range(0,len(packets),batch_size):
        no=i//batch_size+1
        path=OUT/f"batch-{no:02d}.json"
        payload={"schemaVersion":"phase2-source-recovery-human-review-digest-v1","batch":no,
          "generatedAt":datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
          "companies":packets[i:i+batch_size],"automaticApprovalAllowed":False,"deepVerificationApproved":False}
        path.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        files.append(str(path.relative_to(ROOT)))
    index={"schemaVersion":"phase2-source-recovery-human-review-digest-index-v1",
      "generatedAt":datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
      "remainingCompanies":len(packets),"codes":[p["code"] for p in packets],"batchFiles":files,
      "policy":{"evidencePreparationOnly":True,"humanPrimaryReviewRequired":True,"automaticFactCompletionAllowed":False,
      "automaticApprovalAllowed":False,"deepVerificationApproved":False}}
    (OUT/"index.json").write_text(json.dumps(index,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(index,ensure_ascii=False,indent=2))
if __name__=="__main__": main()
