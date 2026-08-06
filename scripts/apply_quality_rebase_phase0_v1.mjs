import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const write = (file, value) => {
  const target = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
};
const readJson = file => JSON.parse(read(file));
const writeJson = (file, value) => write(file, `${JSON.stringify(value, null, 2)}\n`);
const runNode = script => execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'inherit' });

function replaceOnce(file, before, after) {
  const source = read(file);
  if (!source.includes(before)) throw new Error(`Replacement source not found in ${file}: ${before.slice(0, 120)}`);
  const updated = source.replace(before, after);
  if (updated === source) throw new Error(`Replacement did not change ${file}`);
  write(file, updated);
}

function replaceRegex(file, pattern, replacement) {
  const source = read(file);
  if (!pattern.test(source)) throw new Error(`Pattern not found in ${file}: ${pattern}`);
  const updated = source.replace(pattern, replacement);
  if (updated === source) throw new Error(`Pattern replacement did not change ${file}`);
  write(file, updated);
}

runNode('scripts/audit_quality_rebase_phase0_v1.mjs');
runNode('scripts/reconcile_phase0_definitions_v1.mjs');

const audit = readJson('operations/quality-rebase/phase0-audit-report-v1.json');
const reconciliation = readJson('operations/quality-rebase/phase0-definition-reconciliation-v1.json');
const phase1 = readJson('operations/quality-rebase/phase1-cohort-50-v1.json');
const phase2 = readJson('operations/quality-rebase/phase2-queue-500-v1.json');
const ledger = readJson('operations/quality-rebase/deep-verification-ledger-v1.json');

const qualityPublic = {
  schemaVersion: 'quality-rebase-public-v1',
  generatedAt: new Date().toISOString(),
  referenceDate: audit.referenceDate,
  sourceBundleSha256: audit.bundle.sha256,
  counts: {
    companies: reconciliation.companies.total,
    deepVerified: ledger.counts.approved,
    deepReviewInProgress: ledger.counts.inReview,
    reAuditPool: reconciliation.companies.nonTemplatePool,
    strictPhase1Eligible: audit.derived.provisionalCandidates,
    manualReviewRequiredWithinReAuditPool: audit.derived.unclassifiedForManualReview,
    templateReviewRequired: reconciliation.companies.templateLike,
    strictEarningsReleaseReSearch: reconciliation.companies.strictEarningsRelease,
    broadFinancialResultsReSearch: reconciliation.companies.broadFinancialResults,
    formalPlanTitles: reconciliation.companies.formalPlanTitle,
    evidenceCandidates: audit.roadmapBaseline.evidenceCandidateCompanies,
    knownBrokenLinks: audit.roadmapBaseline.knownBrokenLinks,
    progressRecords: reconciliation.progress.records,
    progressCompanies: reconciliation.progress.companiesWithAnyProgressRecord,
    actualConnectedRecords: reconciliation.progress.explicitlyConnectedRecords,
    actualConnectedCompanies: reconciliation.progress.explicitlyConnectedCompanies,
    phase1Selected: phase1.companies.length,
    phase2AdditionalQueued: phase2.queuedAdditional,
    phase2TargetIncludingPhase1: phase2.targetCompaniesIncludingPhase1,
  },
  qualityPolicy: {
    legacyFiveStarMeansDeepVerified: false,
    automaticDeepApprovalAllowed: false,
    minimumIndependentReviewers: ledger.policy.minimumIndependentReviewers,
    requiredChecks: ledger.policy.requiredChecks,
    templateTextMayQualifyAsDeepVerified: false,
  },
  labels: {
    5: '深掘り確認済み',
    4: '深掘りレビュー中',
    3: '再監査対象（構造化済み・深掘り未承認）',
    2: '資料確認済み（テンプレート型・深掘り前）',
    1: '企業カバレッジのみ',
  },
  phase1: {
    status: 'selected_for_full_review',
    target: phase1.targetCompanies,
    marketQuota: phase1.marketQuota,
    companies: phase1.companies,
  },
  phase2: {
    status: 'queued_for_batch_review',
    targetIncludingPhase1: phase2.targetCompaniesIncludingPhase1,
    additionalTarget: phase2.additionalTarget,
    queuedAdditional: phase2.queuedAdditional,
    batchSize: phase2.batchSize,
    batches: phase2.batches.map(batch => ({
      batch: batch.batch,
      target: batch.target,
      companyCodes: batch.companies.map(company => company.code),
    })),
  },
  notes: [
    '3,000社掲載は企業カバレッジ件数であり、深掘り確認済み件数ではありません。',
    '旧5つ星は機械項目の充足を示す旧評価で、全文精読を証明しないため廃止しました。',
    'Phase 1・2の候補選定は処理順であり、公開承認ではありません。',
  ],
};
writeJson('site/data/quality-rebase-v1.json', qualityPublic);

