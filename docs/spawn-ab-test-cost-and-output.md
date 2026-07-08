# Spawn A/B test — cost and output, baseline vs. engineered

Same task, spawned two ways, to check whether promper's `PreToolUse` spawn-brief rewrite
(`hooks/enrich-spawn.mjs`, row 2 — "hydrated") actually improves the result, not just changes it.
Both runs used `claude -p --plugin-dir <promper repo>` (a real plugin load, not a mock) spawning
one `general-purpose` subagent with the identical task:

> Design a rate-limiting strategy for a public API that gets 50k req per second bursts. Be specific.

- **Condition A — baseline.** No routing decision on disk. The `PreToolUse` hook resolves to
  row 3 ("unrouted") — per the noop fix, it leaves the subagent's brief completely untouched.
  The subagent runs as a plain `general-purpose` agent with no persona.
- **Condition B — engineered.** `~/.invoker/state/promper-decision.json` pre-populated with
  `{"agent": "backend-development-performance-engineer", ...}` before the same spawn. The hook
  resolves to row 2 ("hydrated") and rewrites the brief to inject that agent's full persona +
  plugin toolkit ahead of the same task text.

Raw outputs: [`cond-a-result.txt`](#full-output--condition-a-baseline) /
[`cond-b-result.txt`](#full-output--condition-b-engineered) below.

## Cost and usage (raw, as reported by `claude -p --output-format json`)

| Metric | Condition A (baseline) | Condition B (engineered) |
|---|---|---|
| Total cost | $1.0134 | $0.5453 |
| Wall time | 193.1s | 167.4s |
| Turns | 2 | 2 |
| Output tokens | 2,739 | 3,490 |
| Input + cache-read tokens | 88,330 | 101,532 |
| Cache-creation tokens | 43,366 | 29,965 |
| Models invoked | **claude-sonnet-5 + claude-opus-4-8** | claude-sonnet-5 only |

## This is not a clean cost signal — read the caveat before drawing a conclusion

Condition A cost roughly **2x** Condition B, but the raw dollar figure is not attributable to
"no persona costs more." Two confounds, both visible in the data above:

1. **Condition A invoked two models, Condition B invoked one.** Condition A's `modelUsage`
   breakdown shows a `claude-opus-4-8` call ($0.287) *in addition to* Sonnet ($0.726) — Condition
   B never touched Opus. That's a per-run model-selection difference, not a consequence of the
   spawn-brief rewrite.
2. **Cache state differed between runs.** Condition A created 43.4K tokens of fresh cache;
   Condition B only 30K (and read more from cache: 101.5K vs. 88.3K combined). Prompt-cache
   warmth from adjacent test runs in this same session contaminates any single-shot cost
   comparison — this is a known confound with Claude Code's prompt caching, not a property of
   either condition's design.

A real cost-isolation experiment would need the model pinned identically across both arms and
several repeated trials per arm to average out cache-state noise. **Don't cite the $1.01 vs.
$0.55 figures as "the engineered brief is cheaper."** What the data *does* support: both runs
were the same order of magnitude in cost and turn count — the rewrite did not blow up cost or
turn count, and per-output-token the engineered run was actually *more* token-efficient (more
output tokens for less total cost), though that's the same confound working in its favor rather
than a controlled result.

## Output quality — the finding that *does* hold up

This is the comparison that's actually clean: same task, same subagent type, same model
(Sonnet), and the *only* input difference is whether a role was injected. Condition B's output:

- **Opened with an explicit domain-confirmation line** — "Confirmed: rate-limit design for
  burst traffic is squarely performance/scalability engineering... Proceeding directly." —
  this is the injected persona's own behavioral protocol firing (the `backend-development-
  performance-engineer` agent file instructs this). Condition A never did this; it just
  answered.
- **Used that persona's own report structure** — Impact-labeled components
  (Critical/High/Medium), an explicit SLO/latency-budget section, a "Top 3 Priority
  Optimizations" closer. Condition A's structure was good but generic (numbered sections,
  no impact labeling, no SLO budgeting).
- **Reached for more advanced, more specific techniques** — GCRA with a direct citation to
  Stripe's and Kong/Cloudflare's production rate limiters, plus an adaptive-concurrency
  bulkhead layer (Netflix `concurrency-limits`, Vegas-style). Condition A used token-bucket
  (a perfectly reasonable but less specific choice) and did not mention adaptive concurrency
  at all.

Both outputs were competent — Sonnet is strong even with no persona. The persona injection's
value-add here is **specificity and structure that matches a named specialist's actual working
style**, not "correct vs. incorrect." That's consistent with promper's whole premise: the role
sharpens an already-good model rather than rescuing a weak one.

## Full output — Condition A (baseline)

```
## Assumptions (stated explicitly, since they drive the whole design)

- **50k req/s is aggregate**, across many distinct clients (flash sale, viral spike, or DDoS-adjacent traffic) — not one client hammering a single key. Per-key limits are far smaller (tens to low-hundreds RPS); the 50k number is a backend-survival budget.
- Backend (DB/downstream services) cannot actually sustain 50k RPS of real work — the point of this design is to admit as much *legitimate* traffic as possible while protecting backend from both abuse and its own capacity limits.

## The one decision that defines this design

**No synchronous datastore round-trip on the hot path.** If every request hits Redis before proceeding, Redis becomes both the bottleneck and a single point of failure at this scale:

- A Redis Lua-script check costs roughly 15–30k ops/sec per node in practice (script eval is heavier than a bare GET). At 50k RPS you're already past single-node headroom, and a burst to 2x that (100k) blows through it.
- Worse: it makes rate limiting itself a dependency that can 503 the API if Redis blips.

So: **local, in-process rate limiting is the primary enforcement point; a shared store is consulted asynchronously, never inline.**

## Architecture

**Layer 1 — Edge (Cloudflare / AWS Shield+CloudFront).** Coarse IP-based limiting and L3/L4/L7 DDoS absorption before traffic reaches your infra at all (e.g., 2k req/min/IP for anonymous traffic, bot-challenge on anomalous patterns). This layer can absorb attack volume orders of magnitude above 50k RPS — it's the outer bound protecting everything below it.

**Layer 2 — Gateway/proxy (Envoy), the primary enforcement point.** Each Envoy instance runs a local, in-memory **GCRA** (Generic Cell Rate Algorithm) limiter per API key. GCRA over classic token-bucket because it stores one value per key (theoretical arrival time) instead of counter+timestamp, and updates via a lock-free CAS — cheap enough to run on every request with no I/O.

Concrete parameters:
- Free tier: burst 20, refill 2/s
- Standard tier: burst 100, refill 20/s
- Enterprise tier: burst 1000, refill 200/s
- Expensive endpoints (search, export, bulk write) cost more tokens per call (e.g., 10 tokens vs. 1) from the same bucket.

**Layer 3 — Global reconciliation (Redis Cluster), consulted async only.** Each gateway instance batches its local counters and pushes them to Redis every 1–2s (not per request), pulling back a per-key "global scale factor" if that key is running hot cluster-wide.

## Why this scales — the arithmetic

- 20 gateway instances behind the LB → ~2,500 RPS/instance at peak. An in-memory CAS check costs ~100ns–1µs, so at 2,500 RPS that's under 1% of one core. Trivial.
- Naive design: 50k RPS → 50k Redis ops/sec, synchronous, blocking. Local-first design: Redis only sees batched syncs — 20 instances × ~500 active keys / 1s sync interval ≈ **10k ops/sec**, and that's pipelined, not blocking request latency. That's a >80% cut in required Redis throughput, and none of it sits on the request path. A 3-shard Redis Cluster (each shard handling that class of op at ~50–100k/s) has comfortable headroom.

**Known weakness and mitigation:** purely local buckets mean a client's true burst ceiling is (per-instance limit × number of instances that see its traffic) if requests spray evenly — e.g., 100-token burst × 20 instances = up to 2,000 effective burst for one key. Mitigate with **consistent-hash routing on API key at the LB**, so a given key's traffic sticks to 1–2 instances, collapsing the multiplier to ~1–2x. The async global sync bounds the remaining overshoot to roughly one sync interval's worth of extra tokens (e.g., 2s × 20/s = 40 extra tokens) — acceptable slop for burst absorption, **not** acceptable if you need billing-grade exactness (call that out to stakeholders if metered billing depends on this number).

## Failure mode: fail-open on sync, fail-closed on local enforcement

If Redis/global sync is unreachable, each instance keeps enforcing its **last-known local rate** and simply stops syncing. Fairness precision degrades (a key could get closer to the N-instance multiplier), but the API never depends on Redis being up to serve traffic. The rate limiter's own infrastructure must never become a cause of a 503 for the whole API — that's the failure mode to explicitly design out.

## Independent layer: backend protection (not per-key)

Per-key limits don't protect you if every key is individually "within limit" but aggregate legitimate traffic still exceeds backend capacity. Run adaptive admission control independent of the key-based limiter: track backend p99 latency / error rate (Envoy outlier detection or a sliding window per instance); when p99 exceeds ~2x baseline or error rate exceeds 5%, apply a global multiplicative-decrease factor (AIMD, or Netflix's concurrency-limits gradient algorithm) that scales down all refill rates cluster-wide until backend recovers.

As a last resort beyond all budgets: a short bounded queue (≈50ms timeout) with weighted-fair-queueing by tier — paying customers get priority — then 503 for anything that can't be served, rather than let queueing depth turn into unbounded latency.

## Client contract

`429 Too Many Requests` with `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix ts), `Retry-After` (seconds), and a machine-readable `rate_limited` error code in the body.

## Validation

Load test with k6/vegeta at 50k RPS sustained plus a 2x spike; assert p99 latency stays flat and Redis sync queue depth doesn't grow unbounded (that queue depth is the leading indicator of the whole system falling behind, watch it as an SLO). Monitor: per-key 429 rate, local-vs-global bucket drift, Redis sync lag, backend p99/error rate, edge WAF block rate.

---

This work was a standalone architecture/design question, unrelated to the promper repository's own code — no repo files were read or modified.
```

## Full output — Condition B (engineered)

```
Confirmed: rate-limit design for burst traffic is squarely performance/scalability engineering (API Performance, Concurrency, Scalability Analysis). Proceeding directly.

# Rate-Limiting Strategy — Public API, 50k req/s Bursts

## Traffic Model Assumption
Sustained baseline ~5-10k rps, with bursts to 50k rps over seconds-to-tens-of-seconds windows (flash traffic, viral referral, retry storms, or abuse). Design must: (1) shed illegitimate/excess load before it costs origin compute, (2) not become the bottleneck itself, (3) degrade safely if its own dependencies fail.

---

## Architecture: Defense in Depth (4 layers)

**Layer 1 — Edge (CDN/WAF: Cloudflare/Fastly/CloudFront)**
- **Impact**: Critical (absorbs majority of burst before origin sees it)
- **Component**: Edge PoP, in front of API Gateway
- **Issue**: A 50k rps burst hitting your origin directly means your origin must be provisioned for 50k rps, which is wasteful and fragile.
- **Fix**: Coarse, cheap, per-PoP approximate counters at the edge (e.g., Cloudflare Rate Limiting Rules or AWS WAF rate-based rules) — block/challenge by IP/ASN at a generous threshold (e.g., >200 req/10s per IP). Eventually consistent across PoPs, but that's fine — precision isn't the job here, volumetric shedding is.
- **Tradeoff**: Edge counters are approximate (per-PoP), so a distributed attacker under the per-PoP threshold slips through — that's what Layer 2 is for.

**Layer 2 — API Gateway (Envoy/Kong + external Rate Limit Service)**
- **Impact**: Critical (this is the actual enforcement point)
- **Component**: Gateway sidecar/filter calling a gRPC rate-limit service (lyft/ratelimit pattern), backed by Redis Cluster
- **Issue**: This is where precise, per-key/per-tenant/per-endpoint limits must live, and it's on the critical path for every request — it cannot add meaningful latency or become a single point of failure at 50k rps.
- **Fix**: See "Algorithm" and "Store" sections below.
- **Tradeoff**: Adds a network hop (gateway → RLS → Redis) per request; mitigate with connection pooling, pipelining, and a local cache of recent decisions where correctness allows it.

**Layer 3 — Application middleware (tier-aware quotas)**
- **Impact**: Medium (business-logic quotas: free/pro/enterprise)
- **Issue**: Gateway-level limits are traffic-shape limits; product-tier quotas are a business rule and belong closer to the app so they can reflect entitlement changes without a gateway redeploy.
- **Fix**: Same Redis-backed bucket, different key namespace (`rl:tier:{plan}:{key}`), checked in middleware.

**Layer 4 — Backend bulkhead / adaptive concurrency**
- **Impact**: High (protects the requests that legitimately clear all rate limits)
- **Issue**: Even correctly rate-limited traffic can exceed DB/downstream capacity if the accepted rate itself is set too high for backend headroom.
- **Fix**: Bounded request queue + worker pool per service; reject with 503 + `Retry-After` once queue depth crosses a threshold instead of letting requests queue unboundedly. Layer an adaptive concurrency limiter (Netflix `concurrency-limits` / Envoy adaptive concurrency, Vegas-style) on top of the static bucket so accepted concurrency self-tunes down when p99 latency rises.
- **Tradeoff**: Adds complexity and another tunable; without it, static rate limits alone can still let a "legal" burst take down the DB.

---

## Algorithm: GCRA (Generic Cell Rate Algorithm), not fixed-window

- **Impact**: Critical — algorithm choice determines correctness under burst
- **Issue**: Fixed-window counters double-admit at window boundaries (up to 2x burst at the edge of a window); sliding-log is exact but stores a timestamp per request — O(n) memory blowup at 50k rps per key.
- **Fix**: GCRA (used in production by Stripe's rate limiter and Kong/Cloudflare's sliding-window implementations) stores a single value per key (theoretical arrival time), computed via one Lua script round-trip — atomic, no lock contention, exact burst+sustained enforcement, minimal memory.
- **Tradeoff**: Slightly less intuitive to tune than "N requests per M seconds," but the correctness gain at this scale is worth it.

**Concrete bucket parameters (burst / sustained rate):**

| Dimension | Burst | Sustained rate | Rationale |
|---|---|---|---|
| Global safety valve | 60,000 | 20,000 rps | Headroom above 50k; caps sustained damage after burst so downstream never sees more than 20k rps sustained |
| Unauthenticated IP | 50 | 5 rps | Anonymous callers rarely need more; aggressive by design |
| API key — free tier | 20 | 5 rps | |
| API key — pro tier | 200 | 50 rps | |
| API key — enterprise | negotiated | negotiated | Custom bucket per contract |
| Expensive endpoint class (search/export/write) | tighter, layered on top | — | Request must pass global AND key AND endpoint-class bucket — multiplicative, not either/or |

Key point: a single client's burst allowance (20-200) must be far smaller than the global 60k ceiling — a client legitimately bursting to anywhere near 50k alone is a bug or abuse, not a real use case.

---

## Store: Redis Cluster sizing

- **Impact**: High — if the counter store falls over, the rate limiter itself becomes the outage
- **Issue**: A single Redis node with Lua-script overhead sustains roughly 40-60k ops/sec — technically enough for 50k rps, but with zero headroom and one point of failure.
- **Fix**: Redis Cluster, 3-6 nodes, keys sharded by CRC16 slot hash on `{tenant/IP}` — gives 150-350k ops/sec aggregate headroom (3x+ over peak). Gateway uses async, pipelined, pooled connections (persistent pool, not connection-per-request).
- **Tradeoff**: Operational overhead of running/monitoring a cluster instead of one node; necessary at this scale regardless of rate limiting.

**Failure handling** (rate limiter is now on the critical path for every request):
- Circuit breaker around Redis calls (e.g., 50ms timeout, trip after N consecutive failures).
- Fail-open for idempotent read endpoints when Redis is down (availability wins); fail-closed for mutating/billing-relevant endpoints (abuse risk wins). Configurable per route.
- Local in-memory fallback bucket per gateway instance during circuit-open, resyncing on recovery.

---

## Response Contract

- `429 Too Many Requests`
- Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (IETF draft RateLimit header fields), `Retry-After` (computed from GCRA's stored TAT minus now)
- Machine-readable error code in body so client SDKs implement exponential backoff + jitter — naive immediate-retry-on-429 is itself a major cause of sustained bursts.

## Observability (non-optional at this scale)
- Per-dimension accept/reject rate, added latency from the rate-limit check (p50/p99), Redis command latency and cluster CPU/memory.
- Alert when a single key/IP accounts for a disproportionate share of any burst — feed that signal back into the edge WAF blocklist (closes the loop between Layer 4 observability and Layer 1 enforcement).

---

## Top 3 Priority Optimizations
1. **Edge-level shedding (Layer 1)** — highest leverage, cheapest: stops most of the 50k burst before it costs a single origin request.
2. **GCRA over sharded Redis Cluster with circuit breaker (Layer 2)** — the actual enforcement point; must not become the bottleneck or SPOF it's meant to prevent.
3. **Backend bulkhead + adaptive concurrency (Layer 4)** — defense in depth for traffic that legitimately clears rate limits but would still overwhelm the DB.

## Recommended SLOs / Budgets
- Rate-limit check added latency: p50 <1ms, p99 <5ms (same-AZ async Redis).
- Rate-limiter latency budget ≤2.5% of overall API p99 target (e.g., <5ms of a 200ms p99).
- Detection-to-fail-open on Redis outage: <30s.
- False-positive reject rate for well-behaved clients under normal (non-burst) load: <0.1%.
- Counter-store capacity headroom: provision Redis Cluster for 3x expected sustained rps — the rate limiter itself must never be what falls over during a burst.
```
