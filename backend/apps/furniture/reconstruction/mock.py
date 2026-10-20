import json
import struct
import time
from typing import Any

from apps.furniture.reconstruction.base import BaseImageTo3DAdapter, ReconstructionResult
from apps.furniture.reconstruction.validator import GLBValidator


def build_procedural_furniture_glb(
    width: float = 1.0,
    height: float = 0.8,
    depth: float = 0.9,
    color_rgb: tuple[float, float, float] = (0.31, 0.27, 0.89)  # #4f46e5 indigo default
) -> bytes:
    """
    Builds a genuine, specification-compliant glTF 2.0 binary (.glb) model of
    an approximate procedural 3D furniture piece using Python standard library struct/json.
    Produces valid 24-vertex box geometry with normals, indices, and PBR materials.
    Parses cleanly in Three.js GLTFLoader and passes strict GLBValidator checks.
    """
    w2, h2, d2 = width / 2.0, height / 2.0, depth / 2.0

    # 6 faces * 4 vertices = 24 vertices
    # Each vertex: [x, y, z] and normal [nx, ny, nz]
    faces = [
        # Front (+Z)
        ([-w2, -h2,  d2], [ w2, -h2,  d2], [ w2,  h2,  d2], [-w2,  h2,  d2], [0, 0, 1]),
        # Back (-Z)
        ([ w2, -h2, -d2], [-w2, -h2, -d2], [-w2,  h2, -d2], [ w2,  h2, -d2], [0, 0, -1]),
        # Top (+Y)
        ([-w2,  h2,  d2], [ w2,  h2,  d2], [ w2,  h2, -d2], [-w2,  h2, -d2], [0, 1, 0]),
        # Bottom (-Y)
        ([-w2, -h2, -d2], [ w2, -h2, -d2], [ w2, -h2,  d2], [-w2, -h2,  d2], [0, -1, 0]),
        # Right (+X)
        ([ w2, -h2,  d2], [ w2, -h2, -d2], [ w2,  h2, -d2], [ w2,  h2,  d2], [1, 0, 0]),
        # Left (-X)
        ([-w2, -h2, -d2], [-w2, -h2,  d2], [-w2,  h2,  d2], [-w2,  h2, -d2], [-1, 0, 0]),
    ]

    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []

    v_idx = 0
    for v0, v1, v2, v3, norm in faces:
        for v in (v0, v1, v2, v3):
            positions.extend([float(v[0]), float(v[1]), float(v[2])])
            normals.extend([float(norm[0]), float(norm[1]), float(norm[2])])
        # Two triangles per face (v0, v1, v2) and (v0, v2, v3)
        indices.extend([v_idx, v_idx + 1, v_idx + 2, v_idx, v_idx + 2, v_idx + 3])
        v_idx += 4

    # Pack binary buffer
    # 1. Indices: uint16 (36 indices * 2 bytes = 72 bytes)
    index_bytes = struct.pack(f'<{len(indices)}H', *indices)

    # 2. Positions: float32 (24 vertices * 3 * 4 bytes = 288 bytes)
    position_bytes = struct.pack(f'<{len(positions)}f', *positions)

    # 3. Normals: float32 (24 vertices * 3 * 4 bytes = 288 bytes)
    normal_bytes = struct.pack(f'<{len(normals)}f', *normals)

    bin_data = index_bytes + position_bytes + normal_bytes
    # Pad bin_data to 4-byte alignment
    bin_pad = (4 - (len(bin_data) % 4)) % 4
    bin_data += b'\x00' * bin_pad

    min_pos = [-w2, -h2, -d2]
    max_pos = [w2, h2, d2]

    # glTF JSON structure
    gltf_dict = {
        "asset": {
            "version": "2.0",
            "generator": "RoomGenie Procedural Furniture Reconstruction Engine"
        },
        "scene": 0,
        "scenes": [
            {"nodes": [0]}
        ],
        "nodes": [
            {
                "mesh": 0,
                "name": "ApproximateFurnitureModel",
                "translation": [0, h2, 0]  # Place base at origin (y=0)
            }
        ],
        "materials": [
            {
                "name": "ApproximateMaterial",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
                    "metallicFactor": 0.1,
                    "roughnessFactor": 0.65
                },
                "doubleSided": True
            }
        ],
        "meshes": [
            {
                "name": "FurnitureMesh",
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": 1,
                            "NORMAL": 2
                        },
                        "indices": 0,
                        "material": 0,
                        "mode": 4  # TRIANGLES
                    }
                ]
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5123,  # UNSIGNED_SHORT
                "count": len(indices),
                "type": "SCALAR",
                "max": [len(faces) * 4 - 1],
                "min": [0]
            },
            {
                "bufferView": 1,
                "byteOffset": 0,
                "componentType": 5126,  # FLOAT
                "count": len(positions) // 3,
                "type": "VEC3",
                "max": max_pos,
                "min": min_pos
            },
            {
                "bufferView": 2,
                "byteOffset": 0,
                "componentType": 5126,  # FLOAT
                "count": len(normals) // 3,
                "type": "VEC3",
                "max": [1.0, 1.0, 1.0],
                "min": [-1.0, -1.0, -1.0]
            }
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": 0,
                "byteLength": len(index_bytes),
                "target": 34963  # ELEMENT_ARRAY_BUFFER
            },
            {
                "buffer": 0,
                "byteOffset": len(index_bytes),
                "byteLength": len(position_bytes),
                "target": 34962  # ARRAY_BUFFER
            },
            {
                "buffer": 0,
                "byteOffset": len(index_bytes) + len(position_bytes),
                "byteLength": len(normal_bytes),
                "target": 34962  # ARRAY_BUFFER
            }
        ],
        "buffers": [
            {
                "byteLength": len(bin_data)
            }
        ]
    }

    json_bytes = json.dumps(gltf_dict, separators=(',', ':')).encode('utf-8')
    # Pad JSON chunk to 4-byte alignment with spaces (0x20)
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b' ' * json_pad

    # GLB Header: 12 bytes
    # Chunk 0 Header: 8 bytes (len, 'JSON')
    # Chunk 1 Header: 8 bytes (len, 'BIN\0')
    total_glb_len = 12 + 8 + len(json_bytes) + 8 + len(bin_data)

    glb_header = struct.pack('<III', GLBValidator.MAGIC_GLTF, 2, total_glb_len)
    chunk0_header = struct.pack('<II', len(json_bytes), GLBValidator.CHUNK_TYPE_JSON)
    chunk1_header = struct.pack('<II', len(bin_data), GLBValidator.CHUNK_TYPE_BIN)

    return glb_header + chunk0_header + json_bytes + chunk1_header + bin_data