replaceOnce(
  'scripts/rebuild_quality_scores_v2.mjs',
  "} from './lib/quality_profile_v2.mjs';",
  "} from './lib/quality_profile_v3.mjs';",
);
replaceOnce(
  'scripts/rebuild_quality_scores_v2.mjs',
  "version: 'v43-quality-score-v2',",
  "version: 'v43-quality-score-v3',",
);
replaceOnce(
  'scripts/rebuild_quality_scores_v2.mjs',
  "version: 'quality-score-v2',",
  "version: 'quality-score-v3',",
);
replaceOnce(
  'scripts/rebuild_quality_scores_v2.mjs',
  "fiveStars: 'all eight evidence and review checks must be true',\n    fourStars: 'score >= 65',\n    threeStars: 'score >= 45',\n    twoStars: 'official source confirmed',\n    oneStar: 'coverage only or insufficient evidence',",
  "fiveStars: 'explicit deep verification approval plus all legacy machine checks',\n    fourStars: 'non-template company currently in explicit deep review',\n    threeStars: 'non-template structured company awaiting deep verification',\n    twoStars: 'official source confirmed but template-like or deep review not started',\n    oneStar: 'coverage only or insufficient evidence',",
);
replaceOnce(
  'scripts/rebuild_quality_scores_v2.mjs',
  "path.join(REPORT_DIR, 'QUALITY_SCORE_V2_REPORT.json'),",
  "path.join(REPORT_DIR, 'QUALITY_SCORE_V3_REPORT.json'),",
);

replaceOnce(
  'scripts/validate_quality_score_v2.mjs',
  "  checksToMask,\n} from './lib/quality_profile_v2.mjs';",
  "  checksToMask,\n  hasDeepVerificationApproval,\n} from './lib/quality_profile_v3.mjs';",
);
replaceOnce(
  'scripts/validate_quality_score_v2.mjs',
  "manifest.version === 'v43-quality-score-v2'",
  "manifest.version === 'v43-quality-score-v3'",
);
replaceOnce(
  'scripts/validate_quality_score_v2.mjs',
  "  'five stars require every evidence and review check',\n  companies\n    .filter(company => company.quality.stars === 5)\n    .every(company => company.quality.checkMask === (1 << QUALITY_CHECK_KEYS.length) - 1),",
  "  'five stars require every legacy check and explicit deep verification approval',\n  companies\n    .filter(company => company.quality.stars === 5)\n    .every(company => company.quality.checkMask === (1 << QUALITY_CHECK_KEYS.length) - 1\n      && hasDeepVerificationApproval(company)),",
);
replaceOnce(
  'scripts/validate_quality_score_v2.mjs',
  "check(\n  'source-indexed remains two stars',\n  companies.filter(company => company.stage === 'source_indexed').every(company => company.quality.stars === 2),\n);",
  "check(\n  'template-like companies cannot be three stars or higher without explicit review',\n  companies\n    .filter(company => company.quality?.templateLike && !hasDeepVerificationApproval(company))\n    .every(company => company.quality.stars <= 2),\n);\ncheck(\n  'no legacy five-star carryover',\n  companies.every(company => company.quality.stars !== 5 || hasDeepVerificationApproval(company)),\n);",
);

replaceOnce(
  'scripts/audit_production_readiness_v1.mjs',
  "import { hasCompletedProgressAssessment } from './lib/quality_profile_v2.mjs';",
  "import {\n  hasCompletedProgressAssessment,\n  hasDeepVerificationApproval,\n  isTemplateLike,\n} from './lib/quality_profile_v3.mjs';",
);
replaceOnce(
  'scripts/audit_production_readiness_v1.mjs',
  "    independentDoubleCheckApproved: approvals.length >= target.minimumProductionApprovals\n      && (!target.reviewerIndependenceRequired || distinctReviewers.length >= target.minimumProductionApprovals),",
  "    independentDoubleCheckApproved: approvals.length >= target.minimumProductionApprovals\n      && (!target.reviewerIndependenceRequired || distinctReviewers.length >= target.minimumProductionApprovals),\n    templateSpecificity: !isTemplateLike(company),\n    deepVerificationApproved: hasDeepVerificationApproval(company),",
);
replaceOnce(
  'scripts/audit_production_readiness_v1.mjs',
  'const currentProduction = byStage.core;',
  'const currentProduction = count(row => row.checks.deepVerificationApproved);',
);

