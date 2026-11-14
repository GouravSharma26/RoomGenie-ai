"""
Deterministic Evaluation Dataset for RoomGenie AI Spatial Reasoning (Phase 6.5).
Provides 32 realistic, reproducible evaluation scenarios across diverse geometries,
functional room zones, opening placements, and constraint configurations.
"""

from typing import Dict, List, Optional
from .evaluation_types import EvaluationCase


EVALUATION_DATASET: List[EvaluationCase] = [
    # -------------------------------------------------------------
    # 1. RECTANGULAR LIVING ROOMS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-01",
        name="Standard Living Room Seating",
        category="living_room",
        description="Standard 5x4m rectangular room. Arrange conversation area with sofa, coffee table, and accent chair.",
        user_request="Arrange a cozy conversational living room with sofa and coffee table",
        room_geometry={
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-s1", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-02",
        name="Compact Studio Living Zone",
        category="living_room",
        description="Compact 4x3.5m living area requiring efficient circulation perimeter.",
        user_request="Place a compact living room seating area with coffee table",
        room_geometry={
            "width": 4.0,
            "length": 3.5,
            "height": 2.7,
            "openings": [{"id": "door-s2", "wallId": "w-south", "type": "door", "center": [1.0, 1.75], "width": 0.85}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-03",
        name="Spacious Living Room Lounge",
        category="living_room",
        description="Generous 6x5m living room for multi-chair social seating.",
        user_request="Design a spacious living room layout with sofa, coffee table, and armchair",
        room_geometry={
            "width": 6.0,
            "length": 5.0,
            "height": 3.0,
            "openings": [{"id": "door-s3", "wallId": "w-south", "type": "door", "center": [-1.5, 2.5], "width": 0.95}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 2. RECTANGULAR BEDROOMS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-04",
        name="Master Bedroom with Dual Nightstands",
        category="bedroom",
        description="5x4.2m bedroom with queen bed and dual bedside nightstands.",
        user_request="Arrange a master bedroom with queen bed and nightstands",
        room_geometry={
            "width": 5.0,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-b1", "wallId": "w-south", "type": "door", "center": [-1.8, 2.1], "width": 0.9}],
        },
        expected_required_categories=["beds", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-05",
        name="Guest Bedroom Arrangement",
        category="bedroom",
        description="4x3.6m guest bedroom with perimeter bed placement and clear path.",
        user_request="Arrange a functional sleeping zone with bed and nightstand",
        room_geometry={
            "width": 4.0,
            "length": 3.6,
            "height": 2.8,
            "openings": [{"id": "door-b2", "wallId": "w-south", "type": "door", "center": [1.2, 1.8], "width": 0.85}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-06",
        name="Spacious Bedroom Suite",
        category="bedroom",
        description="5.5x4.5m bedroom with sleeping zone and storage.",
        user_request="Create a master bedroom arrangement with bed and bedside tables",
        room_geometry={
            "width": 5.5,
            "length": 4.5,
            "height": 2.8,
            "openings": [{"id": "door-b3", "wallId": "w-south", "type": "door", "center": [0.0, 2.25], "width": 0.9}],
        },
        expected_required_categories=["beds", "tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 3. WORKSPACES AND STUDY ROOMS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-07",
        name="Executive Home Study",
        category="workspace",
        description="4.5x3.8m study room with executive desk, ergonomic chair, and storage.",
        user_request="Design an executive workspace with desk, chair, and storage",
        room_geometry={
            "width": 4.5,
            "length": 3.8,
            "height": 2.8,
            "openings": [{"id": "door-w1", "wallId": "w-south", "type": "door", "center": [-1.2, 1.9], "width": 0.9}],
        },
        expected_required_categories=["tables", "seating"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-08",
        name="Compact Home Office Nook",
        category="workspace",
        description="3.5x3.0m compact study room.",
        user_request="Arrange a workspace with desk and chair",
        room_geometry={
            "width": 3.5,
            "length": 3.0,
            "height": 2.7,
            "openings": [{"id": "door-w2", "wallId": "w-south", "type": "door", "center": [1.0, 1.5], "width": 0.85}],
        },
        expected_required_categories=["tables", "seating"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-09",
        name="Studio Workstation Corner",
        category="workspace",
        description="4x4m square room dedicated to study and drafting desk.",
        user_request="Set up an office workspace with study desk and chair",
        room_geometry={
            "width": 4.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-w3", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        expected_required_categories=["tables", "seating"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 4. DINING ARRANGEMENTS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-10",
        name="Family Dining Room",
        category="dining",
        description="5x4m dining room with 6-seat dining table and chairs.",
        user_request="Arrange a dining room with dining table and chairs",
        room_geometry={
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-d1", "wallId": "w-south", "type": "door", "center": [-1.5, 2.0], "width": 0.9}],
        },
        expected_required_categories=["tables", "seating"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-11",
        name="Compact Dining Area",
        category="dining",
        description="3.8x3.2m dining space with round dining table.",
        user_request="Place a compact dining table arrangement with chairs",
        room_geometry={
            "width": 3.8,
            "length": 3.2,
            "height": 2.8,
            "openings": [{"id": "door-d2", "wallId": "w-south", "type": "door", "center": [1.2, 1.6], "width": 0.85}],
        },
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 5. POLYGONAL (PENTAGONAL) ROOMS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-12",
        name="Pentagon Room Living Lounge",
        category="polygon",
        description="Canonical pentagon room (Phase 5.5 blueprint) with non-orthogonal angled walls.",
        user_request="Arrange living room seating in this pentagon room",
        room_geometry={
            "width": 6.0,
            "length": 5.5,
            "height": 2.8,
            "footprint": [
                [0.0, -2.75],
                [2.85, -0.85],
                [1.75, 2.75],
                [-1.75, 2.75],
                [-2.85, -0.85],
            ],
            "openings": [{"id": "door-p1", "wallId": "w-south", "type": "door", "center": [0.0, 2.75], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-13",
        name="Pentagon Room Bedroom",
        category="polygon",
        description="Pentagonal room arranged as a private sleeping chamber.",
        user_request="Arrange a sleeping zone with bed and nightstands in this angled room",
        room_geometry={
            "width": 6.0,
            "length": 5.5,
            "height": 2.8,
            "footprint": [
                [0.0, -2.75],
                [2.85, -0.85],
                [1.75, 2.75],
                [-1.75, 2.75],
                [-2.85, -0.85],
            ],
            "openings": [{"id": "door-p2", "wallId": "w-south", "type": "door", "center": [0.0, 2.75], "width": 0.9}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-14",
        name="Pentagon Multi-Door Ingress",
        category="polygon",
        description="Pentagon room with doors on South and North-East walls requiring open corridor.",
        user_request="Arrange a seating area while preserving circulation between the two doors",
        room_geometry={
            "width": 6.0,
            "length": 5.5,
            "height": 2.8,
            "footprint": [
                [0.0, -2.75],
                [2.85, -0.85],
                [1.75, 2.75],
                [-1.75, 2.75],
                [-2.85, -0.85],
            ],
            "openings": [
                {"id": "door-p14a", "wallId": "w-south", "type": "door", "center": [0.0, 2.75], "width": 0.9},
                {"id": "door-p14b", "wallId": "w-ne", "type": "door", "center": [2.3, 0.95], "width": 0.9},
            ],
        },
        expected_required_categories=["seating"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 6. CONCAVE L-SHAPED ROOMS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-15",
        name="Concave L-Shaped Living Suite",
        category="concave",
        description="6-vertex concave L-shaped room footprint requiring zone separation.",
        user_request="Arrange living room seating in the main area of the L-shaped room",
        room_geometry={
            "width": 6.0,
            "length": 5.0,
            "height": 2.8,
            "footprint": [
                [-3.0, -2.5],
                [0.0, -2.5],
                [0.0, 0.0],
                [3.0, 0.0],
                [3.0, 2.5],
                [-3.0, 2.5],
            ],
            "openings": [{"id": "door-l1", "wallId": "w-south", "type": "door", "center": [-1.5, 2.5], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-16",
        name="L-Shaped Living & Study Division",
        category="concave",
        description="L-shaped room hosting living arrangement in one wing.",
        user_request="Set up living room seating and coffee table in this L-shaped apartment",
        room_geometry={
            "width": 6.0,
            "length": 6.0,
            "height": 2.8,
            "footprint": [
                [-3.0, -3.0],
                [1.0, -3.0],
                [1.0, 0.0],
                [3.0, 0.0],
                [3.0, 3.0],
                [-3.0, 3.0],
            ],
            "openings": [{"id": "door-l2", "wallId": "w-south", "type": "door", "center": [2.0, 3.0], "width": 0.9}],
        },
        expected_required_categories=["seating"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 7. SMALL CONSTRAINED ROOMS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-17",
        name="Compact Micro-Studio",
        category="constrained",
        description="Small 3.2x2.6m room testing tight clearance enforcement.",
        user_request="Arrange a compact workspace with desk and chair",
        room_geometry={
            "width": 3.2,
            "length": 2.6,
            "height": 2.6,
            "openings": [{"id": "door-c1", "wallId": "w-south", "type": "door", "center": [0.8, 1.3], "width": 0.8}],
        },
        expected_required_categories=["tables", "seating"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-18",
        name="Tight Clearance Corner Study",
        category="constrained",
        description="3.0x2.8m study room requiring precise perimeter placement.",
        user_request="Place desk and office chair without blocking the doorway",
        room_geometry={
            "width": 3.0,
            "length": 2.8,
            "height": 2.7,
            "openings": [{"id": "door-c2", "wallId": "w-south", "type": "door", "center": [-0.8, 1.4], "width": 0.8}],
        },
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 8. MULTI-DOOR CIRCULATION CORRIDORS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-19",
        name="Dual Door Traffic Hall",
        category="multi_door",
        description="Room with opposing North and South doors requiring a continuous through-corridor.",
        user_request="Arrange a sofa and coffee table while keeping the direct path between doors clear",
        room_geometry={
            "width": 5.5,
            "length": 4.5,
            "height": 2.8,
            "openings": [
                {"id": "door-md1a", "wallId": "w-south", "type": "door", "center": [0.0, 2.25], "width": 0.9},
                {"id": "door-md1b", "wallId": "w-north", "type": "door", "center": [0.0, -2.25], "width": 0.9},
            ],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-20",
        name="Triple Ingress Distribution Foyer",
        category="multi_door",
        description="Foyer with three architectural door openings requiring perimeter-only placement.",
        user_request="Add accent seating without blocking access to any of the three doors",
        room_geometry={
            "width": 6.0,
            "length": 5.0,
            "height": 2.8,
            "openings": [
                {"id": "door-md2a", "wallId": "w-south", "type": "door", "center": [0.0, 2.5], "width": 0.9},
                {"id": "door-md2b", "wallId": "w-east", "type": "door", "center": [3.0, 0.0], "width": 0.9},
                {"id": "door-md2c", "wallId": "w-west", "type": "door", "center": [-3.0, 0.0], "width": 0.9},
            ],
        },
        expected_required_categories=["seating"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 9. ARCHITECTURAL WINDOWS AND SILLS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-21",
        name="Living Room with Low Bay Windows",
        category="windows",
        description="Living room with two low-sill North windows requiring unobstructed natural light.",
        user_request="Arrange living room seating respecting window placements",
        room_geometry={
            "width": 5.0,
            "length": 4.2,
            "height": 2.8,
            "openings": [
                {"id": "door-wnd1", "wallId": "w-south", "type": "door", "center": [0.0, 2.1], "width": 0.9},
                {"id": "wnd-1a", "wallId": "w-north", "type": "window", "center": [-1.2, -2.1], "width": 1.4},
                {"id": "wnd-1b", "wallId": "w-north", "type": "window", "center": [1.2, -2.1], "width": 1.4},
            ],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-22",
        name="Study with Garden View Windows",
        category="windows",
        description="Home office positioned to take advantage of East window lighting.",
        user_request="Place desk and office chair in a bright workspace",
        room_geometry={
            "width": 4.5,
            "length": 3.6,
            "height": 2.8,
            "openings": [
                {"id": "door-wnd2", "wallId": "w-south", "type": "door", "center": [1.2, 1.8], "width": 0.9},
                {"id": "wnd-2", "wallId": "w-east", "type": "window", "center": [2.25, 0.0], "width": 1.6},
            ],
        },
        expected_required_categories=["tables", "seating"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 10. PRESERVATION OF EXISTING FURNITURE
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-23",
        name="Preserve Existing Sofa & Add Coffee Table",
        category="preservation",
        description="Room contains existing sofa that must not be deleted or displaced.",
        user_request="Add a coffee table in front of my existing sofa",
        room_geometry={
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-pr1", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        existing_objects=[
            {
                "id": "existing-sofa-23",
                "assetId": "sofa-modern-3seater",
                "name": "Existing Sofa",
                "position": [0.0, 0.425, -1.0],
                "rotationEuler": [0.0, 0.0, 0.0],
                "dimensions": [2.1, 0.85, 0.9],
            }
        ],
        preservation_ids=["existing-sofa-23"],
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-24",
        name="Preserve Existing Desk & Add Armchair",
        category="preservation",
        description="Room contains an anchored study desk that must be preserved.",
        user_request="Add a comfortable armchair to my study room while keeping my desk",
        room_geometry={
            "width": 4.8,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-pr2", "wallId": "w-south", "type": "door", "center": [1.5, 2.0], "width": 0.9}],
        },
        existing_objects=[
            {
                "id": "existing-desk-24",
                "assetId": "desk-workspace-study",
                "name": "Anchor Desk",
                "position": [-1.2, 0.375, -1.2],
                "rotationEuler": [0.0, 0.0, 0.0],
                "dimensions": [1.5, 0.75, 0.8],
            }
        ],
        preservation_ids=["existing-desk-24"],
        expected_required_categories=["seating"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 11. SEMANTIC SOCKET ATTACHMENTS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-25",
        name="Sofa Front-Table Socket Attachment",
        category="socket_attachment",
        description="Directly attach coffee table to sofa's front-table semantic socket.",
        user_request="Attach a coffee table to the front of the sofa",
        room_geometry={
            "width": 5.0,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-sk1", "wallId": "w-south", "type": "door", "center": [0.0, 2.1], "width": 0.9}],
        },
        existing_objects=[
            {
                "id": "anchor-sofa-25",
                "assetId": "sofa-modern-3seater",
                "name": "Living Anchor Sofa",
                "position": [0.0, 0.425, -0.8],
                "rotationEuler": [0.0, 0.0, 0.0],
                "dimensions": [2.1, 0.85, 0.9],
            }
        ],
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-26",
        name="Bed Dual Side-Table Socket Attachment",
        category="socket_attachment",
        description="Attach nightstands to the left and right sockets of a queen bed.",
        user_request="Attach nightstands to both sides of the bed",
        room_geometry={
            "width": 5.2,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-sk2", "wallId": "w-south", "type": "door", "center": [-1.5, 2.1], "width": 0.9}],
        },
        existing_objects=[
            {
                "id": "anchor-bed-26",
                "assetId": "bed-queen-wood",
                "name": "Queen Wood Bed",
                "position": [0.0, 0.475, -0.9],
                "rotationEuler": [0.0, 0.0, 0.0],
                "dimensions": [1.65, 0.95, 2.1],
            }
        ],
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 12. BUDGET-CAPPED SCENARIOS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-27",
        name="Strict Budget Ceiling ₹40,000",
        category="budget_capped",
        description="Layout proposal must not exceed budget cap of 4,000,000 paise (₹40,000).",
        user_request="Furnish a living area within strict budget of 40000 rupees",
        room_geometry={
            "width": 4.5,
            "length": 3.8,
            "height": 2.8,
            "openings": [{"id": "door-bg1", "wallId": "w-south", "type": "door", "center": [0.0, 1.9], "width": 0.9}],
        },
        budget_ceiling_paise=4000000,
        expected_required_categories=["seating"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-28",
        name="Moderate Budget Ceiling ₹1,00,000",
        category="budget_capped",
        description="Budget ceiling of 10,000,000 paise (₹1,00,000) allowing sofa + table + armchair.",
        user_request="Design a complete living room arrangement under 100000 rupees",
        room_geometry={
            "width": 5.2,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-bg2", "wallId": "w-south", "type": "door", "center": [0.0, 2.1], "width": 0.9}],
        },
        budget_ceiling_paise=10000000,
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 13. OVER-CONSTRAINED & NEGATIVE TEST CASES
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-29",
        name="Insufficient Physical Room Space (Negative Gate)",
        category="negative_constrained",
        description="Tiny 2.0x1.8m room requested to hold king bed and sectional sofa. Must trigger validation rejection.",
        user_request="Place a large sectional sofa and king size bed inside this tiny storage room",
        room_geometry={
            "width": 2.0,
            "length": 1.8,
            "height": 2.4,
            "openings": [{"id": "door-neg1", "wallId": "w-south", "type": "door", "center": [0.0, 0.9], "width": 0.8}],
        },
        expected_hard_valid=False,
    ),
    EvaluationCase(
        case_id="SCN-30",
        name="Incompatible Socket Attachment (Negative Gate)",
        category="negative_constrained",
        description="Attempt to attach a bed to a sofa front-table socket. Must be rejected as incompatible.",
        user_request="Testing incompatible socket: attach bed to sofa",
        room_geometry={
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-neg2", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        expected_hard_valid=False,
    ),

    # -------------------------------------------------------------
    # 14. ADVANCED GEOMETRY & WALL ANCHORING
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-31",
        name="Hexagonal Multi-Angle Studio",
        category="polygon",
        description="6-sided regular polygonal room requiring centered conversation grouping.",
        user_request="Arrange a conversation lounge in this hexagonal room",
        room_geometry={
            "width": 6.0,
            "length": 6.0,
            "height": 2.8,
            "footprint": [
                [0.0, -3.0],
                [2.6, -1.5],
                [2.6, 1.5],
                [0.0, 3.0],
                [-2.6, 1.5],
                [-2.6, -1.5],
            ],
            "openings": [{"id": "door-hex1", "wallId": "w-south", "type": "door", "center": [0.0, 3.0], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-32",
        name="Perimeter Wall Clearance & Alignment",
        category="workspace",
        description="Ensures workspace desk anchors along wall with back facing room center.",
        user_request="Place desk and office chair anchored cleanly against the north wall",
        room_geometry={
            "width": 4.2,
            "length": 3.6,
            "height": 2.8,
            "openings": [{"id": "door-w32", "wallId": "w-south", "type": "door", "center": [0.0, 1.8], "width": 0.9}],
        },
        expected_required_categories=["tables", "seating"],
        expected_hard_valid=True,
    ),
]


def get_scenario_by_id(case_id: str) -> Optional[EvaluationCase]:
    """Retrieve an evaluation scenario by its stable ID."""
    for case in EVALUATION_DATASET:
        if case.case_id == case_id:
            return case
    return None

