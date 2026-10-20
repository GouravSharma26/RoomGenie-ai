import time
from pathlib import Path
from typing import Any
from PIL import Image

from apps.rooms.vision.base import BaseRoomVisionAdapter, RoomAnalysisResult


class MockRoomVisionAdapter(BaseRoomVisionAdapter):
    """
    Deterministic offline mock adapter for room-photo vision analysis.
    Used for local development and automated tests without requiring external API keys.
    Returns structured room observations without mutating any 3D scenes.
    """

    def analyze_room_photo(
        self,
        image_path: str,
        context: dict[str, Any] | None = None
    ) -> RoomAnalysisResult:
        start_time = time.time()
        context = context or {}

        # 1. Read real image metadata to ground mock outputs in actual file properties
        p = Path(image_path)
        img_w, img_h = 1920, 1080
        img_format = 'JPEG'
        if p.exists() and p.is_file():
            try:
                with Image.open(p) as img:
                    img_w, img_h = img.size
                    img_format = (img.format or 'JPEG').upper()
            except Exception:
                pass

        orig_name = str(context.get('original_filename', '')).lower()
        hint = str(context.get('room_type_hint', '')).lower()
        search_text = f"{hint} {orig_name}"

        # 2. Match available furniture catalogue IDs safely
        from apps.furniture.models import FurnitureAsset

        def pick_asset(preferred_id: str, fallback_id: str) -> str | None:
            if FurnitureAsset.objects.filter(id=preferred_id, is_active=True).exists():  # pyrefly: ignore[missing-attribute]
                return preferred_id
            if FurnitureAsset.objects.filter(id=fallback_id, is_active=True).exists():  # pyrefly: ignore[missing-attribute]
                return fallback_id
            first = FurnitureAsset.objects.filter(is_active=True).first()  # pyrefly: ignore[missing-attribute]
            return first.id if first else None

        # 3. Determine room type observations
        if any(k in search_text for k in ['bedroom', 'bed', 'sleep']):
            room_type = 'bedroom'
            estimated_dims = {'width_m': 4.0, 'length_m': 4.5, 'height_m': 2.7}
            detected_furniture = [
                {
                    'category': 'bed',
                    'label': 'Queen Size Platform Bed',
                    'estimated_spatial_zone': 'center_back_wall',
                    'color': '#475569',
                    'material': 'upholstered_fabric',
                    'confidence': 0.94,
                    'bounding_box': {'ymin': 0.35, 'xmin': 0.20, 'ymax': 0.85, 'xmax': 0.80},
                    'approximate_dimensions_m': {'width_m': 1.6, 'length_m': 2.1, 'height_m': 0.95},
                    'suggested_catalogue_asset_id': pick_asset('bed-queen-platform', 'bed-queen-wood'),
                },
                {
                    'category': 'table',
                    'label': 'Bedside Nightstand',
                    'estimated_spatial_zone': 'left_lateral',
                    'color': '#78716c',
                    'material': 'natural_oak',
                    'confidence': 0.88,
                    'bounding_box': {'ymin': 0.48, 'xmin': 0.08, 'ymax': 0.78, 'xmax': 0.22},
                    'approximate_dimensions_m': {'width_m': 0.5, 'length_m': 0.45, 'height_m': 0.55},
                    'suggested_catalogue_asset_id': pick_asset('table-bedside-nightstand', 'table-nightstand-minimal'),
                },
                {
                    'category': 'storage',
                    'label': 'Clothes Wardrobe / Dresser',
                    'estimated_spatial_zone': 'right_wall',
                    'color': '#f8fafc',
                    'material': 'painted_wood',
                    'confidence': 0.85,
                    'bounding_box': {'ymin': 0.20, 'xmin': 0.78, 'ymax': 0.90, 'xmax': 0.98},
                    'approximate_dimensions_m': {'width_m': 0.9, 'length_m': 0.55, 'height_m': 1.85},
                    'suggested_catalogue_asset_id': pick_asset('storage-bookshelf-tall', 'bookshelf-4tier-metal'),
                },
            ]
            style_desc = "Calm contemporary bedroom with clean lines and soft ambient lighting."
            spatial_summary = "Focal bed placement centered against main wall with symmetrical clearance pathways."
        elif any(k in search_text for k in ['office', 'study', 'desk', 'work']):
            room_type = 'home_office'
            estimated_dims = {'width_m': 3.5, 'length_m': 4.0, 'height_m': 2.7}
            detected_furniture = [
                {
                    'category': 'table',
                    'label': 'Writing & Computer Desk',
                    'estimated_spatial_zone': 'facing_window',
                    'color': '#334155',
                    'material': 'wood_and_steel',
                    'confidence': 0.92,
                    'bounding_box': {'ymin': 0.40, 'xmin': 0.25, 'ymax': 0.82, 'xmax': 0.75},
                    'approximate_dimensions_m': {'width_m': 1.4, 'length_m': 0.75, 'height_m': 0.75},
                    'suggested_catalogue_asset_id': pick_asset('desk-workspace-study', 'table-desk-minimal'),
                },
                {
                    'category': 'seating',
                    'label': 'Ergonomic Task Chair',
                    'estimated_spatial_zone': 'center_desk',
                    'color': '#0f172a',
                    'material': 'mesh_and_nylon',
                    'confidence': 0.91,
                    'bounding_box': {'ymin': 0.45, 'xmin': 0.42, 'ymax': 0.88, 'xmax': 0.60},
                    'approximate_dimensions_m': {'width_m': 0.65, 'length_m': 0.65, 'height_m': 1.05},
                    'suggested_catalogue_asset_id': pick_asset('chair-accent-armchair', 'armchair-accent-nordic'),
                },
                {
                    'category': 'storage',
                    'label': 'Tall Shelving Unit',
                    'estimated_spatial_zone': 'right_wall',
                    'color': '#1e293b',
                    'material': 'powder_coated_metal',
                    'confidence': 0.89,
                    'bounding_box': {'ymin': 0.22, 'xmin': 0.78, 'ymax': 0.92, 'xmax': 0.96},
                    'approximate_dimensions_m': {'width_m': 0.8, 'length_m': 0.4, 'height_m': 1.9},
                    'suggested_catalogue_asset_id': pick_asset('storage-bookshelf-tall', 'bookshelf-4tier-metal'),
                },
            ]
            style_desc = "Functional modern workspace with organized layout and good natural desk illumination."
            spatial_summary = "Workstation oriented near perimeter light source with lateral reference shelving."
        else:
            # Default: Living room layout
            room_type = 'living_room'
            estimated_dims = {'width_m': 4.5, 'length_m': 5.5, 'height_m': 2.8}
            detected_furniture = [
                {
                    'category': 'seating',
                    'label': '3-Seater Fabric Sofa',
                    'estimated_spatial_zone': 'center_seating_zone',
                    'color': '#334155',
                    'material': 'woven_fabric',
                    'confidence': 0.95,
                    'bounding_box': {'ymin': 0.42, 'xmin': 0.25, 'ymax': 0.82, 'xmax': 0.80},
                    'approximate_dimensions_m': {'width_m': 2.2, 'length_m': 0.95, 'height_m': 0.85},
                    'suggested_catalogue_asset_id': pick_asset('sofa-modern-3seater', 'sofa-3seater-fabric'),
                },
                {
                    'category': 'table',
                    'label': 'Round Coffee Table',
                    'estimated_spatial_zone': 'foreground_center',
                    'color': '#b45309',
                    'material': 'solid_wood',
                    'confidence': 0.90,
                    'bounding_box': {'ymin': 0.62, 'xmin': 0.38, 'ymax': 0.88, 'xmax': 0.64},
                    'approximate_dimensions_m': {'width_m': 0.85, 'length_m': 0.85, 'height_m': 0.45},
                    'suggested_catalogue_asset_id': pick_asset('table-oak-coffee', 'table-coffee-round'),
                },
                {
                    'category': 'seating',
                    'label': 'Lounge Accent Armchair',
                    'estimated_spatial_zone': 'left_angled',
                    'color': '#4f46e5',
                    'material': 'velvet_upholstery',
                    'confidence': 0.89,
                    'bounding_box': {'ymin': 0.48, 'xmin': 0.08, 'ymax': 0.85, 'xmax': 0.28},
                    'approximate_dimensions_m': {'width_m': 0.85, 'length_m': 0.82, 'height_m': 0.88},
                    'suggested_catalogue_asset_id': pick_asset('chair-accent-armchair', 'armchair-accent-nordic'),
                },
                {
                    'category': 'storage',
                    'label': 'Media Console / Bookshelf',
                    'estimated_spatial_zone': 'right_wall',
                    'color': '#1e293b',
                    'material': 'engineered_wood',
                    'confidence': 0.84,
                    'bounding_box': {'ymin': 0.30, 'xmin': 0.82, 'ymax': 0.85, 'xmax': 0.98},
                    'approximate_dimensions_m': {'width_m': 1.2, 'length_m': 0.42, 'height_m': 1.4},
                    'suggested_catalogue_asset_id': pick_asset('storage-bookshelf-tall', 'bookshelf-4tier-metal'),
                },
            ]
            style_desc = "Contemporary Scandinavian living room featuring organic textures and a balanced conversational cluster."
            spatial_summary = "Central seating group facing inward with comfortable circulation pathways around the perimeter."

        observations: dict[str, Any] = {
            'room_type': room_type,
            'estimated_room_shape': 'rectangular',
            'estimated_dimensions_approx_m': estimated_dims,
            'overall_confidence': 0.92,
            'architectural_features': {
                'flooring': 'light_oak_hardwood',
                'wall_finish': 'matte_warm_white',
                'lighting': 'natural_light_large_windows',
                'windows_count': 2 if img_w >= img_h else 1,
                'doors_count': 1,
            },
            'detected_furniture': detected_furniture,
            'color_palette': [
                {'hex': '#f8fafc', 'name': 'Warm White', 'role': 'dominant_walls'},
                {'hex': '#334155', 'name': 'Slate Charcoal', 'role': 'primary_upholstery'},
                {'hex': '#b45309', 'name': 'Warm Amber Oak', 'role': 'wood_accents'},
                {'hex': '#4f46e5', 'name': 'Indigo Accent', 'role': 'decor_accent'},
            ],
            'style_description': style_desc,
            'spatial_summary': spatial_summary,
            'recommendations': [
                "Maintain minimum 0.8m clearance around central seating for smooth circulation.",
                "Verify architectural wall measurements and ceiling height before applying exact 3D models.",
                "Pair neutral wall palette with warm wood accents to sustain spatial warmth.",
            ],
            'uncertainty_notes': (
                "Exact physical room dimensions cannot be reliably inferred from a single uncalibrated 2D photograph. "
                "All detected furniture positions and spatial regions are qualitative suggestions. "
                "Please measure and confirm room dimensions (width, length, ceiling height) manually."
            ),
            'requires_user_confirmation': True,
        }

        latency = int((time.time() - start_time) * 1000)
        return RoomAnalysisResult(
            observations=observations,
            provider='mock',
            model='mock-room-vision-v1',
            latency_ms=latency,
            raw_metadata={
                'image_width': img_w,
                'image_height': img_h,
                'image_format': img_format,
            }
        )