replaceOnce(
  'scripts/build_frontend_data_shards_v1.mjs',
  "      score: company.quality.score,\n    } : null,",
  "      score: company.quality.score,\n      label: company.quality.label,\n      templateLike: company.quality.templateLike === true,\n      deepVerificationStatus: company.quality.deepVerificationStatus || 'not_started',\n      deepVerified: company.quality.deepVerified === true,\n    } : null,",
);

const target = readJson('operations/production-quality/production-quality-target-v1.json');
target.targetProductionCompanies = 500;
target.qualityPrinciple = '全文精読、正式中計判定、項目別ページ証跡、年度・単位・連結範囲の数値検査、二段階承認を満たした企業だけを深掘り確認済みとして扱う';
target.requiredMachineChecks = [
  'officialSource',
  'publicationDate',
  'pageEvidence',
  'structuredAnalysis',
  'metricExtraction',
  'progressConnected',
  'freshness',
  'templateSpecificity',
];
target.requiredApprovalChecks = [
  'productionReviewApproved',
  'independentDoubleCheckApproved',
  'deepVerificationApproved',
];
target.targetSetAt = '2026-08-01';
target.notes = [
  'Phase 2の目標は深掘り確認済み500社。Phase 1の50社を含む。',
  '旧stage=core、旧5つ星、旧productionApprovalだけでは深掘り確認済みとしない。',
  'テンプレート文が残る企業は深掘り承認できない。',
  '自動事実補完、自動選定、自動承認、自動本番昇格を禁止する。',
  '未開示項目は未開示として記録し、推計値で要件を満たしてはならない。',
];
writeJson('operations/production-quality/production-quality-target-v1.json', target);

replaceOnce(
  'site/index.html',
  '日本上場企業3,000社の中期経営計画を、戦略の違いから探し、保存・比較・理解・調査するポータルです。',
  '日本上場企業3,000社の中期経営計画関連資料を探し、確認状況を区別して比較・理解・調査するポータルです。',
);
replaceOnce(
  'site/index.html',
  '日本上場企業3,000社の中期経営計画を、戦略の違いから探し、比較・理解・調査するポータルです。',
  '日本上場企業3,000社の中期経営計画関連資料を、確認状況を区別して比較・理解・調査するポータルです。',
);
replaceOnce(
  'site/index.html',
  '<div><dt>中計ソース確認済み</dt><dd id="stat-confirmed">3,000社</dd></div>',
  '<div><dt>再監査対象</dt><dd id="stat-confirmed">315社</dd></div>',
);
replaceOnce(
  'site/index.html',
  '<div><dt>主要論点構造化済み</dt><dd id="stat-structured">3,000社</dd></div>',
  '<div><dt>深掘り確認済み</dt><dd id="stat-structured">0社</dd></div>',
);
replaceOnce(
  'site/index.html',
  '<div><dt>進捗目標・実績</dt><dd id="stat-progress">353件</dd></div>',
  '<div><dt>実績接続</dt><dd id="stat-progress">72社 / 258件</dd></div>',
);
replaceOnce(
  'site/index.html',
  '<button class="preset-button" type="button" data-workspace-preset="quality"><strong>本番データから探す</strong><span>公式資料と人手レビューを確認済み</span></button>',
  '<button class="preset-button" type="button" data-workspace-preset="quality"><strong>再監査対象から探す</strong><span>構造化済み315社を優先して確認</span></button>',
);
replaceOnce(
  'site/index.html',
  '<option value="core">本番</option>',
  '<option value="core">資料登録済み（再監査中）</option>',
);
replaceOnce(
  'site/index.html',
  '<p>現在掲載する3,000社はすべて本番品質です。今後追加する企業は確認状況に応じて段階表示し、未確認情報は推測で補いません。</p><dl class="quality-list"><div><dt>★★★★★ 本番</dt><dd>公式資料、主要論点、数値、ページ証跡、一次レビュー、独立再検証を確認。</dd></div><div><dt>★★★★☆〜★★★☆☆ 詳細抽出済みβ</dt><dd>主要論点を構造化。本番昇格前の確認項目が残る場合があります。</dd></div><div><dt>★★☆☆☆ 一次確認β</dt><dd>会社公式IRの起点を確認。中計本文の詳細抽出前です。</dd></div><div><dt>★☆☆☆☆ カバレッジβ</dt><dd>JPX上場情報を確認した企業探索用データ。中計資料は未特定で、スコア算定対象外です。</dd></div></dl>',
  '<p>掲載3,000社は企業カバレッジ件数です。旧5つ星は機械項目の充足を示す旧評価で、全文精読を証明しないため廃止しました。深掘り確認済みは新基準の二段階承認が完了した企業だけです。</p><dl class="quality-list"><div><dt>★★★★★ 深掘り確認済み</dt><dd>正式中計、全文精読、戦略・数値・資本政策、項目別証跡、年度・単位・連結範囲、独立再確認を完了。</dd></div><div><dt>★★★★☆ 深掘りレビュー中</dt><dd>新基準で原文突合と別確認者レビューを進めています。</dd></div><div><dt>★★★☆☆ 再監査対象</dt><dd>構造化済みですが、新基準の深掘り承認は未完了です。</dd></div><div><dt>★★☆☆☆ 資料確認済み</dt><dd>テンプレート型データを含み、正式中計の再探索・全文確認が必要です。</dd></div><div><dt>★☆☆☆☆ カバレッジのみ</dt><dd>企業探索用の基礎情報です。</dd></div></dl>',
);

