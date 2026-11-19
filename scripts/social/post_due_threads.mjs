// Posts due entries from operations/social/queue.json to Threads via the official API.
// Runs inside GitHub Actions (.github/workflows/social-post-threads.yml).
// Required env: THREADS_USER_ID, THREADS_ACCESS_TOKEN
// Behaviour: posts each pending entry whose scheduledAt <= now, writes results
// back into queue.json, exits non-zero if any entry failed. No automatic retries
// (a timed-out publish may have succeeded; duplicates are worse than a miss).

import { readFileSync, writeFileSync } from "node:fs";

const QUEUE_PATH = "operations/social/queue.json";
const API_BASE = "https://graph.threads.net/v1.0";

const userId = process.env.THREADS_USER_ID;
const accessToken = process.env.THREADS_ACCESS_TOKEN;
if (!userId || !accessToken) {
  console.error("THREADS_USER_ID / THREADS_ACCESS_TOKEN are not set; aborting.");
  process.exit(1);
}

const queue = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
const now = new Date();
let changed = false;
let failures = 0;

async function apiPost(path, params) {
  const body = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(`${API_BASE}/${userId}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const post of queue.posts) {
  if (post.status !== "pending") continue;
  if (!Array.isArray(post.targets) || !post.targets.includes("threads")) continue;
  if (new Date(post.scheduledAt) > now) continue;

  try {
    const container = await apiPost("threads", {
      media_type: "TEXT",
      text: post.text,
    });
    if (!container.id) throw new Error("container creation returned no id");
    // Threads asks for a short wait between container creation and publish.
    await sleep(5000);
    const published = await apiPost("threads_publish", {
      creation_id: container.id,
    });
    post.status = "posted";
    post.threadsPostId = published.id || null;
    post.postedAt = new Date().toISOString();
    post.error = null;
    console.log(`posted: ${post.id} -> ${post.threadsPostId}`);
  } catch (err) {
    post.status = "failed";
    post.error = String(err && err.message ? err.message : err);
    failures += 1;
    console.error(`failed: ${post.id}: ${post.error}`);
  }
  changed = true;
}

if (changed) {
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
  console.log("queue.json updated");
} else {
  console.log("no due posts");
}

process.exit(failures > 0 ? 1 : 0);
