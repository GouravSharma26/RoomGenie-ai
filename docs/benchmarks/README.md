# RoomGenie AI — Performance & Reliability Benchmark Methodology

**Version:** Phase 8.3 & 8.3.1  
**Last Updated:** November 14, 2026  
**Script:** `backend/scripts/run_benchmarks.py`  
**Results Artifact:** `backend/benchmark_results.json`

---

## 1. Overview & Objectives

The RoomGenie AI benchmark harness measures end-to-end computational throughput, database transaction latency, and geometric layout optimization speed across five core application boundaries:

1. **Health API (`/api/v1/health/`):** Lightweight liveness and database availability probe.
2. **Furniture Catalogue API (`/api/v1/furniture/`):** Catalogue query and serialization latency.
3. **Design Persistence API (`/api/v1/designs/`):** Save and retrieve database roundtrips.
4. **AI Layout Candidate Generator:** Multi-candidate generation, geometric simulation, and ranking.
5. **Spatial Layout Optimization Engine:** Constraint-aware search, collision resolution, and clearance optimization across rectangular, L-shaped, and concave room topologies.

---

## 2. Methodology & Statistical Rigor

### 2.1 Warmup Iteration Exclusion
Earlier benchmark passes suffered from cold-start bias (e.g. initial module imports, connection pool creation, and JIT caching caused iteration 0 to spike up to 10× above steady-state latency).

To eliminate cold-start distortion:
- Every benchmark function runs **at least one unrecorded warmup iteration** prior to starting measurement timers.
- Warmup cycles instantiate database connections and populate serializers, ensuring that recorded metrics reflect steady-state production performance.

### 2.2 Linear Percentile Interpolation (NIST / NumPy Type 7)
Small sample sizes (e.g. $N = 15$ or $N = 30$) can produce erratic percentile figures if nearest-rank indexing is used:
$$\text{index} = \text{int}(N \times p)$$
For $N = 15$, $15 \times 0.95 = 14.25 \to 14$, which naively selects the single worst-case maximum value rather than a statistically representative 95th percentile.

The Phase 8.3.1 harness uses standard linear interpolation:
$$\text{rank} = p \times (n - 1)$$
$$\text{value} = y_{\lfloor \text{rank} \rfloor} + (\text{rank} - \lfloor \text{rank} \rfloor) \times (y_{\lceil \text{rank} \rceil} - y_{\lfloor \text{rank} \rfloor})$$
This aligns with NIST and NumPy Type 7 calculations, producing smooth, statistically sound P50 and P95 numbers even on small datasets.

---

## 3. Environment Disclosures & Constraints

> [!IMPORTANT]
> **Local In-Process vs. Cloud Production Disclosures:**
>
> 1. **Database Engine:** Local benchmarks run against local SQLite (`roomgenie_db.sqlite3`). In-process SQLite query latency is typically $0.15 \text{ ms} - 1.5 \text{ ms}$. In production on Render/AWS, PostgreSQL network roundtrips over TLS typically add $15 \text{ ms} - 40 \text{ ms}$ per transaction.
> 2. **AI Provider Mode:** Multi-candidate generation benchmarks run using `MockDesignLLMAdapter` (deterministic offline mock), measuring purely Python-level serialization and geometric simulation overhead (~20–40 ms). Live Google Gemini 3.8 Flash network calls over HTTPS typically require $800 \text{ ms} - 2,500 \text{ ms}$.
> 3. **Client Network Overhead:** Benchmarks use Django's test `Client()`, executing in-process WSGI function calls without TCP/IP socket negotiation or TLS handshakes.

---

## 4. Running Benchmarks Locally

```bash
cd backend
python scripts/run_benchmarks.py
```

Results are saved automatically to `backend/benchmark_results.json` with execution timestamp, database engine metadata, and percentile formulas.