replaceOnce(
  'site/assets/app.js',
  "const stageLabels = { core: '本番', detailed_extracted: '詳細抽出済みβ', source_indexed: '一次確認β', jpx_indexed: 'カバレッジβ' };",
  "const stageLabels = { core: '資料登録済み（再監査中）', detailed_extracted: '詳細抽出済みβ', source_indexed: '一次確認β', jpx_indexed: 'カバレッジβ' };",
);
replaceOnce(
  'site/assets/app.js',
  "function updateStats() {\n  const companies = state.data.companies;\n  const actualRows = state.data.progress.filter(row => row.actualValue != null).length;\n  $('#stat-total').textContent = `${companies.length}社`;\n  $('#stat-confirmed').textContent = `${companies.filter(c => c.stage !== 'jpx_indexed').length}社`;\n  $('#stat-structured').textContent = `${companies.filter(c => ['core', 'detailed_extracted'].includes(c.stage)).length}社`;\n  $('#stat-progress').textContent = `${state.data.progress.length}件（実績${actualRows}件）`;\n}",
  "async function updateStats() {\n  const companies = state.data.companies;\n  $('#stat-total').textContent = `${companies.length}社`;\n  try {\n    const quality = await fetch('./data/quality-rebase-v1.json', { cache: 'no-cache' }).then(response => {\n      if (!response.ok) throw new Error('quality-rebase-v1.json');\n      return response.json();\n    });\n    $('#stat-confirmed').textContent = `${quality.counts.reAuditPool}社`;\n    $('#stat-structured').textContent = `${quality.counts.deepVerified}社`;\n    $('#stat-progress').textContent = `${quality.counts.actualConnectedCompanies}社 / ${quality.counts.actualConnectedRecords}件`;\n  } catch {\n    const actualRows = state.data.progress.filter(row => row.actualValue != null).length;\n    $('#stat-confirmed').textContent = '再集計中';\n    $('#stat-structured').textContent = `${companies.filter(c => c.quality?.deepVerified).length}社`;\n    $('#stat-progress').textContent = `${actualRows}件`;\n  }\n}",
);

