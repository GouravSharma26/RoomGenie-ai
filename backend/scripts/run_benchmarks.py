"""
RoomGenie AI — Production Performance & Reliability Benchmark Runner (Phase 8.3)

Executes repeatable, empirical latency and reliability benchmarks for:
1. Health endpoint (/api/v1/health/)
2. Furniture catalogue API (/api/v1/furniture/catalog/)
3. Design persistence (save & retrieve roundtrips)
4. AI layout candidate generator (generation, simulation, ranking)
5. Spatial layout optimization engine (rectangular, L-shaped, concave layouts)

Outputs JSON and Markdown tables with P50, P95, min, max, mean, and validity rates.
"""

import os
import sys
import time
import json
import statistics
import django
from typing import List, Dict, Any

# Ensure project root in python path
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.test import Client
from django.contrib.auth import get_user_model
from apps.ai_agent.candidate_generator import CandidateGenerator
from apps.ai_agent.adapters.mock import MockDesignLLMAdapter
from apps.ai_agent.optimization.optimization_runner import OptimizationRunner
from apps.ai_agent.candidate_types import LayoutCandidate, ScoreBreakdown

User = get_user_model()


def calculate_percentiles(latencies: List[float]) -> Dict[str, float]:
    if not latencies:
        return {'min': 0.0, 'p50': 0.0, 'p95': 0.0, 'max': 0.0, 'mean': 0.0}
    sorted_l = sorted(latencies)
    n = len(sorted_l)
    p50_idx = int(n * 0.50)
    p95_idx = min(int(n * 0.95), n - 1)
    return {
        'min': round(sorted_l[0], 2),
        'p50': round(sorted_l[p50_idx], 2),
        'p95': round(sorted_l[p95_idx], 2),
        'max': round(sorted_l[-1], 2),
        'mean': round(statistics.mean(latencies), 2),
    }


def benchmark_health_api(client: Client, iterations: int = 50) -> Dict[str, Any]:
    latencies = []
    status_codes = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        res = client.get('/api/v1/health/')
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000.0)
        status_codes.append(res.status_code)

    return {
        'iterations': iterations,
        'success_rate': round(sum(1 for s in status_codes if s == 200) / iterations * 100.0, 1),
        'latency_ms': calculate_percentiles(latencies),
    }


def benchmark_catalogue_api(client: Client, iterations: int = 30) -> Dict[str, Any]:
    latencies = []
    status_codes = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        res = client.get('/api/v1/furniture/')
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000.0)
        status_codes.append(res.status_code)

    return {
        'iterations': iterations,
        'success_rate': round(sum(1 for s in status_codes if s == 200) / iterations * 100.0, 1),
        'latency_ms': calculate_percentiles(latencies),
    }


def benchmark_design_persistence(client: Client, iterations: int = 15) -> Dict[str, Any]:
    username = f"bench_user_{int(time.time() * 1000) % 100000}"
    user = User.objects.create_user(username=username, email=f"{username}@example.com", password="SecurePassword123!")
    client.force_login(user)

    save_latencies = []
    load_latencies = []
    design_ids = []

    scene_payload = {
        "schemaVersion": 1,
        "unit": "m",
        "room": {
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
        },
        "objects": [
            {
                "id": "item-1",
                "assetId": "bed-queen-nordic-wood",
                "name": "Nordic Queen Bed",
                "dimensions": [2.0, 1.1, 1.6],
                "position": [0.0, 0.55, 0.0],
                "rotationEuler": [0.0, 0.0, 0.0],
                "scale": [1.0, 1.0, 1.0],
            }
        ],
    }

    for i in range(iterations):
        t0 = time.perf_counter()
        res_save = client.post(
            '/api/v1/designs/',
            data=json.dumps({'title': f'Benchmark Design {i}', 'scene_json': scene_payload}),
            content_type='application/json',
        )
        t1 = time.perf_counter()
        save_latencies.append((t1 - t0) * 1000.0)
        
        if res_save.status_code in (200, 201):
            did = res_save.json().get('id')
            if did:
                design_ids.append(did)
                t2 = time.perf_counter()
                res_load = client.get(f'/api/v1/designs/{did}/')
                t3 = time.perf_counter()
                load_latencies.append((t3 - t2) * 1000.0)

    user.delete()

    return {
        'iterations': iterations,
        'save_success_rate': round(len(design_ids) / iterations * 100.0, 1),
        'save_latency_ms': calculate_percentiles(save_latencies),
        'load_latency_ms': calculate_percentiles(load_latencies),
    }


