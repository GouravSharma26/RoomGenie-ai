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

    # -------------------------------------------------------------
    # 15. PREFERENCE-AWARE SCENARIOS (PHASE 7.1)
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-33",
        name="Minimalist Living Room with Wood & Warm Neutrals",
        category="preference_style",
        description="Tests style match, natural wood material preference, and warm neutrals colour score.",
        user_request="Design a minimalist conversational living room with warm neutrals and natural wood furniture",
        room_geometry={
            "width": 5.2,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-p33", "wallId": "w-south", "type": "door", "center": [0.0, 2.1], "width": 0.9}],
        },
        preferences={
            "styles": ["minimalist", "scandinavian"],
            "materials": ["wood"],
            "colours": ["warm_neutrals"],
            "layout_intent": ["conversational"],
            "functional_priorities": ["circulation"],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
        expected_min_preference_score=75.0,
    ),
    EvaluationCase(
        case_id="SCN-34",
        name="Scandinavian Functional Sleeping Zone",
        category="preference_style",
        description="Verifies Nordic pine bed and bedside nightstands match Scandinavian style and wood material preferences.",
        user_request="Arrange a scandinavian bedroom with pine bed and bedside nightstands",
        room_geometry={
            "width": 4.8,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-p34", "wallId": "w-south", "type": "door", "center": [1.5, 2.0], "width": 0.85}],
        },
        preferences={
            "styles": ["scandinavian", "minimalist"],
            "materials": ["wood"],
            "colours": ["warm_neutrals"],
            "layout_intent": ["symmetrical"],
            "functional_priorities": ["circulation"],
        },
        expected_required_categories=["beds", "tables"],
        expected_hard_valid=True,
        expected_min_preference_score=75.0,
    ),
    EvaluationCase(
        case_id="SCN-35",
        name="Industrial Ergonomic Workspace Setup",
        category="preference_style",
        description="Tests industrial style, metal materials, and workspace functional priorities.",
        user_request="Create an industrial workspace with study desk, office chair, and bookshelf",
        room_geometry={
            "width": 4.5,
            "length": 3.8,
            "height": 2.8,
            "openings": [{"id": "door-p35", "wallId": "w-south", "type": "door", "center": [0.0, 1.9], "width": 0.9}],
        },
        preferences={
            "styles": ["industrial"],
            "materials": ["metal"],
            "colours": ["cool_neutrals"],
            "layout_intent": ["workspace"],
            "functional_priorities": ["workspace", "storage"],
        },
        expected_required_categories=["tables", "seating"],
        expected_hard_valid=True,
        expected_min_preference_score=75.0,
    ),
    EvaluationCase(
        case_id="SCN-36",
        name="Natural Wood Material Focus",
        category="preference_material",
        description="Verifies high material match score for living room seating and tables crafted from oak wood.",
        user_request="Place living room seating and tables with natural oak wood",
        room_geometry={
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-p36", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        preferences={
            "materials": ["wood"],
            "colours": ["warm_neutrals"],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
        expected_min_preference_score=75.0,
    ),
    EvaluationCase(
        case_id="SCN-37",
        name="Cool Neutrals Palette Bedroom",
        category="preference_colour",
        description="Assesses colour matching against modern cool neutrals palette.",
        user_request="Arrange a bedroom sleeping area with cool neutrals",
        room_geometry={
            "width": 4.6,
            "length": 3.8,
            "height": 2.8,
            "openings": [{"id": "door-p37", "wallId": "w-south", "type": "door", "center": [1.0, 1.9], "width": 0.9}],
        },
        preferences={
            "colours": ["cool_neutrals"],
            "styles": ["modern"],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
        expected_min_preference_score=70.0,
    ),
    EvaluationCase(
        case_id="SCN-38",
        name="Open Floor Space & High Circulation Priority",
        category="preference_layout",
        description="Evaluates open floor layout preference and circulation functional priority.",
        user_request="Arrange a conversational living area prioritizing open floor space and clear circulation",
        room_geometry={
            "width": 5.4,
            "length": 4.4,
            "height": 2.8,
            "openings": [{"id": "door-p38", "wallId": "w-south", "type": "door", "center": [0.0, 2.2], "width": 0.9}],
        },
        preferences={
            "layout_intent": ["open_floor_space"],
            "functional_priorities": ["circulation", "open_floor_area"],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
        expected_min_preference_score=75.0,
    ),
    EvaluationCase(
        case_id="SCN-39",
        name="Perimeter Focus Arrangement",
        category="preference_layout",
        description="Tests perimeter focus layout dimension scoring against room boundaries.",
        user_request="Arrange furniture along perimeter walls",
        room_geometry={
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-p39", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        preferences={
            "layout_intent": ["perimeter_focus"],
            "functional_priorities": ["circulation"],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
        expected_min_preference_score=70.0,
    ),
    EvaluationCase(
        case_id="SCN-40",
        name="Storage Maximization Priority",
        category="preference_priority",
        description="Validates functional priority scoring when storage maximization is designated.",
        user_request="Set up a workspace prioritizing storage capacity",
        room_geometry={
            "width": 4.6,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-p40", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        preferences={
            "functional_priorities": ["storage", "workspace"],
        },
        expected_required_categories=["tables"],
        expected_hard_valid=True,
        expected_min_preference_score=75.0,
    ),
    EvaluationCase(
        case_id="SCN-41",
        name="Preservation of Existing Focal Sofa",
        category="preference_preservation",
        description="Tests preservation scoring when user asks to retain existing furniture while adding companion pieces.",
        user_request="Add coffee table and armchairs while preserving existing sofa",
        room_geometry={
            "width": 5.2,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-p41", "wallId": "w-south", "type": "door", "center": [0.0, 2.1], "width": 0.9}],
        },
        existing_objects=[
            {
                "id": "sofa-conv-anchor",
                "assetId": "sofa-modern-3seater",
                "name": "Modern 3-Seater Sofa",
                "position": [0.0, 0.45, -0.6],
                "rotation": [0, 0, 0],
                "dimensions": [2.1, 0.85, 0.9],
            }
        ],
        preservation_ids=["sofa-conv-anchor"],
        preferences={
            "preserve_object_ids": ["sofa-conv-anchor"],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
        expected_min_preference_score=85.0,
    ),
    EvaluationCase(
        case_id="SCN-42",
        name="Contradictory Preference Handling (Open Space vs Storage Heavy)",
        category="preference_conflict",
        description="Tests conflict detection when user specifies both open space and heavy storage priorities.",
        user_request="Create an open floor space living room with maximum storage",
        room_geometry={
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-p42", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        preferences={
            "layout_intent": ["open_floor_space"],
            "functional_priorities": ["storage"],
        },
        expected_required_categories=["seating"],
        expected_hard_valid=True,
        expected_min_preference_score=50.0,
    ),
    EvaluationCase(
        case_id="SCN-43",
        name="Empty Preference Profile Baseline (Phase 6 Equivalence)",
        category="preference_baseline",
        description="Verifies that empty preferences yield lambda=0.0 and 100% equivalence to Phase 6 base scoring.",
        user_request="Arrange a standard conversational living area with sofa and coffee table",
        room_geometry={
            "width": 5.0,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-p43", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        preferences={},
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
        expected_min_preference_score=95.0,
    ),
    EvaluationCase(
        case_id="SCN-44",
        name="Multi-Style Fusion: Japandi Aesthetic",
        category="preference_style",
        description="Tests multi-style fusion with Japandi aesthetic, matching Scandinavian minimalism and natural wood.",
        user_request="Design a japandi living room with clean minimalist lines and natural wood",
        room_geometry={
            "width": 5.2,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-p44", "wallId": "w-south", "type": "door", "center": [0.0, 2.1], "width": 0.9}],
        },
        preferences={
            "styles": ["japandi", "minimalist"],
            "materials": ["wood"],
            "colours": ["warm_neutrals"],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
        expected_min_preference_score=75.0,
    ),

    # -------------------------------------------------------------
    # 17. PHASE 7.2 OPTIMIZATION: COMPACT BEDROOM CONSTRAINT REPAIR
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-45",
        name="Ultra-Compact Master Bedroom (3.2m x 3.2m)",
        category="optimization_compact_bedroom",
        description="Requires active socket gap compaction (from 0.15m to 0.04m) to fit dual nightstands without wall breach.",
        user_request="Arrange a functional sleeping zone with bed and twin bedside nightstands",
        room_geometry={
            "width": 3.2,
            "length": 3.2,
            "height": 2.8,
            "openings": [{"id": "door-45", "wallId": "w-south", "type": "door", "center": [0.8, 1.6], "width": 0.9}],
        },
        expected_required_categories=["beds", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-46",
        name="Narrow Bedroom with Doorway Buffer (3.0m x 4.2m)",
        category="optimization_compact_bedroom",
        description="Tests bed headboard wall alignment and door landing clearance in narrow 3.0m room.",
        user_request="Furnish a peaceful master bedroom with queen platform bed and side storage",
        room_geometry={
            "width": 3.0,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-46", "wallId": "w-south", "type": "door", "center": [0.6, 2.1], "width": 0.9}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-47",
        name="Bed with Storage Integration in Tight Room",
        category="optimization_compact_bedroom",
        description="Verifies non-overlapping placement of bed, nightstand, and wardrobe in 3.4m x 3.4m room.",
        user_request="Design a bedroom zone with bed, nightstands and wardrobe",
        room_geometry={
            "width": 3.4,
            "length": 3.4,
            "height": 2.8,
            "openings": [{"id": "door-47", "wallId": "w-south", "type": "door", "center": [-1.0, 1.7], "width": 0.9}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-48",
        name="Square Bedside Compaction (3.1m x 3.1m)",
        category="optimization_compact_bedroom",
        description="Compact sleeping suite requiring minimal gap socket attachment.",
        user_request="Configure a sleeping suite with bed and twin nightstands",
        room_geometry={
            "width": 3.1,
            "length": 3.1,
            "height": 2.8,
            "openings": [{"id": "door-48", "wallId": "w-south", "type": "door", "center": [0.0, 1.55], "width": 0.9}],
        },
        expected_required_categories=["beds", "tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 18. PHASE 7.2 OPTIMIZATION: NARROW LIVING ROOM GROUP ROTATION
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-49",
        name="Narrow Living Room Long-Axis Alignment (3.4m x 5.8m)",
        category="optimization_narrow_living",
        description="Requires rotating sofa-coffee table group 90 degrees to align with 5.8m long axis.",
        user_request="Arrange a conversational living area with sofa, coffee table, and accent chairs",
        room_geometry={
            "width": 3.4,
            "length": 5.8,
            "height": 2.8,
            "openings": [{"id": "door-49", "wallId": "w-south", "type": "door", "center": [0.0, 2.9], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-50",
        name="Tight Living Space Circulation Recovery (3.6m x 4.8m)",
        category="optimization_narrow_living",
        description="Requires wall snapping and clearance nudging to preserve 0.90m walkway from entrance.",
        user_request="Set up an open-circulation living area with sofa and coffee table",
        room_geometry={
            "width": 3.6,
            "length": 4.8,
            "height": 2.8,
            "openings": [{"id": "door-50", "wallId": "w-south", "type": "door", "center": [-1.0, 2.4], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-51",
        name="Living Room Focal Wall Entertainment Alignment",
        category="optimization_narrow_living",
        description="Aligns media seating parallel to back wall with unobstructed central path.",
        user_request="Create a media entertainment living space oriented toward focal wall",
        room_geometry={
            "width": 4.0,
            "length": 5.0,
            "height": 2.8,
            "openings": [{"id": "door-51", "wallId": "w-south", "type": "door", "center": [0.0, 2.5], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-52",
        name="Living Room with Accent Seating Integration",
        category="optimization_narrow_living",
        description="Optimizes placement of accent armchair without encroaching entry door.",
        user_request="Arrange living room with sofa, coffee table, and accent chairs",
        room_geometry={
            "width": 4.2,
            "length": 4.6,
            "height": 2.8,
            "openings": [{"id": "door-52", "wallId": "w-south", "type": "door", "center": [1.4, 2.3], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 19. PHASE 7.2 OPTIMIZATION: POLYGON BOUNDARY REPAIR
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-53",
        name="L-Shaped Room Corner Containment Repair",
        category="optimization_polygon_repair",
        description="Pushes furniture out of reflex corner into main rectangular alcove.",
        user_request="Arrange an executive workspace with desk, chair, and storage",
        room_geometry={
            "width": 5.0,
            "length": 5.0,
            "height": 2.8,
            "footprint": [
                [-2.5, -2.5],
                [0.5, -2.5],
                [0.5, 0.0],
                [2.5, 0.0],
                [2.5, 2.5],
                [-2.5, 2.5],
            ],
            "openings": [{"id": "door-53", "wallId": "w-south", "type": "door", "center": [-1.0, 2.5], "width": 0.9}],
        },
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-54",
        name="Chamfered Pentagon Living Layout Optimization",
        category="optimization_polygon_repair",
        description="Repairs angled corner intrusions on pentagon perimeter.",
        user_request="Create an open-circulation living area with sofa and coffee table",
        room_geometry={
            "width": 5.4,
            "length": 4.8,
            "height": 2.8,
            "footprint": [
                [-2.7, -2.4],
                [1.5, -2.4],
                [2.7, -1.0],
                [2.7, 2.4],
                [-2.7, 2.4],
            ],
            "openings": [{"id": "door-54", "wallId": "w-south", "type": "door", "center": [0.0, 2.4], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-55",
        name="Concave Bedroom Alcove Containment",
        category="optimization_polygon_repair",
        description="Nudges bed and nightstands into deep alcove without crossing concave boundary.",
        user_request="Furnish a peaceful master bedroom with queen platform bed and side storage",
        room_geometry={
            "width": 5.5,
            "length": 4.5,
            "height": 2.8,
            "footprint": [
                [-2.75, -2.25],
                [2.75, -2.25],
                [2.75, 1.0],
                [1.0, 1.0],
                [1.0, 2.25],
                [-2.75, 2.25],
            ],
            "openings": [{"id": "door-55", "wallId": "w-south", "type": "door", "center": [-1.0, 2.25], "width": 0.9}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-56",
        name="Hexagonal Polygon Living Suite",
        category="optimization_polygon_repair",
        description="Hexagonal room geometry boundary compliance and central open space.",
        user_request="Design a media entertainment living space with sofa and coffee table",
        room_geometry={
            "width": 5.2,
            "length": 5.2,
            "height": 2.8,
            "footprint": [
                [-1.5, -2.6],
                [1.5, -2.6],
                [2.6, 0.0],
                [1.5, 2.6],
                [-1.5, 2.6],
                [-2.6, 0.0],
            ],
            "openings": [{"id": "door-56", "wallId": "w-south", "type": "door", "center": [0.0, 2.6], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 20. PHASE 7.2 OPTIMIZATION: MULTI-DOOR CIRCULATION PUSH
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-57",
        name="Dual Entrance High-Circulation Corridor Room",
        category="optimization_doorway_clearance",
        description="Clears high-traffic primary path connecting north and south entry doors.",
        user_request="Furnish a living area preserving clear walkways between both doors",
        room_geometry={
            "width": 4.8,
            "length": 5.2,
            "height": 2.8,
            "openings": [
                {"id": "door-57a", "wallId": "w-south", "type": "door", "center": [0.0, 2.6], "width": 0.9},
                {"id": "door-57b", "wallId": "w-north", "type": "door", "center": [0.0, -2.6], "width": 0.9},
            ],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-58",
        name="Corner Door and Balcony Door Clearance",
        category="optimization_doorway_clearance",
        description="Pushes furniture inward away from corner entry door and east balcony door.",
        user_request="Design a living room with sofa and coffee table with easy balcony access",
        room_geometry={
            "width": 5.0,
            "length": 4.5,
            "height": 2.8,
            "openings": [
                {"id": "door-58a", "wallId": "w-south", "type": "door", "center": [-1.8, 2.25], "width": 0.9},
                {"id": "door-58b", "wallId": "w-east", "type": "door", "center": [2.5, 0.0], "width": 0.9},
            ],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-59",
        name="Triple Opening Studio Apartment",
        category="optimization_doorway_clearance",
        description="Main door, bathroom door, and patio door landing buffer preservation.",
        user_request="Arrange a functional sleeping zone with bed and twin bedside nightstands",
        room_geometry={
            "width": 5.4,
            "length": 4.6,
            "height": 2.8,
            "openings": [
                {"id": "door-59a", "wallId": "w-south", "type": "door", "center": [-1.5, 2.3], "width": 0.9},
                {"id": "door-59b", "wallId": "w-west", "type": "door", "center": [-2.7, -1.0], "width": 0.8},
                {"id": "door-59c", "wallId": "w-north", "type": "door", "center": [1.5, -2.3], "width": 0.9},
            ],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-60",
        name="Study with Connecting En-Suite Door",
        category="optimization_doorway_clearance",
        description="Preserves 0.90m landing zone for en-suite door while positioning desk and chair.",
        user_request="Design an executive workspace with desk, chair, and storage",
        room_geometry={
            "width": 4.4,
            "length": 3.8,
            "height": 2.8,
            "openings": [
                {"id": "door-60a", "wallId": "w-south", "type": "door", "center": [0.0, 1.9], "width": 0.9},
                {"id": "door-60b", "wallId": "w-east", "type": "door", "center": [2.2, -0.8], "width": 0.8},
            ],
        },
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 21. PHASE 7.2 OPTIMIZATION: DENSE MULTI-ZONE APARTMENTS
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-61",
        name="Live-Work Studio (Sleeping & Workspace)",
        category="optimization_dense_studio",
        description="Simultaneous placement of bed, nightstand, and study desk in 4.8m x 4.8m studio.",
        user_request="Furnish a functional bedroom with dedicated study workspace desk",
        room_geometry={
            "width": 4.8,
            "length": 4.8,
            "height": 2.8,
            "openings": [{"id": "door-61", "wallId": "w-south", "type": "door", "center": [0.0, 2.4], "width": 0.9}],
        },
        expected_required_categories=["beds", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-62",
        name="Studio Apartment with Storage Wall",
        category="optimization_dense_studio",
        description="Perimeter wardrobe and bookshelf distribution in dense apartment.",
        user_request="Furnish bedroom with bed, nightstands and wardrobe storage",
        room_geometry={
            "width": 4.5,
            "length": 4.5,
            "height": 2.8,
            "openings": [{"id": "door-62", "wallId": "w-south", "type": "door", "center": [-1.2, 2.25], "width": 0.9}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-63",
        name="Living-Dining Dual Zone Distribution",
        category="optimization_dense_studio",
        description="Zonal separation of living lounge and workspace zones.",
        user_request="Create an open-circulation living area with sofa and coffee table",
        room_geometry={
            "width": 5.6,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-63", "wallId": "w-south", "type": "door", "center": [0.0, 2.1], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-64",
        name="Executive Study with Reference Library",
        category="optimization_dense_studio",
        description="Integrates study desk and dual tall bookshelves along opposite perimeter walls.",
        user_request="Design an executive workspace with desk, chair, and storage",
        room_geometry={
            "width": 4.6,
            "length": 3.6,
            "height": 2.8,
            "openings": [{"id": "door-64", "wallId": "w-south", "type": "door", "center": [0.0, 1.8], "width": 0.9}],
        },
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 22. PHASE 7.2 OPTIMIZATION: OPEN SPACE RECOVERY
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-65",
        name="Central Open-Space Maximization Living Area",
        category="optimization_open_space_recovery",
        description="Pushes furniture toward perimeter walls to maximize central open floor space.",
        user_request="Design a living room maximizing open central floor area",
        room_geometry={
            "width": 5.2,
            "length": 4.6,
            "height": 2.8,
            "openings": [{"id": "door-65", "wallId": "w-south", "type": "door", "center": [0.0, 2.3], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-66",
        name="Open Bedroom Floor Space Optimization",
        category="optimization_open_space_recovery",
        description="Streamlined bed and nightstand layout leaving > 65% of floor area open.",
        user_request="Configure a minimalist open bedroom layout with essential bedside storage",
        room_geometry={
            "width": 4.8,
            "length": 4.2,
            "height": 2.8,
            "openings": [{"id": "door-66", "wallId": "w-south", "type": "door", "center": [0.0, 2.1], "width": 0.9}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-67",
        name="Unobstructed Workspace Pathway Optimization",
        category="optimization_open_space_recovery",
        description="Places study desk along perimeter to leave wide central circulation corridor.",
        user_request="Set up an open-circulation home office desk and chair",
        room_geometry={
            "width": 4.5,
            "length": 3.8,
            "height": 2.8,
            "openings": [{"id": "door-67", "wallId": "w-south", "type": "door", "center": [-1.0, 1.9], "width": 0.9}],
        },
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-68",
        name="Spacious Social Living Room",
        category="optimization_open_space_recovery",
        description="Maintains generous 1.2m human circulation paths around seating perimeter.",
        user_request="Arrange a conversational living area with sofa, coffee table, and accent chairs",
        room_geometry={
            "width": 5.4,
            "length": 4.6,
            "height": 2.8,
            "openings": [{"id": "door-68", "wallId": "w-south", "type": "door", "center": [0.0, 2.3], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),

    # -------------------------------------------------------------
    # 23. PHASE 7.2 OPTIMIZATION: OVER-CONSTRAINED NEGATIVE CASES
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-69",
        name="Impossible Micro-Room (2.0m x 1.8m)",
        category="optimization_negative_overconstrained",
        description="Physically impossible to place queen bed (1.6m x 2.1m) inside 1.8m long room.",
        user_request="Furnish a peaceful master bedroom with queen platform bed and side storage",
        room_geometry={
            "width": 2.0,
            "length": 1.8,
            "height": 2.4,
            "openings": [{"id": "door-69", "wallId": "w-south", "type": "door", "center": [0.0, 0.9], "width": 0.8}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=False,
    ),
    EvaluationCase(
        case_id="SCN-70",
        name="Tiny 2.2m x 2.0m Room with Full Living Set",
        category="optimization_negative_overconstrained",
        description="Full 3-seater sofa + coffee table + armchairs cannot fit in 2.2m x 2.0m footprint.",
        user_request="Arrange a conversational living area with sofa, coffee table, and accent chairs",
        room_geometry={
            "width": 2.2,
            "length": 2.0,
            "height": 2.4,
            "openings": [{"id": "door-70", "wallId": "w-south", "type": "door", "center": [0.0, 1.0], "width": 0.8}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=False,
    ),
    EvaluationCase(
        case_id="SCN-71",
        name="Severe Multi-Door Obstruction",
        category="optimization_negative_overconstrained",
        description="4 active doors on all 4 walls leaving zero legal footprint for 3-seater sofa.",
        user_request="Create an open-circulation living area with sofa and coffee table",
        room_geometry={
            "width": 2.8,
            "length": 2.8,
            "height": 2.4,
            "openings": [
                {"id": "door-71a", "wallId": "w-north", "type": "door", "center": [0.0, -1.4], "width": 0.9},
                {"id": "door-71b", "wallId": "w-south", "type": "door", "center": [0.0, 1.4], "width": 0.9},
                {"id": "door-71c", "wallId": "w-east", "type": "door", "center": [1.4, 0.0], "width": 0.9},
                {"id": "door-71d", "wallId": "w-west", "type": "door", "center": [-1.4, 0.0], "width": 0.9},
            ],
        },
        expected_required_categories=["seating"],
        expected_hard_valid=False,
    ),

    # -------------------------------------------------------------
    # 24. PHASE 7.2 OPTIMIZATION: DIVERSITY & PARETO MODES
    # -------------------------------------------------------------
    EvaluationCase(
        case_id="SCN-72",
        name="Pareto Trade-Off: Circulation vs Storage",
        category="optimization_diversity_modes",
        description="Tests diverse Pareto candidate generation balancing storage capacity against circulation score.",
        user_request="Furnish bedroom with bed, nightstands and wardrobe storage",
        room_geometry={
            "width": 5.0,
            "length": 4.5,
            "height": 2.8,
            "openings": [{"id": "door-72", "wallId": "w-south", "type": "door", "center": [0.0, 2.25], "width": 0.9}],
        },
        expected_required_categories=["beds"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-73",
        name="Multi-Candidate Divergence: Living Suite",
        category="optimization_diversity_modes",
        description="Verifies pairwise candidate diversity score >= 70 across 3 distinct living proposals.",
        user_request="Arrange a conversational living area with sofa, coffee table, and accent chairs",
        room_geometry={
            "width": 5.4,
            "length": 4.6,
            "height": 2.8,
            "openings": [{"id": "door-73", "wallId": "w-south", "type": "door", "center": [0.0, 2.3], "width": 0.9}],
        },
        expected_required_categories=["seating", "tables"],
        expected_hard_valid=True,
    ),
    EvaluationCase(
        case_id="SCN-74",
        name="Workspace Multi-Layout Exploration",
        category="optimization_diversity_modes",
        description="Generates daylight-oriented, wall-aligned, and central-focused study layouts.",
        user_request="Design an executive workspace with desk, chair, and storage",
        room_geometry={
            "width": 4.6,
            "length": 4.0,
            "height": 2.8,
            "openings": [{"id": "door-74", "wallId": "w-south", "type": "door", "center": [0.0, 2.0], "width": 0.9}],
        },
        expected_required_categories=["tables"],
        expected_hard_valid=True,
    ),
]


def get_scenario_by_id(case_id: str) -> Optional[EvaluationCase]:
    """Retrieve an evaluation scenario by its stable ID."""
    for case in EVALUATION_DATASET:
        if case.case_id == case_id:
            return case
    return None