replaceOnce(
  'site/quality.html',
  '<article class="dashboard-card"><h3>品質スコア</h3>',
  '<article class="dashboard-card"><h3>再監査後の品質区分</h3>',
);
replaceOnce(
  'site/quality.html',
  '<article class="dashboard-card"><h3>データ状態</h3>',
  '<article class="dashboard-card"><h3>旧データ状態（参考）</h3>',
);
replaceOnce(
  'site/quality.html',
  '<p class="eyebrow">Promotion Queue</p><h2 id="queue-title">本番品質化のレビュー候補</h2><p>詳細抽出済みβを、文書上の確認材料が揃っている順に並べます。候補であっても、原文突合・別確認者レビュー・表示監査が終わるまで本番には昇格しません。</p>',
  '<p class="eyebrow">Deep Review Queue</p><h2 id="queue-title">Phase 1 深掘りレビュー候補50社</h2><p>正式な中計資料、直近性、市場比率、業種分散を考慮した処理順です。候補であっても、全文精読・項目別証跡・数値定義検査・別確認者レビューが終わるまで深掘り確認済みにはなりません。</p>',
);
replaceOnce(
  'site/quality.html',
  '品質ダッシュボードは公開データから自動生成されています。未確認情報は推測で補完せず、本番昇格には人手レビューを必要とします。',
  '品質ダッシュボードは公開データと再監査台帳から生成しています。未確認情報は推測で補完せず、深掘り確認済みには全文精読と独立した人手レビューを必要とします。',
);