def benchmark_candidate_generation(iterations: int = 15) -> Dict[str, Any]:
    mock_adapter = MockDesignLLMAdapter()
    generator = CandidateGenerator(adapter=mock_adapter)
    test_scene = {
        "room": {
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
        },
        "objects": [],
        "relationships": [],
    }
    latencies = []
    valid_rates = []

    for _ in range(iterations):
        t0 = time.perf_counter()
        candidates = generator.generate_candidates(
            user_prompt="Arrange a modern living room with a sofa, coffee table, and TV console",
            current_scene=test_scene,
            candidate_count=3,
        )
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000.0)
        valid_count = sum(1 for c in candidates if c.is_valid)
        valid_rates.append(valid_count / len(candidates) if candidates else 0)

    return {
        'iterations': iterations,
        'latency_ms': calculate_percentiles(latencies),
        'average_validity_pct': round(statistics.mean(valid_rates) * 100.0, 1),
    }


def benchmark_spatial_optimizer() -> List[Dict[str, Any]]:
    runner = OptimizationRunner()
    
    scenarios = [
        {
            'name': 'Rectangular (5x4m, 4 items)',
            'scene': {
                'room': {'polygonVertices': [[0, 0], [5, 0], [5, 4], [0, 4]], 'wallHeight': 2.6},
                'objects': [
                    {'id': 'sofa', 'dimensions': [2.1, 0.9, 0.9], 'position': [2.5, 0.45, 1.0], 'rotationEuler': [0, 0, 0]},
                    {'id': 'table', 'dimensions': [1.2, 0.45, 0.6], 'position': [2.5, 0.225, 2.0], 'rotationEuler': [0, 0, 0]},
                    {'id': 'tv', 'dimensions': [1.8, 0.5, 0.4], 'position': [2.5, 0.25, 3.6], 'rotationEuler': [0, 3.14159, 0]},
                    {'id': 'plant', 'dimensions': [0.5, 1.2, 0.5], 'position': [0.5, 0.6, 0.5], 'rotationEuler': [0, 0, 0]},
                ],
                'relationships': [],
            }
        },
        {
            'name': 'L-Shaped (6x6m, 5 items)',
            'scene': {
                'room': {
                    'polygonVertices': [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]],
                    'wallHeight': 2.6
                },
                'objects': [
                    {'id': 'desk', 'dimensions': [1.4, 0.75, 0.7], 'position': [1.5, 0.375, 5.2], 'rotationEuler': [0, 0, 0]},
                    {'id': 'chair', 'dimensions': [0.6, 0.9, 0.6], 'position': [1.5, 0.45, 4.4], 'rotationEuler': [0, 3.14159, 0]},
                    {'id': 'bookshelf', 'dimensions': [1.0, 1.8, 0.4], 'position': [0.4, 0.9, 3.5], 'rotationEuler': [0, 1.5708, 0]},
                    {'id': 'armchair', 'dimensions': [0.9, 0.85, 0.85], 'position': [4.5, 0.425, 1.5], 'rotationEuler': [0, -1.5708, 0]},
                    {'id': 'side_table', 'dimensions': [0.5, 0.5, 0.5], 'position': [5.3, 0.25, 1.5], 'rotationEuler': [0, 0, 0]},
                ],
                'relationships': [],
            }
        },
        {
            'name': 'Concave (8x8m with alcove, 7 items)',
            'scene': {
                'room': {
                    'polygonVertices': [[0, 0], [8, 0], [8, 4], [5, 4], [5, 8], [0, 8]],
                    'wallHeight': 2.8
                },
                'objects': [
                    {'id': 'bed', 'dimensions': [2.0, 1.1, 1.6], 'position': [2.5, 0.55, 6.5], 'rotationEuler': [0, 3.14159, 0]},
                    {'id': 'nightstand_l', 'dimensions': [0.5, 0.55, 0.45], 'position': [1.2, 0.275, 6.5], 'rotationEuler': [0, 3.14159, 0]},
                    {'id': 'nightstand_r', 'dimensions': [0.5, 0.55, 0.45], 'position': [3.8, 0.275, 6.5], 'rotationEuler': [0, 3.14159, 0]},
                    {'id': 'wardrobe', 'dimensions': [1.8, 2.1, 0.6], 'position': [0.5, 1.05, 3.0], 'rotationEuler': [0, 1.5708, 0]},
                    {'id': 'lounge_chair', 'dimensions': [0.9, 0.85, 0.85], 'position': [6.5, 0.425, 2.0], 'rotationEuler': [0, -0.785, 0]},
                    {'id': 'floor_lamp', 'dimensions': [0.4, 1.6, 0.4], 'position': [7.3, 0.8, 2.0], 'rotationEuler': [0, 0, 0]},
                    {'id': 'dresser', 'dimensions': [1.2, 0.9, 0.5], 'position': [6.5, 0.45, 0.5], 'rotationEuler': [0, 0, 0]},
                ],
                'relationships': [],
            }
        }
    ]

    results = []
    dummy_score = ScoreBreakdown(
        boundary=80.0,
        collision=80.0,
        circulation=80.0,
        clearance=80.0,
        utilization=80.0,
        budget=80.0,
        overall=80.0
    )

    for sc in scenarios:
        cand = LayoutCandidate(
            id=f"bench_{sc['name'].split()[0].lower()}",
            label=f"Candidate {sc['name']}",
            description="Benchmark optimization candidate",
            reasoning_summary="Benchmarking optimizer search",
            proposed_actions=[],
            candidate_scene=sc['scene'],
            source_scene_hash="bench_hash",
            is_valid=True,
            is_approval_eligible=True,
            score=dummy_score,
            validation_feedback=None,
            trade_offs=[],
            intended_relationships=[],
            refinement_attempts=0,
            created_at_ms=int(time.time() * 1000),
            budget_diff=None,
        )

        durations = []
        for _ in range(5):
            t0 = time.perf_counter()
            optimized = runner.optimize_candidate(cand)
            t1 = time.perf_counter()
            durations.append((t1 - t0) * 1000.0)

        results.append({
            'scenario': sc['name'],
            'item_count': len(sc['scene']['objects']),
            'latency_ms': calculate_percentiles(durations),
            'final_valid': optimized.is_valid,
            'optimization_meta': optimized.optimization_metadata,
        })

    return results


