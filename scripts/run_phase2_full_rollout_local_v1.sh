#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${PYTHON_BIN:-python3}"
START_BATCH="${START_BATCH:-2}"
END_BATCH="${END_BATCH:-10}"
START_WAVE="${START_WAVE:-1}"
CHECKPOINT_ROOT="operations/quality-rebase/phase2/local-checkpoints"
LOG_ROOT="operations/quality-rebase/phase2/local-logs"

mkdir -p "$CHECKPOINT_ROOT" "$LOG_ROOT"

if ! [[ "$START_BATCH" =~ ^([2-9]|10)$ ]] || ! [[ "$END_BATCH" =~ ^([2-9]|10)$ ]]; then
  echo "START_BATCH and END_BATCH must be between 2 and 10" >&2
  exit 2
fi
if (( START_BATCH > END_BATCH )); then
  echo "START_BATCH must be <= END_BATCH" >&2
  exit 2
fi
if ! [[ "$START_WAVE" =~ ^[1-5]$ ]]; then
  echo "START_WAVE must be between 1 and 5" >&2
  exit 2
fi

"$PYTHON_BIN" scripts/audit_phase2_rollout_readiness_v1.py

for batch in $(seq "$START_BATCH" "$END_BATCH"); do
  batch_id="$(printf '%02d' "$batch")"
  batch_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "=== Phase 2 batch $batch started at $batch_started_at ==="

  for wave in $(seq 1 5); do
    if (( batch == START_BATCH && wave < START_WAVE )); then
      continue
    fi
    wave_id="$(printf '%02d' "$wave")"
    checkpoint="$CHECKPOINT_ROOT/batch-${batch_id}-wave-${wave_id}.done.json"
    log="$LOG_ROOT/batch-${batch_id}-wave-${wave_id}.log"

    if [[ -f "$checkpoint" ]]; then
      echo "Skipping completed batch $batch wave $wave"
      continue
    fi

    echo "Collecting batch $batch wave $wave"
    set +e
    "$PYTHON_BIN" scripts/phase2_bulk_collect_v1.py --batch "$batch" --wave "$wave" 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
    set -e

    "$PYTHON_BIN" - "$batch" "$wave" "$status" "$checkpoint" <<'PY'
import datetime
import json
import pathlib
import sys

batch = int(sys.argv[1])
wave = int(sys.argv[2])
status = int(sys.argv[3])
checkpoint = pathlib.Path(sys.argv[4])
root = pathlib.Path(f'operations/quality-rebase/phase2/bulk-collection/batch-{batch:02d}/wave-{wave:02d}')
summary_path = root / 'summary.json'
summary = json.loads(summary_path.read_text()) if summary_path.exists() else None
record = {
    'schemaVersion': 'phase2-local-rollout-checkpoint-v1',
    'batch': batch,
    'wave': wave,
    'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'processExitCode': status,
    'summaryFound': summary is not None,
    'processedCompanies': summary.get('processedCompanies', 0) if summary else 0,
    'counts': summary.get('counts', {}) if summary else {},
    'automaticApprovalAllowed': False,
    'deepVerificationApproved': 0,
    'status': 'completed' if status == 0 and summary else 'completed_with_collection_errors',
}
checkpoint.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
PY

    if [[ "$status" -ne 0 ]]; then
      echo "Batch $batch wave $wave returned $status; checkpoint saved and rollout continues." >&2
    fi
  done

done

"$PYTHON_BIN" scripts/build_phase2_review_queue_v1.py

"$PYTHON_BIN" - <<'PY'
import json
import pathlib
from collections import Counter

root = pathlib.Path('operations/quality-rebase/phase2')
checkpoints = sorted((root / 'local-checkpoints').glob('batch-*-wave-*.done.json'))
records = [json.loads(path.read_text()) for path in checkpoints]
counts = Counter()
processed = 0
for row in records:
    processed += int(row.get('processedCompanies', 0))
    counts.update(row.get('counts', {}))
report = {
    'schemaVersion': 'phase2-local-full-rollout-summary-v1',
    'checkpointWaves': len(records),
    'expectedWaves': 45,
    'processedCompanySlots': processed,
    'counts': dict(counts),
    'reviewQueueGenerated': (root / 'review-queue-v1.json').exists(),
    'automaticApprovalAllowed': False,
    'deepVerificationApproved': 0,
}
(root / 'local-full-rollout-summary-v1.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
PY

echo "Phase 2 local rollout finished. Review generated reports before committing outputs."
