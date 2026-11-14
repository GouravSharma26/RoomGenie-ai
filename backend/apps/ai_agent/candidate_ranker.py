"""
Candidate Ranker for RoomGenie AI (Phase 6.3).
Ranks candidates deterministically using hard validity first, overall score second,
and stable candidate ID as tie-breaker.
"""

from typing import List
from apps.ai_agent.candidate_types import LayoutCandidate


class CandidateRanker:
    """
    Ranks simulated and scored candidates.
    Guarantees:
    1. Valid candidates always rank ahead of invalid candidates.
    2. Among valid candidates, higher score ranks first.
    3. Deterministic tie-breaking by candidate ID prevents non-deterministic flips.
    4. Never claims an arrangement is globally optimal; ranks only within generated candidates.
    """

    @staticmethod
    def rank_candidates(candidates: List[LayoutCandidate]) -> List[LayoutCandidate]:
        if not candidates:
            return []

        def sort_key(c: LayoutCandidate):
            # Sort order:
            # 1. is_valid (True > False -> 0 for True, 1 for False in ascending)
            # 2. overall score (descending -> negative score)
            # 3. candidate id (ascending -> deterministic tie-break)
            validity_rank = 0 if c.is_valid else 1
            score_rank = -round(c.score.overall, 2)
            id_rank = str(c.id)
            return (validity_rank, score_rank, id_rank)

        ranked = sorted(candidates, key=sort_key)
        return ranked