write('site/assets/quality.js', `const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const SL={core:'資料登録済み（再監査中）',detailed_extracted:'詳細抽出済みβ',source_indexed:'一次確認β',jpx_indexed:'カバレッジβ'};
const STAR_LABELS={5:'深掘り確認済み',4:'深掘りレビュー中',3:'再監査対象',2:'資料確認済み・深掘り前',1:'カバレッジのみ'};
const CL={officialSource:'公式資料URL',publicationDate:'資料公表日',pageEvidence:'一次証跡',structuredAnalysis:'主要論点の構造化',metricExtraction:'数値・方針の抽出',progressConnected:'進捗評価',templateSpecificity:'テンプレート文の除去',deepVerificationApproved:'新基準の二段階承認'};
const HR=['正式な中計資料であることを確認','PDF全文を精読','戦略・数値・資本政策を構造化','各項目へ証跡ページを紐付け','年度・単位・連結範囲を検査','独立した別確認者が再確認'];
let D;
async function loadBundle(){if(!('DecompressionStream'in window))throw Error('圧縮データの展開に対応していません。');const m=await fetch('./data/bundle.manifest.json',{cache:'no-cache'}).then(r=>r.ok?r.json():Promise.reject(Error('マニフェストを取得できません。'))),bs=await Promise.all(m.parts.map(p=>fetch(\`./data/\${p.file}\`).then(r=>r.ok?r.arrayBuffer():Promise.reject(Error(\`\${p.file}を取得できません。\`))))),b=new Uint8Array(bs.reduce((n,x)=>n+x.byteLength,0));let o=0;for(const x of bs){b.set(new Uint8Array(x),o);o+=x.byteLength}const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');if(h!==m.sha256)throw Error('データ整合性の確認に失敗しました。');return JSON.parse(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text())}
async function load(){const [bundle,rebase]=await Promise.all([loadBundle(),fetch('./data/quality-rebase-v1.json',{cache:'no-cache'}).then(r=>r.ok?r.json():Promise.reject(Error('再監査データを取得できません。')))]);return{bundle,rebase}}
const evidence=x=>/(?:PDF\\s+p\\.?\\s*\\d|p\\.?\\s*\\d|ページ\\s*\\d|図版\\s*\\d)/i.test(String(x))||/^公式Webページ（見出し[:：]\\s*[^）]{2,}）[:：]\\s*\\S.{7,}$/i.test(String(x)),page=c=>(c.evidenceRefs||[]).some(evidence),progress=c=>c.flags?.progress===true||(['connected','not_comparable','not_disclosed'].includes(c.progressAssessment?.status)&&String(c.progressAssessment?.reason||'').trim().length>=20&&Boolean(String(c.progressAssessment?.sourceRef||'').trim()));
function build(x){const C=x.bundle.companies,P=x.bundle.progress,R=x.rebase,S=Object.keys(SL),byCode=new Map(C.map(c=>[String(c.code),c])),Q=(R.phase1?.companies||[]).map(q=>{const c=byCode.get(String(q.code))||{};return{...q,stars:c.quality?.stars??null,label:c.quality?.label||'',missing:[!String(c.sourceUrl||'').startsWith('https://')&&'officialSource',!c.planPublishedDate&&'publicationDate',!page(c)&&'pageEvidence',c.quality?.templateLike&&'templateSpecificity',!c.quality?.deepVerified&&'deepVerificationApproved'].filter(Boolean)}});return{date:R.referenceDate||C.map(c=>c.lastVerifiedDate).filter(Boolean).sort().at(-1)||'未確認',rebase:R,sum:{total:C.length,deep:R.counts.deepVerified,review:R.counts.deepReviewInProgress,reAudit:R.counts.reAuditPool,template:R.counts.templateReviewRequired,earnings:R.counts.strictEarningsReleaseReSearch,rows:R.counts.progressRecords,pc:R.counts.progressCompanies,actualRows:R.counts.actualConnectedRecords,actualCompanies:R.counts.actualConnectedCompanies,phase1:R.counts.phase1Selected,phase2:R.counts.phase2AdditionalQueued,broken:R.counts.knownBrokenLinks,evidence:R.counts.evidenceCandidates},stars:[5,4,3,2,1].map(stars=>({stars,count:C.filter(c=>c.quality?.stars===stars).length})),stages:S.map(stage=>({label:SL[stage],count:C.filter(c=>c.stage===stage).length})),audit:[5,4,3,2,1].map(stars=>{const a=C.filter(c=>c.quality?.stars===stars);return{label:STAR_LABELS[stars],n:a.length,source:a.filter(c=>String(c.sourceUrl||'').startsWith('https://')).length,pub:a.filter(c=>c.planPublishedDate).length,page:a.filter(page).length,progress:a.filter(progress).length,verified:a.filter(c=>c.lastVerifiedDate).length}}),queue:Q}}
const card=(l,v,n)=>\`<article class="quality-stat"><span>\${esc(l)}</span><strong>\${esc(v)}</strong><small>\${esc(n)}</small></article>\`,ratio=(v,n)=>\`<span class="ratio"><strong>\${v}</strong><small> / \${n}</small></span>\`,starText=n=>\`\${'★'.repeat(n)}\${'☆'.repeat(5-n)} \${STAR_LABELS[n]}\`;
function bars(sel,a,label){const m=Math.max(...a.map(x=>x.count),1);$(sel).innerHTML=a.map(x=>\`<div class="bar-row"><div><strong>\${esc(label(x))}</strong><span>\${x.count}社</span></div><div class="bar-track"><span style="width:\${(x.count/m*100).toFixed(1)}%"></span></div></div>\`).join('')}
function render(){const s=D.sum;$('#quality-updated').textContent=\`データ基準日 \${D.date}\`;$('#quality-summary').innerHTML=[['掲載企業',\`\${s.total}社\`,'企業カバレッジ件数'],['深掘り確認済み',\`\${s.deep}社\`,'新基準の二段階承認済み'],['再監査対象',\`\${s.reAudit}社\`,'非テンプレート315社'],['テンプレート型',\`\${s.template}社\`,'資料確認済み以下へ適正化'],['決算短信の再探索',\`\${s.earnings}社\`,'正式な中計資料を再探索'],['進捗データ',\`\${s.pc}社 / \${s.rows}件\`,\`実績接続 \${s.actualCompanies}社 / \${s.actualRows}件\`],['Phase 1',\`\${s.phase1}社\`,'Prime 25・Standard 15・Growth 10'],['Phase 2追加キュー',\`\${s.phase2}社\`,'50社×9バッチ'],['証跡候補',\`\${s.evidence}社\`,'個別レビュー対象'],['既知404',\`\${s.broken}件\`,'修復キュー']].map(x=>card(...x)).join('');bars('#star-distribution',D.stars,x=>starText(x.stars));bars('#stage-distribution',D.stages,x=>x.label);$('#audit-body').innerHTML=D.audit.map(x=>\`<tr><th scope="row">\${esc(x.label)}</th><td>\${x.n}</td><td>\${ratio(x.source,x.n)}</td><td>\${ratio(x.pub,x.n)}</td><td>\${ratio(x.page,x.n)}</td><td>\${ratio(x.progress,x.n)}</td><td>\${ratio(x.verified,x.n)}</td></tr>\`).join('');$('#machine-checks').innerHTML=Object.values(CL).map(x=>\`<li><span>\${esc(x)}</span></li>\`).join('');$('#human-checks').innerHTML=HR.map(x=>\`<li>\${esc(x)}</li>\`).join('');queue()}
function queue(){const q=$('#queue-search').value.trim().toLowerCase(),p=$('#queue-priority').value,a=D.queue.filter(x=>(!q||\`\${x.code} \${x.name}\`.toLowerCase().includes(q))&&(!p||((x.templatePatternIds||[]).length?'B':'A')===p));$('#queue-summary').textContent=\`\${a.length}社を表示\`;$('#queue-body').innerHTML=a.map(x=>{const priority=(x.templatePatternIds||[]).length?'B':'A';return\`<tr data-company-code="\${esc(x.code)}"><td><span class="priority priority-\${priority}">\${priority}</span></td><th scope="row"><strong>\${esc(x.name)}</strong><small>\${esc(x.code)}・\${esc(x.market)}・\${esc(x.industry)}</small></th><td><strong>処理順 \${x.order}</strong><small>\${esc(x.label||starText(x.stars||2))}</small></td><td>\${esc(x.missing.length?x.missing.map(k=>CL[k]).join('、'):'候補選定条件を充足')}</td><td>\${esc(HR.join('、'))}</td><td><a class="text-link" href="./#company=\${encodeURIComponent(x.code)}">企業詳細</a></td></tr>\`}).join('')||'<tr class="empty-row"><td colspan="6">条件に一致する企業がありません。</td></tr>'}
$('#queue-filters').addEventListener('input',queue);$('#queue-filters').addEventListener('reset',()=>setTimeout(queue));
try{D=build(await load());render()}catch(e){$('#quality-error').hidden=false;$('#quality-error').textContent=\`品質ダッシュボードを読み込めませんでした: \${e.message}\`;console.error(e)}
`);

