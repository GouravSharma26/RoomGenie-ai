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

    COMPONENT_TYPE_SIZES: dict[int, int] = {
        5120: 1,  # BYTE
        5121: 1,  # UNSIGNED_BYTE
        5122: 2,  # SHORT
        5123: 2,  # UNSIGNED_SHORT
        5125: 4,  # UNSIGNED_INT
        5126: 4,  # FLOAT
    }

    TYPE_NUM_COMPONENTS: dict[str, int] = {
        'SCALAR': 1,
        'VEC2': 2,
        'VEC3': 3,
        'VEC4': 4,
        'MAT2': 4,
        'MAT3': 9,
        'MAT4': 16,
    }

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

        offset = 12
        chunk_index = 0
        json_chunk_data = None
        has_bin_chunk = False
        bin_chunk_len = 0

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
                    bin_chunk_len = len(chunk_bytes)
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

        # 7. Cross-check declared glTF buffers and bufferViews against binary chunk data
        cls._validate_buffers_and_views(json_chunk_data, has_bin_chunk, bin_chunk_len)

        # 8. Extract approximate dimensions if accessors have bounds
        approx_dims = cls._extract_approximate_dimensions(json_chunk_data)

        return {
            'valid': True,
            'size_bytes': total_bytes,
            'version': version,
            'json_metadata': json_chunk_data,
            'has_binary_chunk': has_bin_chunk,
            'approximate_dimensions': approx_dims,
        }

    @classmethod
    def _validate_buffers_and_views(
        cls,
        json_data: dict[str, Any],
        has_bin_chunk: bool,
        bin_chunk_len: int
    ) -> None:
        """
        Cross-checks declared glTF buffers, buffer views, and accessors against available
        binary chunk data. Rejects models that reference missing, corrupted, or insufficient binary data.
        """
        buffers = json_data.get('buffers')
        buffer_views = json_data.get('bufferViews')

        # 1. Validate buffers declaration
        if buffers is not None:
            if not isinstance(buffers, list):
                raise GLBValidationError("glTF 'buffers' field must be a list.")

            for idx, buf in enumerate(buffers):
                if not isinstance(buf, dict):
                    raise GLBValidationError(f"glTF buffer at index {idx} must be an object.")
                byte_length = buf.get('byteLength')
                if not isinstance(byte_length, int) or byte_length <= 0:
                    raise GLBValidationError(
                        f"glTF buffer at index {idx} has invalid byteLength: {byte_length}. Must be a positive integer."
                    )

                has_uri = 'uri' in buf and buf['uri'] is not None

                # In a GLB container, buffer 0 typically represents the BIN chunk (omits uri)
                if idx == 0 and not has_uri:
                    if not has_bin_chunk:
                        raise GLBValidationError(
                            "glTF buffer 0 references binary chunk, but GLB file contains no BIN chunk (missing binary data)."
                        )
                    if byte_length > bin_chunk_len:
                        raise GLBValidationError(
                            f"glTF buffer 0 declared byteLength ({byte_length} bytes) exceeds available BIN chunk size ({bin_chunk_len} bytes) (insufficient binary data)."
                        )
                elif idx > 0 and not has_uri:
                    raise GLBValidationError(
                        f"glTF buffer at index {idx} missing URI. Only buffer 0 may reference the GLB binary chunk."
                    )

        # 2. Validate bufferViews
        if buffer_views is not None:
            if not isinstance(buffer_views, list):
                raise GLBValidationError("glTF 'bufferViews' field must be a list.")

            if buffer_views and (not buffers or not isinstance(buffers, list)):
                raise GLBValidationError(
                    "glTF defines bufferViews but contains no buffers definition (missing binary data)."
                )

            for idx, bv in enumerate(buffer_views):
                if not isinstance(bv, dict):
                    raise GLBValidationError(f"glTF bufferView at index {idx} must be an object.")

                buf_idx = bv.get('buffer')
                if not isinstance(buf_idx, int) or buf_idx < 0 or buf_idx >= len(buffers):
                    raise GLBValidationError(
                        f"glTF bufferView at index {idx} references invalid buffer index {buf_idx}."
                    )

                bv_len = bv.get('byteLength')
                if not isinstance(bv_len, int) or bv_len <= 0:
                    raise GLBValidationError(
                        f"glTF bufferView at index {idx} has invalid byteLength: {bv_len}. Must be a positive integer."
                    )

                bv_offset = bv.get('byteOffset', 0)
                if not isinstance(bv_offset, int) or bv_offset < 0:
                    raise GLBValidationError(
                        f"glTF bufferView at index {idx} has invalid byteOffset: {bv_offset}. Must be non-negative integer."
                    )

                if bv_offset % 4 != 0:
                    raise GLBValidationError(
                        f"glTF bufferView at index {idx} byteOffset ({bv_offset}) is not 4-byte aligned."
                    )

                byte_stride = bv.get('byteStride')
                if byte_stride is not None:
                    if not isinstance(byte_stride, int) or byte_stride < 4 or byte_stride > 252 or byte_stride % 4 != 0:
                        raise GLBValidationError(
                            f"glTF bufferView at index {idx} has invalid byteStride: {byte_stride}. Must be a multiple of 4 between 4 and 252."
                        )

                target_buf = buffers[buf_idx]
                target_buf_len = target_buf.get('byteLength', 0)
                if bv_offset + bv_len > target_buf_len:
                    raise GLBValidationError(
                        f"glTF bufferView {idx} range ({bv_offset} + {bv_len} = {bv_offset + bv_len} bytes) exceeds target buffer {buf_idx} byteLength ({target_buf_len} bytes) (insufficient binary data)."
                    )

                # Cross-check directly against binary chunk for buffer 0 without URI
                if buf_idx == 0 and not target_buf.get('uri'):
                    if bv_offset + bv_len > bin_chunk_len:
                        raise GLBValidationError(
                            f"glTF bufferView {idx} range ({bv_offset + bv_len} bytes) exceeds available BIN chunk size ({bin_chunk_len} bytes) (insufficient binary data)."
                        )

        # 3. Validate accessors referencing bufferViews and their full byte spans
        accessors = json_data.get('accessors')
        if accessors is not None:
            if not isinstance(accessors, list):
                raise GLBValidationError("glTF 'accessors' field must be a list.")

            for idx, acc in enumerate(accessors):
                if not isinstance(acc, dict):
                    raise GLBValidationError(f"glTF accessor at index {idx} must be an object.")

                # Validate componentType
                comp_type = acc.get('componentType')
                if comp_type not in cls.COMPONENT_TYPE_SIZES:
                    raise GLBValidationError(
                        f"glTF accessor at index {idx} has invalid or unsupported componentType: {comp_type}."
                    )
                comp_size = cls.COMPONENT_TYPE_SIZES[comp_type]

                # Validate type
                elem_type = acc.get('type')
                if elem_type not in cls.TYPE_NUM_COMPONENTS:
                    raise GLBValidationError(
                        f"glTF accessor at index {idx} has invalid or unsupported type: {elem_type}."
                    )
                num_components = cls.TYPE_NUM_COMPONENTS[elem_type]
                element_size = num_components * comp_size

                # Validate count
                count = acc.get('count')
                if not isinstance(count, int) or count < 0:
                    raise GLBValidationError(
                        f"glTF accessor at index {idx} has invalid count: {count}. Must be non-negative integer."
                    )

                # Validate byteOffset
                acc_offset = acc.get('byteOffset', 0)
                if not isinstance(acc_offset, int) or acc_offset < 0:
                    raise GLBValidationError(
                        f"glTF accessor at index {idx} has invalid byteOffset: {acc_offset}. Must be non-negative integer."
                    )

                # Alignment: accessor byteOffset must be a multiple of component size
                if acc_offset % comp_size != 0:
                    raise GLBValidationError(
                        f"glTF accessor at index {idx} byteOffset ({acc_offset}) is not aligned to component size ({comp_size} bytes)."
                    )

                # Full byte range verification against bufferView
                if 'bufferView' in acc:
                    bv_idx = acc['bufferView']
                    if not buffer_views or not isinstance(bv_idx, int) or bv_idx < 0 or bv_idx >= len(buffer_views):
                        raise GLBValidationError(
                            f"glTF accessor at index {idx} references invalid bufferView index {bv_idx}."
                        )

                    target_bv = buffer_views[bv_idx]
                    target_bv_len = target_bv.get('byteLength', 0)
                    byte_stride = target_bv.get('byteStride')

                    if byte_stride is not None:
                        if byte_stride < element_size:
                            raise GLBValidationError(
                                f"glTF bufferView {bv_idx} byteStride ({byte_stride}) cannot be smaller than accessor {idx} element size ({element_size} bytes)."
                            )
                        if count == 0:
                            total_bytes = 0
                        elif count == 1:
                            total_bytes = element_size
                        else:
                            total_bytes = (count - 1) * byte_stride + element_size
                    else:
                        total_bytes = count * element_size

                    end_offset = acc_offset + total_bytes
                    if end_offset > target_bv_len:
                        raise GLBValidationError(
                            f"glTF accessor {idx} complete data span ({acc_offset} + {total_bytes} = {end_offset} bytes) "
                            f"exceeds target bufferView {bv_idx} byteLength ({target_bv_len} bytes)."
                        )

                    # Also verify relative to underlying buffer & binary chunk
                    buf_idx = target_bv.get('buffer')
                    bv_offset = target_bv.get('byteOffset', 0)
                    if buffers and isinstance(buf_idx, int) and 0 <= buf_idx < len(buffers):
                        target_buf = buffers[buf_idx]
                        if bv_offset + end_offset > target_buf.get('byteLength', 0):
                            raise GLBValidationError(
                                f"glTF accessor {idx} complete data span exceeds target buffer {buf_idx} byteLength."
                            )
                        if buf_idx == 0 and not target_buf.get('uri'):
                            if bv_offset + end_offset > bin_chunk_len:
                                raise GLBValidationError(
                                    f"glTF accessor {idx} complete data span exceeds available BIN chunk size ({bin_chunk_len} bytes)."
                                )

                # Validate sparse accessor if present
                if 'sparse' in acc:
                    sparse = acc['sparse']
                    if not isinstance(sparse, dict):
                        raise GLBValidationError(f"glTF accessor {idx} 'sparse' must be an object.")
                    sparse_count = sparse.get('count')
                    if not isinstance(sparse_count, int) or sparse_count <= 0 or sparse_count > count:
                        raise GLBValidationError(
                            f"glTF accessor {idx} sparse count ({sparse_count}) must be a positive integer <= accessor count ({count})."
                        )

                    # Validate sparse indices
                    indices = sparse.get('indices')
                    if not isinstance(indices, dict):
                        raise GLBValidationError(f"glTF accessor {idx} sparse 'indices' must be an object.")
                    indices_bv_idx = indices.get('bufferView')
                    if not buffer_views or not isinstance(indices_bv_idx, int) or indices_bv_idx < 0 or indices_bv_idx >= len(buffer_views):
                        raise GLBValidationError(
                            f"glTF accessor {idx} sparse indices references invalid bufferView index {indices_bv_idx}."
                        )
                    idx_comp_type = indices.get('componentType')
                    if idx_comp_type not in (5121, 5123, 5125):
                        raise GLBValidationError(
                            f"glTF accessor {idx} sparse indices componentType ({idx_comp_type}) must be UNSIGNED_BYTE (5121), UNSIGNED_SHORT (5123), or UNSIGNED_INT (5125)."
                        )
                    idx_comp_size = cls.COMPONENT_TYPE_SIZES[idx_comp_type]
                    idx_offset = indices.get('byteOffset', 0)
                    if not isinstance(idx_offset, int) or idx_offset < 0:
                        raise GLBValidationError(f"glTF accessor {idx} sparse indices has invalid byteOffset: {idx_offset}.")
                    if idx_offset % idx_comp_size != 0:
                        raise GLBValidationError(
                            f"glTF accessor {idx} sparse indices byteOffset ({idx_offset}) is not aligned to component size ({idx_comp_size} bytes)."
                        )
                    indices_total = sparse_count * idx_comp_size
                    if idx_offset + indices_total > buffer_views[indices_bv_idx].get('byteLength', 0):
                        raise GLBValidationError(
                            f"glTF accessor {idx} sparse indices span ({idx_offset} + {indices_total} = {idx_offset + indices_total} bytes) "
                            f"exceeds bufferView {indices_bv_idx} byteLength ({buffer_views[indices_bv_idx].get('byteLength', 0)} bytes)."
                        )

                    # Validate sparse values
                    values = sparse.get('values')
                    if not isinstance(values, dict):
                        raise GLBValidationError(f"glTF accessor {idx} sparse 'values' must be an object.")
                    values_bv_idx = values.get('bufferView')
                    if not buffer_views or not isinstance(values_bv_idx, int) or values_bv_idx < 0 or values_bv_idx >= len(buffer_views):
                        raise GLBValidationError(
                            f"glTF accessor {idx} sparse values references invalid bufferView index {values_bv_idx}."
                        )
                    val_offset = values.get('byteOffset', 0)
                    if not isinstance(val_offset, int) or val_offset < 0:
                        raise GLBValidationError(f"glTF accessor {idx} sparse values has invalid byteOffset: {val_offset}.")
                    if val_offset % comp_size != 0:
                        raise GLBValidationError(
                            f"glTF accessor {idx} sparse values byteOffset ({val_offset}) is not aligned to component size ({comp_size} bytes)."
                        )
                    values_total = sparse_count * element_size
                    if val_offset + values_total > buffer_views[values_bv_idx].get('byteLength', 0):
                        raise GLBValidationError(
                            f"glTF accessor {idx} sparse values span ({val_offset} + {values_total} = {val_offset + values_total} bytes) "
                            f"exceeds bufferView {values_bv_idx} byteLength ({buffer_views[values_bv_idx].get('byteLength', 0)} bytes)."
                        )


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
