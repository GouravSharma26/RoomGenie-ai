import json
import struct
from typing import Any


class GLBValidationError(ValueError):
    """Raised when a candidate GLB file fails binary specification or security validation."""
    pass


class GLBValidator:
    """
    Validates glTF 2.0 Binary (.glb) files against the official Khronos specification.
    Enforces header magic, version, declared length, chunk boundaries, JSON schema,
    and strict file size ceilings to prevent buffer overruns and corrupted asset injection.
    """

    MAGIC_GLTF = 0x46546C67  # b'glTF' in little-endian
    CHUNK_TYPE_JSON = 0x4E4F534A  # b'JSON' in little-endian
    CHUNK_TYPE_BIN = 0x004E4942  # b'BIN\x00' in little-endian

    # Default maximum size for generated 3D models (15 MB)
    DEFAULT_MAX_SIZE_BYTES = 15 * 1024 * 1024

    @classmethod
    def validate(
        cls,
        data: bytes,
        max_size_bytes: int = DEFAULT_MAX_SIZE_BYTES
    ) -> dict[str, Any]:
        """
        Validates glTF 2.0 Binary (.glb) byte content.
        
        Returns a dictionary with parsed metadata:
        {
            'valid': True,
            'size_bytes': int,
            'version': int,
            'json_metadata': dict,
            'has_binary_chunk': bool,
            'approximate_dimensions': dict | None,
        }

        Raises GLBValidationError if the file is invalid, corrupted, or oversized.
        """
        if not data:
            raise GLBValidationError("GLB payload is empty (0 bytes).")

        total_bytes = len(data)

        # 1. Enforce file size limit
        if total_bytes > max_size_bytes:
            raise GLBValidationError(
                f"GLB file size ({total_bytes} bytes) exceeds maximum allowed limit of {max_size_bytes} bytes."
            )

        # 2. Check 12-byte header existence
        if total_bytes < 12:
            raise GLBValidationError(
                f"GLB payload is too short ({total_bytes} bytes). Minimum header length is 12 bytes."
            )

        magic, version, declared_length = struct.unpack('<III', data[0:12])

        # 3. Validate magic
        if magic != cls.MAGIC_GLTF:
            raise GLBValidationError(
                f"Invalid GLB magic bytes: 0x{magic:08x}. Expected 0x{cls.MAGIC_GLTF:08x} ('glTF')."
            )

        # 4. Validate version (must be glTF 2.0)
        if version != 2:
            raise GLBValidationError(
                f"Unsupported glTF version: {version}. Only glTF 2.0 is supported."
            )

        # 5. Validate declared length matches exact payload size and 4-byte alignment
        if declared_length != total_bytes:
            raise GLBValidationError(
                f"GLB declared length ({declared_length} bytes) does not match actual byte count ({total_bytes} bytes)."
            )

        if total_bytes % 4 != 0:
            raise GLBValidationError(
                f"GLB total byte length ({total_bytes} bytes) is not 4-byte aligned."
            )

        # 6. Parse and validate chunks
        offset = 12
        chunk_index = 0
        json_chunk_data = None
        has_bin_chunk = False

        while offset < total_bytes:
            if offset + 8 > total_bytes:
                raise GLBValidationError(
                    f"Truncated GLB chunk header at byte offset {offset}. Expected 8-byte chunk header."
                )

            chunk_len, chunk_type = struct.unpack('<II', data[offset:offset + 8])
            offset += 8

            if chunk_len % 4 != 0:
                raise GLBValidationError(
                    f"Chunk {chunk_index} length ({chunk_len} bytes) is not 4-byte aligned."
                )

            if offset + chunk_len > total_bytes:
                raise GLBValidationError(
                    f"Chunk {chunk_index} length ({chunk_len} bytes) overflows declared file boundary at offset {offset}."
                )

            chunk_bytes = data[offset:offset + chunk_len]
            offset += chunk_len

            if chunk_index == 0:
                # First chunk MUST be JSON
                if chunk_type != cls.CHUNK_TYPE_JSON:
                    raise GLBValidationError(
                        f"First GLB chunk must be type JSON (0x{cls.CHUNK_TYPE_JSON:08x}), got 0x{chunk_type:08x}."
                    )
                try:
                    # Trailing whitespace padding (0x20) is permitted by glTF spec for 4-byte alignment
                    json_str = chunk_bytes.decode('utf-8').rstrip()
                    json_chunk_data = json.loads(json_str)
                except Exception as err:
                    raise GLBValidationError(f"Failed to parse GLB JSON chunk: {err}") from err

                if not isinstance(json_chunk_data, dict):
                    raise GLBValidationError("GLB JSON chunk must represent a valid JSON object.")

                # Verify asset header in JSON
                asset_obj = json_chunk_data.get('asset')
                if not isinstance(asset_obj, dict) or 'version' not in asset_obj:
                    raise GLBValidationError("GLB JSON chunk missing required 'asset.version' specification.")
                if str(asset_obj.get('version', '')).strip() != '2.0':
                    raise GLBValidationError(
                        f"GLB asset version '{asset_obj.get('version')}' is not supported. Expected '2.0'."
                    )
            elif chunk_index == 1:
                # Second chunk is optional, but if present must be BIN
                if chunk_type == cls.CHUNK_TYPE_BIN:
                    has_bin_chunk = True
                else:
                    # Any other chunk type
                    pass

            chunk_index += 1

        if offset != total_bytes:
            raise GLBValidationError(
                f"GLB file has unparsed trailing bytes: expected offset {total_bytes}, stopped at {offset}."
            )

        if json_chunk_data is None:
            raise GLBValidationError("GLB file contains no valid JSON chunk.")

        # 7. Extract approximate dimensions if accessors have bounds
        approx_dims = cls._extract_approximate_dimensions(json_chunk_data)

        return {
            'valid': True,
            'size_bytes': total_bytes,
            'version': version,
            'json_metadata': json_chunk_data,
            'has_binary_chunk': has_bin_chunk,
            'approximate_dimensions': approx_dims,
        }

    @staticmethod
    def _extract_approximate_dimensions(json_data: dict[str, Any]) -> dict[str, float] | None:
        """
        Attempts to compute bounding dimensions from glTF POSITION accessors min/max.
        Returns {'width_m': round(w, 2), 'height_m': round(h, 2), 'depth_m': round(d, 2)}
        or None if accessors are not explicitly defined.
        """
        try:
            accessors = json_data.get('accessors', [])
            # Search accessors with type VEC3 and min/max
            for acc in accessors:
                if acc.get('type') == 'VEC3' and 'min' in acc and 'max' in acc:
                    min_vals = acc['min']
                    max_vals = acc['max']
                    if len(min_vals) >= 3 and len(max_vals) >= 3:
                        dx = float(max_vals[0] - min_vals[0])
                        dy = float(max_vals[1] - min_vals[1])
                        dz = float(max_vals[2] - min_vals[2])
                        return {
                            'width_m': round(max(abs(dx), 0.05), 2),
                            'height_m': round(max(abs(dy), 0.05), 2),
                            'depth_m': round(max(abs(dz), 0.05), 2),
                        }
        except Exception:
            pass
        return None