const readmeSection = `## Current data release\n\n2026-08-01のPhase 0再監査で、旧「3,000社すべて5つ星」を廃止し、掲載件数と深掘り確認済み件数を分離しました。\n\n- 掲載企業: **3,000社**\n- 深掘り確認済み（新基準）: **0社**\n- 再監査母集団（非テンプレート型）: **315社**\n- うちPhase 1の厳格候補: **50社**\n- テンプレート型・深掘り前: **2,685社**\n- 資料名が決算短信で正式中計を再探索する企業: **610社**\n- 広義の決算関連資料: **987社**\n- 進捗レコード: **353件 / 100社**\n- 目標と実績を接続済み: **258件 / 72社**\n- 証跡候補レビュー対象: **116社**\n- 既知404: **6件**\n- Phase 2追加キュー: **450社（50社×9バッチ）**\n\n旧5つ星は、項目が埋まっていること、旧レビュー記録、証跡文字列などの機械条件を評価しており、PDF全文の精読を証明していませんでした。新基準では、正式中計の確認、全文精読、戦略・数値・資本政策の構造化、項目別ページ証跡、年度・単位・連結範囲の検査、独立した再確認をすべて満たした企業だけを「深掘り確認済み」とします。\n\nPhase 1の50社とPhase 2の追加450社は処理キューであり、承認済み件数ではありません。自動抽出や候補選定によって深掘り承認を付与しません。\n\n`;
replaceRegex(
  'README.md',
  /## Current data release\n[\s\S]*?## Quality policy\n/,
  `${readmeSection}## Quality policy\n`,
);
replaceOnce(
  'README.md',
  '## Development priority after 3,000 production companies',
  '## Development priority after Phase 0 quality rebase',
);
replaceRegex(
  'README.md',
  /## Development priority after Phase 0 quality rebase\n[\s\S]*$/,
  `## Development priority after Phase 0 quality rebase\n\n1. Phase 1の50社を新工程で全文精読し、抽出精度・所要工数・差戻し率を測定する\n2. Phase 2で深掘り確認済み500社まで50社単位で拡張する\n3. 610社の決算短信起点データから正式な中計資料を再探索する\n4. 116社の証跡候補と6件の404を解消する\n5. 353件の進捗データを企業詳細へ同期し、72社・258件の実績接続を維持する\n6. 新中計・改定・決算更新の日次検知と週次公開を定常化する\n7. 品質基準や承認手続きを件数のために緩めず、1,000社へ段階拡張する\n`,
);