class MockImageTo3DAdapter(BaseImageTo3DAdapter):
    """
    Deterministic offline mock adapter for photo-to-3D furniture reconstruction.
    Generates genuine, parseable glTF 2.0 binary (.glb) files with procedural 3D geometry.
    Used for local development and CI testing without incurring external API costs.
    """

    CATALOGUE_FALLBACKS: dict[str, str] = {
        'seating': 'sofa-modern-3seater',
        'tables': 'table-oak-coffee',
        'storage': 'storage-bookshelf-tall',
        'beds': 'bed-queen-platform',
        'decor': 'decor-plant-floor-vase',
    }

    DEFAULT_DIMENSIONS: dict[str, dict[str, float]] = {
        'seating': {'width_m': 1.6, 'height_m': 0.85, 'depth_m': 0.9},
        'tables': {'width_m': 1.2, 'height_m': 0.45, 'depth_m': 0.6},
        'storage': {'width_m': 1.0, 'height_m': 1.8, 'depth_m': 0.4},
        'beds': {'width_m': 1.6, 'height_m': 0.95, 'depth_m': 2.1},
        'decor': {'width_m': 0.4, 'height_m': 1.1, 'depth_m': 0.4},
    }

    def generate_furniture_model(
        self,
        image_path: str,
        category: str = 'seating',
        prompt_label: str = '',
        reference_dimensions: dict[str, float] | None = None,
        context: dict[str, Any] | None = None
    ) -> ReconstructionResult:
        start_time = time.time()
        context = context or {}

        # 1. Support test simulation hooks
        if context.get('simulate_failure'):
            raise RuntimeError(context.get('failure_message', "Simulated image-to-3D provider failure."))

        if context.get('simulate_invalid_glb'):
            # Return corrupt or non-GLB bytes
            return ReconstructionResult(
                model_bytes=b"<html><head><title>502 Bad Gateway</title></head></html>",
                format='glb',
                approximate_dimensions={'width_m': 1.0, 'height_m': 1.0, 'depth_m': 1.0},
                provider='mock',
                model_name='mock-image-to-3d-v1',
                latency_ms=10,
                suggested_catalogue_fallback_id=self.CATALOGUE_FALLBACKS.get(category, 'sofa-modern-3seater')
            )

        if context.get('simulate_oversized_glb'):
            # Exceeds 15MB limit
            oversized_bytes = b'glTF' + b'\x00' * (16 * 1024 * 1024)
            return ReconstructionResult(
                model_bytes=oversized_bytes,
                format='glb',
                approximate_dimensions={'width_m': 1.0, 'height_m': 1.0, 'depth_m': 1.0},
                provider='mock',
                model_name='mock-image-to-3d-v1',
                latency_ms=10,
                suggested_catalogue_fallback_id=self.CATALOGUE_FALLBACKS.get(category, 'sofa-modern-3seater')
            )

        # 2. Determine target dimensions
        base_dims = self.DEFAULT_DIMENSIONS.get(category, self.DEFAULT_DIMENSIONS['seating'])
        w = float(reference_dimensions.get('width_m', base_dims['width_m'])) if reference_dimensions else base_dims['width_m']
        h = float(reference_dimensions.get('height_m', base_dims['height_m'])) if reference_dimensions else base_dims['height_m']
        d = float(reference_dimensions.get('depth_m', base_dims['depth_m'])) if reference_dimensions else base_dims['depth_m']

        # Ensure sensible bounds
        w = max(0.2, min(5.0, w))
        h = max(0.2, min(3.0, h))
        d = max(0.2, min(5.0, d))

        # 3. Generate procedural GLB bytes
        color_map = {
            'seating': (0.31, 0.27, 0.89),   # Indigo
            'tables': (0.71, 0.33, 0.04),    # Warm Amber
            'storage': (0.12, 0.16, 0.23),   # Slate
            'beds': (0.28, 0.33, 0.41),      # Nordic Gray
            'decor': (0.06, 0.45, 0.35),     # Forest Green
        }
        color_rgb = color_map.get(category, (0.31, 0.27, 0.89))

        glb_bytes = build_procedural_furniture_glb(width=w, height=h, depth=d, color_rgb=color_rgb)

        # 4. Self-validate with GLBValidator to ensure 100% compliance
        validation_meta = GLBValidator.validate(glb_bytes)

        fallback_id = self.CATALOGUE_FALLBACKS.get(category, 'sofa-modern-3seater')
        latency = int((time.time() - start_time) * 1000)

        return ReconstructionResult(
            model_bytes=glb_bytes,
            format='glb',
            approximate_dimensions={
                'width_m': round(w, 2),
                'height_m': round(h, 2),
                'depth_m': round(d, 2),
            },
            provider='mock',
            model_name='mock-image-to-3d-v1',
            latency_ms=latency,
            suggested_catalogue_fallback_id=fallback_id,
            raw_metadata={
                'validation_checked': True,
                'chunk_count': 2,
                'mesh_name': 'FurnitureMesh',
                'category': category,
                'source': 'Mock procedural geometry engine',
            }
        )