def main():
    print("=" * 60)
    print("RoomGenie AI — Performance & Reliability Benchmarks")
    print("=" * 60)

    client = Client()

    print("\n[1/5] Benchmarking Health API (/api/v1/health/)...")
    health_res = benchmark_health_api(client, iterations=50)
    print(f"  P50: {health_res['latency_ms']['p50']}ms | P95: {health_res['latency_ms']['p95']}ms | Success: {health_res['success_rate']}%")

    print("\n[2/5] Benchmarking Furniture Catalogue API (/api/v1/furniture/)...")
    catalogue_res = benchmark_catalogue_api(client, iterations=30)
    print(f"  P50: {catalogue_res['latency_ms']['p50']}ms | P95: {catalogue_res['latency_ms']['p95']}ms | Success: {catalogue_res['success_rate']}%")

    print("\n[3/5] Benchmarking Design Persistence (Save & Load)...")
    design_res = benchmark_design_persistence(client, iterations=15)
    print(f"  Save Success: {design_res['save_success_rate']}%")
    print(f"  Save P50: {design_res['save_latency_ms']['p50']}ms | Save P95: {design_res['save_latency_ms']['p95']}ms")
    print(f"  Load P50: {design_res['load_latency_ms']['p50']}ms | Load P95: {design_res['load_latency_ms']['p95']}ms")

    print("\n[4/5] Benchmarking AI Layout Candidate Generator (Mock)...")
    cand_res = benchmark_candidate_generation(iterations=15)
    print(f"  P50: {cand_res['latency_ms']['p50']}ms | P95: {cand_res['latency_ms']['p95']}ms | Validity: {cand_res['average_validity_pct']}%")

    print("\n[5/5] Benchmarking Spatial Layout Optimizer across Room Topologies...")
    opt_res = benchmark_spatial_optimizer()
    for item in opt_res:
        print(f"  {item['scenario']}: P50 {item['latency_ms']['p50']}ms | P95 {item['latency_ms']['p95']}ms | Valid: {item['final_valid']}")

    output = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime()),
        'health_api': health_res,
        'catalogue_api': catalogue_res,
        'design_persistence': design_res,
        'candidate_generation': cand_res,
        'spatial_optimizer': opt_res,
    }

    output_path = os.path.join(backend_dir, 'benchmark_results.json')
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"\nSaved benchmark results to {output_path}")


if __name__ == '__main__':
    main()