const release = readJson('site/data/release-status.json');
release.updatedAt = '2026-08-01';
release.repository.release = 'Phase 0 Quality Rebase / Phase 1-2 Queue';
release.repository.launchCandidateBranch = 'agent/quality-rebase-phase0-2';
release.repository.companies = 3000;
release.repository.sourceConfirmed = 3000;
release.repository.structured = 315;
release.repository.production = 0;
release.repository.deepVerified = 0;
release.repository.reAuditPool = 315;
release.repository.templateReviewRequired = 2685;
release.repository.strictEarningsReleaseReSearch = 610;
release.repository.detailedBeta = 0;
release.repository.sourceIndexed = 0;
release.repository.coverageBeta = 0;
release.repository.progressCompanies = 100;
release.repository.progressRows = 353;
release.repository.actualCompanies = 72;
release.repository.actualRows = 258;
release.repository.qualityDebt = 3000;
release.repository.phase1Selected = 50;
release.repository.phase2Queued = 450;
release.repository.knownBrokenLinks = 6;
release.sync.status = 'quality_rebase_in_progress';
release.sync.label = '品質再監査中';
release.sync.pending = [
  'Phase 1の50社を新工程で全文精読し、二段階承認を完了する',
  'Phase 2追加450社を50社単位で処理し、深掘り確認済み500社へ到達する',
  '証跡候補116社をレビューする',
  '既知404 6件を修復する',
  '品質表示の公開反映後に公開URLを再監査する',
];
writeJson('site/data/release-status.json', release);
writeJson('operations/site-sync/current.json', release);

replaceOnce(
  'scripts/validate_public_launch_v1.mjs',
  "  assert(value.repository.production === 3000, `${label}の本番品質が3,000社ではありません。`);",
  "  assert(value.repository.production === 0, `${label}の深掘り確認済みがPhase 0基準の0社ではありません。`);\n  assert(value.repository.reAuditPool === 315, `${label}の再監査母集団が315社ではありません。`);\n  assert(value.repository.templateReviewRequired === 2685, `${label}のテンプレート型が2,685社ではありません。`);\n  assert(value.repository.strictEarningsReleaseReSearch === 610, `${label}の決算短信再探索対象が610社ではありません。`);\n  assert(value.repository.actualCompanies === 72, `${label}の実績接続企業が72社ではありません。`);\n  assert(value.repository.actualRows === 258, `${label}の実績接続レコードが258件ではありません。`);",
);
replaceOnce(
  'scripts/validate_public_launch_v1.mjs',
  "  assert(value.repository.qualityDebt === 0, `${label}の品質負債が0ではありません。`);",
  "  assert(value.repository.qualityDebt === 3000, `${label}の深掘り未完了件数が3,000社ではありません。`);",
);

runNode('scripts/rebuild_quality_scores_v2.mjs');
runNode('scripts/build_frontend_data_shards_v1.mjs');
runNode('scripts/audit_production_readiness_v1.mjs');
runNode('scripts/validate_quality_score_v2.mjs');
runNode('scripts/validate_public_launch_v1.mjs');

const finalAudit = readJson('operations/production-quality/production-readiness-v1.json');
if (finalAudit.currentProduction !== 0) throw new Error(`Expected 0 deep-verified companies, got ${finalAudit.currentProduction}`);
if (finalAudit.targetProduction !== 500) throw new Error(`Expected Phase 2 target 500, got ${finalAudit.targetProduction}`);
const scoreReport = readJson('reports/v43/QUALITY_SCORE_V3_REPORT.json');
if (scoreReport.after['5'] !== 0) throw new Error(`Expected no five-star carryover, got ${scoreReport.after['5']}`);
if (scoreReport.after['2'] !== 2685) throw new Error(`Expected 2,685 two-star template companies, got ${scoreReport.after['2']}`);
if (scoreReport.after['3'] !== 315) throw new Error(`Expected 315 three-star re-audit companies, got ${scoreReport.after['3']}`);

writeJson('operations/quality-rebase/phase0-application-result-v1.json', {
  schemaVersion: 'quality-rebase-phase0-application-result-v1',
  appliedAt: new Date().toISOString(),
  bundleSha256: finalAudit.bundleSha256,
  qualityDistribution: scoreReport.after,
  deepVerified: finalAudit.currentProduction,
  phase2Target: finalAudit.targetProduction,
  reAuditPool: reconciliation.companies.nonTemplatePool,
  templateReviewRequired: reconciliation.companies.templateLike,
  strictEarningsReleaseReSearch: reconciliation.companies.strictEarningsRelease,
  progressRecords: reconciliation.progress.records,
  actualConnectedCompanies: reconciliation.progress.explicitlyConnectedCompanies,
  actualConnectedRecords: reconciliation.progress.explicitlyConnectedRecords,
  phase1Selected: phase1.companies.length,
  phase2QueuedAdditional: phase2.queuedAdditional,
  automaticDeepApprovalAllowed: false,
});

console.log('Phase 0 quality rebase applied successfully.');
