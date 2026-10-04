from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ADE_REPOSITORY = "M-Osugi1230/autonomous-development-engine"
ADE_CONTROL_REF = "ade-chu-kei"
ADE_API_BASE = f"https://api.github.com/repos/{ADE_REPOSITORY}"
JULES_PROVENANCE_MARKER = "PR created automatically by Jules for task"
JULES_TASK_URL = re.compile(r"https://jules\.google\.com/task/\d+")


class GateError(RuntimeError):
    pass


def _load_event() -> dict[str, Any]:
    path = os.environ.get("GITHUB_EVENT_PATH")
    if not path:
        raise GateError("GITHUB_EVENT_PATH is required")
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise GateError("workflow event must be a JSON object")
    return payload


def _request_json(
    url: str,
    *,
    method: str = "GET",
    token: str | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ADE-Remote-PR-Gate/1.1",
        "Cache-Control": "no-cache",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"

    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise GateError(f"GitHub HTTP {exc.code}: {detail[:800]}") from exc
    except URLError as exc:
        raise GateError(f"GitHub network error: {exc.reason}") from exc

    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise GateError("GitHub returned invalid JSON") from exc


def _github_request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    token = os.environ.get("GITHUB_TOKEN", "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if not token:
        raise GateError("GITHUB_TOKEN is required")
    if "/" not in repository:
        raise GateError("GITHUB_REPOSITORY must be owner/name")
    return _request_json(
        "https://api.github.com" + path,
        method=method,
        token=token,
        payload=payload,
    )


def _ade_head_sha() -> str:
    payload = _request_json(f"{ADE_API_BASE}/commits/{ADE_CONTROL_REF}")
    if not isinstance(payload, dict):
        raise GateError("ADE main commit response must be an object")
    sha = payload.get("sha")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise GateError("ADE main commit SHA is invalid")
    return sha


def _ade_json(relative_path: str, *, ref: str) -> dict[str, Any]:
    path = relative_path.lstrip("/")
    payload = _request_json(f"{ADE_API_BASE}/contents/{path}?ref={ref}")
    if not isinstance(payload, dict):
        raise GateError(f"ADE contract {relative_path} response must be an object")
    encoded = payload.get("content")
    if not isinstance(encoded, str):
        raise GateError(f"ADE contract {relative_path} has no content")
    try:
        raw = base64.b64decode(encoded.replace("\n", ""))
        decoded = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GateError(f"ADE contract {relative_path} is invalid JSON") from exc
    if not isinstance(decoded, dict):
        raise GateError(f"ADE contract {relative_path} must be a JSON object")
    return decoded


def _ade_optional_json(
    relative_path: str,
    *,
    ref: str,
) -> dict[str, Any] | None:
    try:
        return _ade_json(relative_path, ref=ref)
    except GateError as exc:
        if "GitHub HTTP 404:" in str(exc):
            return None
        raise


def _canonical_fingerprint(payload: object) -> str:
    raw = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _authority_false(payload: dict[str, Any], *fields: str) -> None:
    for field in fields:
        if payload.get(field, False) is not False:
            raise GateError(f"review evidence cannot grant {field}")


def _validate_v1_7_review_chain(
    *,
    ade_ref: str,
    repository: str,
    task_id: str,
    accepted_fingerprint: str,
    pr_number: int,
    pr_head_sha: str,
    pr_base_sha: str,
) -> bool:
    clearance = _ade_optional_json(
        ".autodev/multi-agent/review-clearance.json",
        ref=ade_ref,
    )
    if clearance is None:
        return False

    plan = _ade_json(".autodev/multi-agent/plan.json", ref=ade_ref)
    session = _ade_json(
        ".autodev/multi-agent/reviewer-session.json",
        ref=ade_ref,
    )
    contribution = _ade_json(
        ".autodev/multi-agent/reviewer-contribution.json",
        ref=ade_ref,
    )
    reconciliation = _ade_json(
        ".autodev/multi-agent/reconciliation.json",
        ref=ade_ref,
    )
    checkpoint = _ade_json(
        ".autodev/runtime/checkpoint.json",
        ref=ade_ref,
    )

    for name, payload in (
        ("clearance", clearance),
        ("plan", plan),
        ("session", session),
        ("contribution", contribution),
        ("reconciliation", reconciliation),
    ):
        if payload.get("schema_version") != 1:
            raise GateError(f"v1.7 {name} schema_version is invalid")

    plan_fp = _canonical_fingerprint(plan)
    if (
        plan.get("repository") != repository
        or plan.get("source_sha") != pr_base_sha
        or plan.get("campaign_id") is None
        or plan.get("task_id") != task_id
        or plan.get("accepted_plan_fingerprint") != accepted_fingerprint
    ):
        raise GateError("v1.7 MultiAgentPlan trust anchor mismatch")
    _authority_false(
        plan,
        "execution_authority",
        "auto_dispatch",
        "merge_authority",
        "acceptance_authority",
        "may_expand_scope",
    )
    assignments = plan.get("assignments")
    if not isinstance(assignments, list):
        raise GateError("v1.7 MultiAgentPlan assignments are invalid")
    reviewer = next(
        (
            item
            for item in assignments
            if isinstance(item, dict) and item.get("role") == "REVIEWER"
        ),
        None,
    )
    implementer = next(
        (
            item
            for item in assignments
            if isinstance(item, dict) and item.get("role") == "IMPLEMENTER"
        ),
        None,
    )
    if reviewer is None or implementer is None:
        raise GateError(
            "v1.7 MultiAgentPlan requires implementer and reviewer"
        )
    reviewer_fp = _canonical_fingerprint(reviewer)

    if (
        session.get("state") != "COMPLETED"
        or session.get("plan_fingerprint") != plan_fp
        or session.get("assignment_id") != reviewer.get("assignment_id")
        or session.get("assignment_fingerprint") != reviewer_fp
        or session.get("role") != "REVIEWER"
        or session.get("provider_id") != reviewer.get("provider_id")
        or session.get("repository") != repository
        or session.get("source_sha") != pr_base_sha
        or session.get("task_id") != task_id
        or session.get("accepted_plan_fingerprint")
        != accepted_fingerprint
    ):
        raise GateError("v1.7 reviewer RoleSession trust anchor mismatch")
    _authority_false(
        session,
        "execution_authority",
        "merge_authority",
        "acceptance_authority",
        "may_expand_scope",
    )
    reviewer_session_id = session.get("provider_session_id")
    if not isinstance(reviewer_session_id, str) or not reviewer_session_id:
        raise GateError("v1.7 reviewer provider session is missing")
    if (
        checkpoint.get("task_id") != task_id
        or checkpoint.get("state") != "COMPLETED"
    ):
        raise GateError("v1.7 implementer checkpoint is not completed")
    implementer_session_id = checkpoint.get("provider_session_id")
    if (
        not isinstance(implementer_session_id, str)
        or not implementer_session_id
        or implementer_session_id == reviewer_session_id
    ):
        raise GateError(
            "v1.7 reviewer must use an independent provider session"
        )

    session_fp = _canonical_fingerprint(session)
    if (
        contribution.get("verdict") != "CLEAR"
        or contribution.get("role") != "REVIEWER"
        or contribution.get("repository") != repository
        or contribution.get("source_sha") != pr_base_sha
        or contribution.get("task_id") != task_id
        or contribution.get("accepted_plan_fingerprint")
        != accepted_fingerprint
        or contribution.get("multi_agent_plan_fingerprint") != plan_fp
        or contribution.get("assignment_id") != reviewer.get("assignment_id")
        or contribution.get("assignment_fingerprint") != reviewer_fp
        or contribution.get("provider_id") != reviewer.get("provider_id")
        or contribution.get("advisory_only") is not True
    ):
        raise GateError("v1.7 reviewer contribution is not trusted CLEAR evidence")
    _authority_false(
        contribution,
        "execution_authority",
        "code_mutation_authority",
        "campaign_state_authority",
        "acceptance_authority",
        "merge_authority",
        "runtime_verification_authority",
        "auto_dispatch",
        "may_expand_scope",
    )
    contribution_fp = _canonical_fingerprint(contribution)

    contribution_fps = reconciliation.get("contribution_fingerprints")
    if (
        reconciliation.get("disposition") != "CLEAR"
        or reconciliation.get("repository") != repository
        or reconciliation.get("source_sha") != pr_base_sha
        or reconciliation.get("task_id") != task_id
        or reconciliation.get("accepted_plan_fingerprint")
        != accepted_fingerprint
        or reconciliation.get("multi_agent_plan_fingerprint") != plan_fp
        or not isinstance(contribution_fps, list)
        or contribution_fp not in contribution_fps
        or reconciliation.get("majority_voting") is not False
    ):
        raise GateError("v1.7 reconciliation is not trusted CLEAR evidence")
    _authority_false(
        reconciliation,
        "execution_authority",
        "merge_authority",
        "acceptance_authority",
        "runtime_verification_authority",
    )
    reconciliation_fp = _canonical_fingerprint(reconciliation)

    if (
        clearance.get("verdict") != "CLEAR"
        or clearance.get("advisory_evidence_only") is not True
        or clearance.get("task_id") != task_id
        or clearance.get("target_repository") != repository
        or clearance.get("plan_source_sha") != pr_base_sha
        or clearance.get("reviewed_head_sha") != pr_head_sha
        or clearance.get("pull_request_number") != pr_number
        or clearance.get("accepted_plan_fingerprint")
        != accepted_fingerprint
        or clearance.get("multi_agent_plan_fingerprint") != plan_fp
        or clearance.get("reviewer_assignment_id")
        != reviewer.get("assignment_id")
        or clearance.get("reviewer_assignment_fingerprint") != reviewer_fp
        or clearance.get("reviewer_role_session_fingerprint") != session_fp
        or clearance.get("contribution_fingerprint") != contribution_fp
        or clearance.get("reconciliation_fingerprint")
        != reconciliation_fp
        or clearance.get("reviewer_provider_id") != reviewer.get("provider_id")
    ):
        raise GateError("v1.7 review clearance does not bind trusted evidence")
    _authority_false(
        clearance,
        "execution_authority",
        "code_mutation_authority",
        "campaign_state_authority",
        "merge_authority",
        "acceptance_authority",
        "runtime_verification_authority",
        "auto_dispatch",
        "may_expand_scope",
    )
    return True


def _github_list_pr_files(
    repository: str,
    pr_number: int,
    *,
    page_size: int = 100,
    max_pages: int = 20,
) -> list[dict[str, Any]]:
    if type(pr_number) is not int or pr_number < 1:
        raise GateError("pull request number must be positive")
    if type(page_size) is not int or not 1 <= page_size <= 100:
        raise GateError("page_size must be between 1 and 100")
    if type(max_pages) is not int or max_pages < 1:
        raise GateError("max_pages must be positive")

    result: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        payload = _github_request(
            "GET",
            f"/repos/{repository}/pulls/{pr_number}/files"
            f"?per_page={page_size}&page={page}",
        )
        if not isinstance(payload, list):
            raise GateError("pull request files response must be a list")
        items = [item for item in payload if isinstance(item, dict)]
        result.extend(items)
        if len(payload) < page_size:
            return result
    raise GateError("pull request files pagination exceeded trusted page budget")


def _validate_remote_receipt(
    receipt: dict[str, Any],
    *,
    repository: str,
    task_id: str,
    pr_number: int,
) -> None:
    if receipt.get("schema_version") != 1:
        raise GateError("ADE remote receipt schema_version is invalid")
    if receipt.get("status") != "PR_CREATED":
        raise GateError("ADE remote receipt is not PR_CREATED")
    if receipt.get("task_id") != task_id:
        raise GateError("ADE remote receipt task_id does not match current task")
    if receipt.get("target_repository") != repository:
        raise GateError("ADE remote receipt target_repository does not match this repository")
    expected_url = f"https://github.com/{repository}/pull/{pr_number}"
    if receipt.get("pull_request_url") != expected_url:
        raise GateError("ADE remote receipt does not bind this pull request")


def _current_contract(
    *,
    pr_number: int,
    ade_ref: str | None = None,
) -> tuple[str, tuple[str, ...], str, str, str | None, str]:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    ade_ref = ade_ref or _ade_head_sha()
    state = _ade_json(".autodev/state.json", ref=ade_ref)
    accepted = _ade_json(".autodev/accepted-plan.json", ref=ade_ref)
    campaign = _ade_json(".autodev/campaign.json", ref=ade_ref)
    graph = _ade_json(".autodev/task-graph.json", ref=ade_ref)
    receipt = _ade_json(".autodev/runtime/remote-execution.json", ref=ade_ref)

    metadata = state.get("metadata")
    if not isinstance(metadata, dict):
        raise GateError("ADE state metadata is invalid")
    if metadata.get("target_repository") != repository:
        raise GateError("ADE current target_repository does not match this repository")

    task_id = state.get("current_task_id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise GateError("ADE has no current external task")
    if state.get("status") not in {"READY", "RUNNING"}:
        raise GateError(f"ADE project state is not executable: {state.get('status')}")

    accepted_fingerprint = accepted.get("fingerprint")
    if accepted.get("status") != "ACCEPTED" or not isinstance(
        accepted_fingerprint, str
    ):
        raise GateError("ADE AcceptedPlan is not accepted")
    if metadata.get("accepted_plan_fingerprint") != accepted_fingerprint:
        raise GateError("ADE state and AcceptedPlan fingerprint do not reconcile")

    plan = accepted.get("plan")
    if not isinstance(plan, dict):
        raise GateError("ADE AcceptedPlan plan is invalid")
    tasks = plan.get("tasks")
    if not isinstance(tasks, list):
        raise GateError("ADE AcceptedPlan tasks are invalid")

    task: dict[str, Any] | None = None
    for candidate in tasks:
        if isinstance(candidate, dict) and candidate.get("task_id") == task_id:
            task = candidate
            break
    if task is None:
        raise GateError("ADE current task is absent from AcceptedPlan")

    allowed = task.get("allowed_paths")
    if not isinstance(allowed, list) or not allowed:
        raise GateError("ADE current task has no allowed_paths")
    allowed_paths: list[str] = []
    for value in allowed:
        if not isinstance(value, str) or not value.strip():
            raise GateError("ADE allowed_paths contains an invalid value")
        if (
            value.startswith("/")
            or ".." in value.split("/")
            or value.startswith((".github/", ".autodev/"))
        ):
            raise GateError(f"ADE allowed path is unsafe: {value}")
        allowed_paths.append(value)

    campaign_id = metadata.get("campaign_id")
    if campaign.get("campaign_id") != campaign_id:
        raise GateError("ADE Campaign id does not reconcile with project state")
    if campaign.get("status") != "RUNNING":
        raise GateError("ADE Campaign is not RUNNING")
    campaign_tasks = campaign.get("task_ids")
    completed = campaign.get("completed_task_ids")
    if not isinstance(campaign_tasks, list) or task_id not in campaign_tasks:
        raise GateError("ADE current task is absent from Campaign")
    if isinstance(completed, list) and task_id in completed:
        raise GateError("ADE current task is already completed")

    graph_tasks = graph.get("tasks")
    if not isinstance(graph_tasks, list):
        raise GateError("ADE task graph is invalid")
    graph_node: dict[str, Any] | None = None
    for node in graph_tasks:
        if not isinstance(node, dict):
            continue
        raw_task = node.get("task")
        if isinstance(raw_task, dict) and raw_task.get("task_id") == task_id:
            graph_node = node
            break
    if graph_node is None or graph_node.get("status") != "RUNNING":
        raise GateError("ADE current task is not RUNNING in Task DAG")

    _validate_remote_receipt(
        receipt,
        repository=repository,
        task_id=task_id,
        pr_number=pr_number,
    )

    base_branch = metadata.get("target_base_branch", "main")
    if not isinstance(base_branch, str) or not base_branch.strip():
        raise GateError("ADE target base branch is invalid")
    phase = metadata.get("phase")
    if phase is not None and not isinstance(phase, str):
        raise GateError("ADE project phase is invalid")
    return (
        task_id,
        tuple(allowed_paths),
        base_branch,
        ade_ref,
        phase,
        accepted_fingerprint,
    )


def _validate_pr(
    pr: dict[str, Any],
    files: list[dict[str, Any]],
    *,
    allowed_paths: tuple[str, ...],
    base_branch: str,
    ci_head_sha: str,
) -> None:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if pr.get("state") != "open":
        raise GateError("pull request is not open")
    if pr.get("draft") is True:
        raise GateError("draft pull request cannot be auto-merged")

    head = pr.get("head")
    if not isinstance(head, dict):
        raise GateError("pull request head is missing")
    head_repo = head.get("repo")
    if not isinstance(head_repo, dict) or head_repo.get("full_name") != repository:
        raise GateError("pull request head repository does not match target repository")
    head_ref = head.get("ref")
    if not isinstance(head_ref, str) or head_ref in {"main", "master"}:
        raise GateError("pull request head branch is invalid")
    head_sha = head.get("sha")
    if not isinstance(head_sha, str) or not head_sha:
        raise GateError("pull request head SHA is missing")
    if head_sha != ci_head_sha:
        raise GateError("pull request head SHA does not match the SHA that passed CI")

    base = pr.get("base")
    if not isinstance(base, dict) or base.get("ref") != base_branch:
        raise GateError("pull request base branch does not match ADE contract")
    base_sha = base.get("sha")
    if not isinstance(base_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", base_sha):
        raise GateError("pull request base SHA is missing")

    # Editable PR text is only supplemental evidence. The authoritative
    # task/PR binding comes from ADE's trusted remote-execution receipt.
    body = pr.get("body")
    if not isinstance(body, str):
        raise GateError("Jules provenance marker is missing")
    if JULES_PROVENANCE_MARKER not in body or JULES_TASK_URL.search(body) is None:
        raise GateError("Jules provenance marker or task URL is missing")

    if not files:
        raise GateError("pull request changes no files")
    allowed = set(allowed_paths)
    for changed in files:
        filename = changed.get("filename")
        status = changed.get("status")
        if not isinstance(filename, str):
            raise GateError("changed file has no filename")
        if status not in {"added", "modified"}:
            raise GateError(f"remote gate forbids file status {status}: {filename}")
        if filename not in allowed:
            raise GateError(f"file is outside ADE allowed_paths: {filename}")


def _scheduled_v1_7_context() -> tuple[int, str, str] | None:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    ade_ref = _ade_head_sha()
    state = _ade_json(".autodev/state.json", ref=ade_ref)
    metadata = state.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    if metadata.get("phase") != "v1.7-multi-agent":
        return None
    receipt = _ade_json(
        ".autodev/runtime/remote-execution.json",
        ref=ade_ref,
    )
    if receipt.get("status") != "PR_CREATED":
        return None
    if receipt.get("target_repository") != repository:
        raise GateError("scheduled v1.7 receipt repository mismatch")
    url = receipt.get("pull_request_url")
    if not isinstance(url, str):
        raise GateError("scheduled v1.7 receipt has no pull request URL")
    match = re.fullmatch(
        rf"https://github\.com/{re.escape(repository)}/pull/(\d+)",
        url,
    )
    if match is None:
        raise GateError("scheduled v1.7 receipt pull request URL is invalid")
    pr_number = int(match.group(1))
    pr = _github_request("GET", f"/repos/{repository}/pulls/{pr_number}")
    if not isinstance(pr, dict) or pr.get("state") != "open":
        return None
    head = pr.get("head")
    if not isinstance(head, dict):
        raise GateError("scheduled v1.7 pull request head is missing")
    head_sha = head.get("sha")
    if not isinstance(head_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", head_sha):
        raise GateError("scheduled v1.7 pull request head SHA is invalid")

    runs = _github_request(
        "GET",
        f"/repos/{repository}/actions/runs?event=pull_request&per_page=50",
    )
    if not isinstance(runs, dict) or not isinstance(runs.get("workflow_runs"), list):
        raise GateError("scheduled target CI runs response is invalid")
    green = [
        run
        for run in runs["workflow_runs"]
        if isinstance(run, dict)
        and run.get("name") == "CI"
        and run.get("event") == "pull_request"
        and run.get("conclusion") == "success"
        and run.get("head_sha") == head_sha
    ]
    if not green:
        return None
    return pr_number, head_sha, ade_ref


def main() -> int:
    try:
        event = _load_event()
        repository = os.environ.get("GITHUB_REPOSITORY", "")
        workflow_run = event.get("workflow_run")
        ade_ref: str | None = None
        if isinstance(workflow_run, dict):
            if workflow_run.get("event") != "pull_request":
                print("SKIP: target CI was not triggered by a pull request")
                return 0
            if workflow_run.get("conclusion") != "success":
                print("WAIT: target CI is not green")
                return 0
            ci_head_sha = workflow_run.get("head_sha")
            if not isinstance(ci_head_sha, str) or not re.fullmatch(
                r"[0-9a-f]{40}", ci_head_sha
            ):
                raise GateError("workflow_run head_sha is invalid")
            pull_requests = workflow_run.get("pull_requests")
            if not isinstance(pull_requests, list) or len(pull_requests) != 1:
                print("SKIP: expected exactly one associated pull request")
                return 0
            pr_number = pull_requests[0].get("number")
            if not isinstance(pr_number, int):
                raise GateError("associated pull request number is missing")
        elif os.environ.get("GITHUB_EVENT_NAME") == "schedule":
            scheduled = _scheduled_v1_7_context()
            if scheduled is None:
                print("SKIP: no scheduled v1.7 PR with green target CI")
                return 0
            pr_number, ci_head_sha, ade_ref = scheduled
        else:
            print("SKIP: unsupported gate trigger")
            return 0

        pr = _github_request("GET", f"/repos/{repository}/pulls/{pr_number}")
        if not isinstance(pr, dict):
            raise GateError("pull request response must be an object")
        files = _github_list_pr_files(repository, pr_number)

        (
            task_id,
            allowed_paths,
            base_branch,
            ade_ref,
            phase,
            accepted_fingerprint,
        ) = _current_contract(
            pr_number=pr_number,
            ade_ref=ade_ref,
        )
        _validate_pr(
            pr,
            files,
            allowed_paths=allowed_paths,
            base_branch=base_branch,
            ci_head_sha=ci_head_sha,
        )

        head = pr.get("head")
        base = pr.get("base")
        expected_sha = head.get("sha") if isinstance(head, dict) else None
        base_sha = base.get("sha") if isinstance(base, dict) else None
        if not isinstance(expected_sha, str) or not expected_sha:
            raise GateError("pull request head SHA is missing")
        if not isinstance(base_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", base_sha):
            raise GateError("pull request base SHA is missing")

        if phase == "v1.7-multi-agent":
            cleared = _validate_v1_7_review_chain(
                ade_ref=ade_ref,
                repository=repository,
                task_id=task_id,
                accepted_fingerprint=accepted_fingerprint,
                pr_number=pr_number,
                pr_head_sha=expected_sha,
                pr_base_sha=base_sha,
            )
            if not cleared:
                print(
                    f"WAIT: v1.7 reviewer clearance is not available for PR #{pr_number}"
                )
                return 0

        merge = _github_request(
            "PUT",
            f"/repos/{repository}/pulls/{pr_number}/merge",
            {
                "sha": expected_sha,
                "merge_method": "squash",
                "commit_title": f"ADE remote autonomous merge: PR #{pr_number}",
            },
        )
        if not isinstance(merge, dict) or merge.get("merged") is not True:
            raise GateError(f"GitHub did not merge PR #{pr_number}: {merge}")

        print(
            f"MERGED: ADE remote task {task_id} via target PR #{pr_number}; "
            f"ade_ref={ade_ref}; scope={list(allowed_paths)}"
        )
        return 0
    except (GateError, ValueError, KeyError, json.JSONDecodeError, OSError) as exc:
        print(f"HUMAN_WAIT: ADE remote PR gate: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
