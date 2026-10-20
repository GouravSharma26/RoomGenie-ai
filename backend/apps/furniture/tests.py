import io
import json
import math
import struct
import urllib.request
from decimal import Decimal
from unittest.mock import MagicMock, patch
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from apps.furniture.models import FurnitureAsset, FurnitureReconstructionJob
from apps.furniture.reconstruction.validator import GLBValidator, GLBValidationError
from apps.furniture.reconstruction.mock import MockImageTo3DAdapter, build_procedural_furniture_glb
from apps.furniture.reconstruction.tripo import (
    TripoImageTo3DAdapter,
    stream_download_model,
    sanitize_sensitive_text,
    validate_download_url,
    validate_and_resolve_download_url,
    SafeRedirectHandler,
    SafeHTTPSHandler,
)
from apps.furniture.reconstruction.services import (
    resolve_catalogue_fallback,
    get_image_to_3d_adapter,
    create_reconstruction_job,
    run_reconstruction_job,
    delete_reconstruction_job_file,
    validate_reference_dimensions,
)
from apps.designs.models import Design
from apps.rooms.models import RoomPhotoUpload

User = get_user_model()


class FurnitureCatalogueTests(APITestCase):
    def setUp(self):
        self.list_url = reverse('furniture:furniture-list')
        self.asset_sofa = FurnitureAsset.objects.create(
            id='test-sofa',
            name='Modern Leather Sofa',
            category='seating',
            style_tags=['modern', 'minimalist'],
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR',
            license='CC0 1.0 Universal',
            description='Test modern leather sofa'
        )
        self.asset_desk = FurnitureAsset.objects.create(
            id='test-desk',
            name='Wooden Writing Desk',
            category='tables',
            style_tags=['industrial', 'workspace'],
            width=Decimal('1.40'),
            height=Decimal('0.75'),
            depth=Decimal('0.70'),
            price_paise=1499900,
            currency='INR',
            license='CC0 1.0 Universal',
            description='Test wooden desk'
        )
        self.asset_screen = FurnitureAsset.objects.create(
            id='test-screen',
            name='Custom Partition Screen',
            category='decor',
            style_tags=['custom', 'architectural'],
            width=Decimal('1.20'),
            height=Decimal('1.80'),
            depth=Decimal('0.30'),
            price_paise=None,  # Unpriced item
            currency='INR',
            license='CC0 1.0 Universal',
            description='Custom partition screen'
        )

    def test_public_catalogue_list_allows_anonymous(self):
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 3)

    def test_filter_by_category(self):
        response = self.client.get(self.list_url, {'category': 'seating'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], 'test-sofa')

    def test_filter_by_style_tag(self):
        response = self.client.get(self.list_url, {'style': 'industrial'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], 'test-desk')

    def test_search_by_query(self):
        response = self.client.get(self.list_url, {'search': 'Writing'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], 'test-desk')

    def test_filter_by_price_range(self):
        # Max price 20,000 INR excludes sofa (29,999 INR)
        response = self.client.get(self.list_url, {'max_price': 20000})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], 'test-desk')

        # Min price 20,000 INR includes sofa (29,999 INR)
        response_min = self.client.get(self.list_url, {'min_price': 20000})
        self.assertEqual(response_min.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response_min.data), 1)
        self.assertEqual(response_min.data[0]['id'], 'test-sofa')

    def test_filter_by_dimension_compatibility(self):
        # Max width 1.5m excludes sofa (2.1m) but includes desk (1.4m) and screen (1.2m)
        response = self.client.get(self.list_url, {'max_width': '1.50'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item['id'] for item in response.data]
        self.assertNotIn('test-sofa', ids)
        self.assertIn('test-desk', ids)
        self.assertIn('test-screen', ids)

    def test_filter_by_has_price(self):
        # Filter only priced items
        response_priced = self.client.get(self.list_url, {'has_price': 'true'})
        self.assertEqual(response_priced.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response_priced.data), 2)

        # Filter unpriced items
        response_unpriced = self.client.get(self.list_url, {'has_price': 'false'})
        self.assertEqual(response_unpriced.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response_unpriced.data), 1)
        self.assertEqual(response_unpriced.data[0]['id'], 'test-screen')

    def test_price_calculation_in_inr_rupees(self):
        detail_url = reverse('furniture:furniture-detail', kwargs={'pk': 'test-sofa'})
        response = self.client.get(detail_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['price_paise'], 2999900)
        self.assertEqual(response.data['price_inr'], '29999.00')
        self.assertTrue(response.data['is_priced'])
        self.assertEqual(response.data['dimensions'], [2.1, 0.85, 0.9])

    def test_unpriced_asset_serialization(self):
        detail_url = reverse('furniture:furniture-detail', kwargs={'pk': 'test-screen'})
        response = self.client.get(detail_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['price_paise'])
        self.assertIsNone(response.data['price_inr'])
        self.assertFalse(response.data['is_priced'])


class BudgetEstimateTests(APITestCase):
    def setUp(self):
        self.estimate_url = reverse('budget-estimate')
        self.user = User.objects.create_user(
            email='budget.tester@roomgenie.local',
            username='budget.tester@roomgenie.local',
            password='TestPassword123!'
        )
        self.other_user = User.objects.create_user(
            email='other.budget.tester@roomgenie.local',
            username='other.budget.tester@roomgenie.local',
            password='TestPassword123!'
        )
        self.asset_sofa = FurnitureAsset.objects.create(
            id='sofa-modern-3seater',
            name='Modern 3-Seater Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR'
        )
        self.asset_table = FurnitureAsset.objects.create(
            id='table-oak-coffee',
            name='Minimalist Coffee Table',
            category='tables',
            width=Decimal('1.20'),
            height=Decimal('0.45'),
            depth=Decimal('0.60'),
            price_paise=849900,
            currency='INR'
        )
        self.asset_custom = FurnitureAsset.objects.create(
            id='decor-custom-screen',
            name='Custom Screen',
            category='decor',
            width=Decimal('1.00'),
            height=Decimal('1.80'),
            depth=Decimal('0.30'),
            price_paise=None,  # Unpriced
            currency='INR'
        )

    def test_deterministic_budget_calculation_with_priced_items(self):
        scene_json = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'item-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern 3-Seater Sofa',
                    'dimensions': [2.1, 0.85, 0.9],
                    'position': [0.0, 0.425, 0.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                },
                {
                    'id': 'item-2',
                    'assetId': 'table-oak-coffee',
                    'name': 'Minimalist Coffee Table',
                    'dimensions': [1.2, 0.45, 0.6],
                    'position': [0.0, 0.225, 1.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                },
            ],
        }

        response = self.client.post(self.estimate_url, {'scene_json': scene_json}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data

        # 29,999.00 + 8,499.00 = 38,498.00 (3,849,800 paise)
        self.assertEqual(data['total_paise'], 3849800)
        self.assertEqual(data['total_inr'], '38498.00')
        self.assertEqual(data['currency'], 'INR')
        self.assertEqual(data['total_items'], 2)
        self.assertEqual(data['priced_items_count'], 2)
        self.assertEqual(data['unpriced_items_count'], 0)
        self.assertFalse(data['has_unknown_prices'])
        self.assertTrue(data['room_constraints']['is_valid'])
        self.assertEqual(data['room_constraints']['violations_count'], 0)

        # Check category breakdown
        self.assertEqual(data['category_breakdown']['seating']['subtotal_inr'], '29999.00')
        self.assertEqual(data['category_breakdown']['tables']['subtotal_inr'], '8499.00')

    def test_budget_calculation_labels_unknown_prices_not_invented(self):
        scene_json = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'item-1',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern 3-Seater Sofa',
                    'dimensions': [2.1, 0.85, 0.9],
                    'position': [0.0, 0.425, 0.0],
                },
                {
                    'id': 'item-2',
                    'assetId': 'decor-custom-screen',  # Unpriced in catalogue
                    'name': 'Custom Screen',
                    'dimensions': [1.0, 1.8, 0.3],
                    'position': [1.0, 0.9, 0.0],
                },
                {
                    'id': 'item-3',
                    'assetId': 'nonexistent-custom-item',  # Not in catalogue
                    'name': 'Bespoke Vintage Rug',
                    'dimensions': [1.5, 0.05, 2.0],
                    'position': [0.0, 0.025, 0.0],
                },
            ],
        }

        response = self.client.post(self.estimate_url, {'scene_json': scene_json}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data

        # Total only includes known priced items (sofa: 2999900 paise); unknown prices are not added as 0 or guessed
        self.assertEqual(data['total_paise'], 2999900)
        self.assertEqual(data['total_inr'], '29999.00')
        self.assertEqual(data['total_items'], 3)
        self.assertEqual(data['priced_items_count'], 1)
        self.assertEqual(data['unpriced_items_count'], 2)
        self.assertTrue(data['has_unknown_prices'])

        # Item 2 is unpriced
        self.assertEqual(data['items'][1]['status'], 'unpriced')
        self.assertIsNone(data['items'][1]['price_paise'])
        self.assertFalse(data['items'][1]['is_known_price'])

        # Item 3 is unregistered
        self.assertEqual(data['items'][2]['status'], 'unregistered')
        self.assertIsNone(data['items'][2]['price_paise'])
        self.assertFalse(data['items'][2]['is_known_price'])

    def test_budget_estimate_via_persisted_design_id_owner_access(self):
        self.client.force_authenticate(user=self.user)
        design = Design.objects.create(
            owner=self.user,
            title='Executive Suite',
            scene_json={
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [
                    {
                        'id': 'desk-1',
                        'assetId': 'table-oak-coffee',
                        'name': 'Minimalist Coffee Table',
                        'dimensions': [1.2, 0.45, 0.6],
                        'position': [0.0, 0.225, 0.0],
                        'rotationEuler': [0.0, 0.0, 0.0],
                        'scale': [1.0, 1.0, 1.0],
                    }
                ]
            }
        )

        response = self.client.post(self.estimate_url, {'design_id': str(design.id)}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['design_title'], 'Executive Suite')
        self.assertEqual(response.data['total_inr'], '8499.00')

    def test_anonymous_saved_design_access_is_rejected_401(self):
        design = Design.objects.create(
            owner=self.user,
            title='Confidential Penthouse',
            scene_json={
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [
                    {
                        'id': 'desk-1',
                        'assetId': 'table-oak-coffee',
                        'name': 'Minimalist Coffee Table',
                        'dimensions': [1.2, 0.45, 0.6],
                        'position': [0.0, 0.225, 0.0],
                    }
                ]
            }
        )
        self.client.logout()
        response = self.client.post(self.estimate_url, {'design_id': str(design.id)}, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data['detail'], "Authentication credentials were not provided.")

    def test_cross_user_saved_design_access_returns_404(self):
        design = Design.objects.create(
            owner=self.user,
            title='User A Exclusive Room',
            scene_json={
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [
                    {
                        'id': 'sofa-1',
                        'assetId': 'sofa-modern-3seater',
                        'name': 'Modern 3-Seater Sofa',
                        'dimensions': [2.1, 0.85, 0.9],
                        'position': [0.0, 0.425, 0.0],
                    }
                ]
            }
        )
        # Authenticate as other user
        self.client.force_authenticate(user=self.other_user)
        response = self.client.post(self.estimate_url, {'design_id': str(design.id)}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("not found", response.data['detail'])

    def test_anonymous_direct_scene_json_estimation_succeeds_200(self):
        self.client.logout()
        scene_json = {
            'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'anon-sofa',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern 3-Seater Sofa',
                    'dimensions': [2.1, 0.85, 0.9],
                    'position': [0.0, 0.425, 0.0],
                }
            ]
        }
        response = self.client.post(self.estimate_url, {'scene_json': scene_json}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_paise'], 2999900)
        self.assertEqual(response.data['total_inr'], '29999.00')

    def test_anonymous_simplified_items_estimation_succeeds_200(self):
        self.client.logout()
        items_payload = {
            'items': [
                {'assetId': 'sofa-modern-3seater'},
                {'assetId': 'table-oak-coffee'},
            ]
        }
        response = self.client.post(self.estimate_url, items_payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_paise'], 3849800)
        self.assertEqual(response.data['total_inr'], '38498.00')
        self.assertEqual(response.data['total_items'], 2)

    def test_malformed_scene_data_rejected_with_400(self):
        # 1. Missing room dictionary in scene_json
        res = self.client.post(self.estimate_url, {'scene_json': {'objects': []}}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. Non-positive room width
        res = self.client.post(
            self.estimate_url,
            {'scene_json': {'room': {'width': -4.0, 'length': 4.0, 'height': 2.8}, 'objects': []}},
            format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. Non-numeric room height
        res = self.client.post(
            self.estimate_url,
            {'scene_json': {'room': {'width': 5.0, 'length': 4.0, 'height': 'high'}, 'objects': []}},
            format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 4. Objects is not a list
        res = self.client.post(
            self.estimate_url,
            {'scene_json': {'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': 'invalid'}},
            format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 5. Object element is not a dict
        res = self.client.post(
            self.estimate_url,
            {'scene_json': {'room': {'width': 5.0, 'length': 4.0, 'height': 2.8}, 'objects': ['not-a-dict']}},
            format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 6. Object has negative dimensions
        res = self.client.post(
            self.estimate_url,
            {
                'scene_json': {
                    'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                    'objects': [{
                        'id': 'bad-item',
                        'assetId': 'sofa-modern-3seater',
                        'dimensions': [-2.1, 0.85, 0.9]
                    }]
                }
            },
            format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 7. Object has non-numeric position vector
        res = self.client.post(
            self.estimate_url,
            {
                'scene_json': {
                    'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                    'objects': [{
                        'id': 'bad-item',
                        'assetId': 'sofa-modern-3seater',
                        'position': [0.0, 'invalid', 0.0]
                    }]
                }
            },
            format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 8. Empty request body
        res = self.client.post(self.estimate_url, {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_budget_estimate_flags_room_boundary_violations(self):
        # Sofa placed at X=2.0 in a 3m wide room (half-width 1.5m). Sofa half-width is 1.05m -> max X is 2.55m > 1.5m.
        scene_json = {
            'room': {'width': 3.0, 'length': 4.0, 'height': 2.8},
            'objects': [
                {
                    'id': 'oob-sofa',
                    'assetId': 'sofa-modern-3seater',
                    'name': 'Modern 3-Seater Sofa',
                    'dimensions': [2.1, 0.85, 0.9],
                    'position': [2.0, 0.425, 0.0],
                    'rotationEuler': [0.0, 0.0, 0.0],
                    'scale': [1.0, 1.0, 1.0],
                }
            ],
        }

        response = self.client.post(self.estimate_url, {'scene_json': scene_json}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        constraints = response.data['room_constraints']
        self.assertFalse(constraints['is_valid'])
        self.assertGreaterEqual(constraints['violations_count'], 1)
        self.assertEqual(constraints['violations'][0]['axis'], 'X')


class GLBValidatorTests(APITestCase):
    """
    Automated test suite for GLBValidator ensuring adherence to Khronos glTF 2.0 Binary specification.
    """

    def test_valid_procedural_glb_passes_validation(self):
        glb_bytes = build_procedural_furniture_glb(width=1.5, height=0.8, depth=0.9)
        meta = GLBValidator.validate(glb_bytes)
        self.assertTrue(meta['valid'])
        self.assertEqual(meta['version'], 2)
        self.assertTrue(meta['has_binary_chunk'])
        self.assertIsNotNone(meta['approximate_dimensions'])
        dims = meta['approximate_dimensions']
        self.assertAlmostEqual(dims['width_m'], 1.5, places=1)
        self.assertAlmostEqual(dims['height_m'], 0.8, places=1)
        self.assertAlmostEqual(dims['depth_m'], 0.9, places=1)

    def test_empty_payload_rejected(self):
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(b"")
        self.assertIn("empty", str(ctx.exception).lower())

    def test_header_too_short_rejected(self):
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(b"glTF12")
        self.assertIn("too short", str(ctx.exception).lower())

    def test_invalid_magic_rejected(self):
        bad_magic = struct.pack('<III', 0x12345678, 2, 20) + b"\x00" * 8
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(bad_magic)
        self.assertIn("Invalid GLB magic", str(ctx.exception))

    def test_unsupported_version_rejected(self):
        bad_ver = struct.pack('<III', GLBValidator.MAGIC_GLTF, 1, 20) + b"\x00" * 8
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(bad_ver)
        self.assertIn("Unsupported glTF version: 1", str(ctx.exception))

    def test_declared_length_mismatch_rejected(self):
        # Header claims 40 bytes, but payload is only 20 bytes
        bad_len = struct.pack('<III', GLBValidator.MAGIC_GLTF, 2, 40) + b"\x00" * 8
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(bad_len)
        self.assertIn("does not match actual byte count", str(ctx.exception))

    def test_total_length_not_4byte_aligned_rejected(self):
        # 21 bytes (not divisible by 4)
        bad_aligned = struct.pack('<III', GLBValidator.MAGIC_GLTF, 2, 21) + b"\x00" * 9
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(bad_aligned)
        self.assertIn("not 4-byte aligned", str(ctx.exception))

    def test_first_chunk_must_be_json(self):
        # Chunk 0 with BIN type instead of JSON
        header = struct.pack('<III', GLBValidator.MAGIC_GLTF, 2, 24)
        chunk0 = struct.pack('<II', 4, GLBValidator.CHUNK_TYPE_BIN) + b"test"
        bad_chunk = header + chunk0
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(bad_chunk)
        self.assertIn("First GLB chunk must be type JSON", str(ctx.exception))

    def test_chunk_length_overflow_rejected(self):
        # Declared chunk length 100 exceeds total file size of 28 bytes
        header = struct.pack('<III', GLBValidator.MAGIC_GLTF, 2, 28)
        chunk0 = struct.pack('<II', 100, GLBValidator.CHUNK_TYPE_JSON) + b"test" + b"test"
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(header + chunk0)
        self.assertIn("overflows declared file boundary", str(ctx.exception))

    def test_chunk_not_4byte_aligned_rejected(self):
        # Chunk length 5 is not divisible by 4
        header = struct.pack('<III', GLBValidator.MAGIC_GLTF, 2, 28)
        chunk0 = struct.pack('<II', 5, GLBValidator.CHUNK_TYPE_JSON) + b"hello" + b"   "
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(header + chunk0)
        self.assertIn("not 4-byte aligned", str(ctx.exception))

    def test_file_size_limit_enforced(self):
        small_limit = 100
        glb_bytes = build_procedural_furniture_glb()
        self.assertGreater(len(glb_bytes), small_limit)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(glb_bytes, max_size_bytes=small_limit)
        self.assertIn("exceeds maximum allowed limit", str(ctx.exception))

    def test_trailing_unparsed_bytes_rejected(self):
        glb_bytes = build_procedural_furniture_glb()
        # Append 4 trailing garbage bytes and update total length
        corrupted = glb_bytes + b"ABCD"
        corrupted = struct.pack('<III', GLBValidator.MAGIC_GLTF, 2, len(corrupted)) + corrupted[12:]
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(corrupted)
        self.assertTrue("trailing bytes" in str(ctx.exception) or "truncated" in str(ctx.exception).lower())

    @staticmethod
    def _build_synthetic_glb(json_obj: dict, bin_data: bytes | None = None) -> bytes:
        json_bytes = json.dumps(json_obj).encode('utf-8')
        json_pad = (4 - (len(json_bytes) % 4)) % 4
        json_bytes += b' ' * json_pad

        if bin_data is not None:
            bin_pad = (4 - (len(bin_data) % 4)) % 4
            bin_chunk = bin_data + (b'\x00' * bin_pad)
        else:
            bin_chunk = b''

        total_len = 12 + 8 + len(json_bytes)
        if bin_data is not None:
            total_len += 8 + len(bin_chunk)

        header = struct.pack('<III', GLBValidator.MAGIC_GLTF, 2, total_len)
        chunk0 = struct.pack('<II', len(json_bytes), GLBValidator.CHUNK_TYPE_JSON) + json_bytes
        if bin_data is not None:
            chunk1 = struct.pack('<II', len(bin_chunk), GLBValidator.CHUNK_TYPE_BIN) + bin_chunk
            return header + chunk0 + chunk1
        return header + chunk0

    def test_missing_bin_chunk_when_buffers_declared(self):
        # Buffer 0 declared without URI, but GLB has no BIN chunk
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=None)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("missing binary data", str(ctx.exception).lower())

    def test_insufficient_bin_chunk_data(self):
        # Buffer 0 declares 256 bytes, but BIN chunk only contains 64 bytes
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 256}]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("insufficient binary data", str(ctx.exception).lower())

    def test_bufferview_exceeds_bin_chunk_data(self):
        # Buffer 0 has 64 bytes, but bufferView declares offset 32 + length 48 = 80 bytes
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 0, "byteOffset": 32, "byteLength": 48}]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("insufficient binary data", str(ctx.exception).lower())

    def test_invalid_buffer_length_rejected(self):
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": -10}]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("invalid bytelength", str(ctx.exception).lower())

    def test_bufferview_references_invalid_buffer_index(self):
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 3, "byteOffset": 0, "byteLength": 16}]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("invalid buffer index", str(ctx.exception).lower())

    def test_accessor_offset_not_aligned_to_component_size_rejected(self):
        # Component type 5126 (FLOAT, 4 bytes), but byteOffset is 2 (not multiple of 4)
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 48}],
            "accessors": [{
                "bufferView": 0,
                "byteOffset": 2,
                "componentType": 5126,
                "count": 2,
                "type": "SCALAR"
            }]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("not aligned to component size", str(ctx.exception).lower())

    def test_accessor_valid_offset_but_complete_span_exceeds_bufferview_rejected(self):
        # Accessor byteOffset is 0 (valid inside 24-byte view),
        # but count=4, type='VEC3' (3 floats = 12 bytes each), componentType=5126 (FLOAT)
        # Required size = 4 * 12 = 48 bytes > 24 bytes bufferView length
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 24}],
            "accessors": [{
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,
                "count": 4,
                "type": "VEC3"
            }]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("complete data span", str(ctx.exception).lower())
        self.assertIn("exceeds target bufferview", str(ctx.exception).lower())

    def test_accessor_byte_stride_range_exceeds_bufferview_rejected(self):
        # bufferView byteStride is 16, count is 3, element size is 12 (VEC3 float)
        # Required span: (3 - 1) * 16 + 12 = 44 bytes > 32 bytes bufferView length
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 32, "byteStride": 16}],
            "accessors": [{
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,
                "count": 3,
                "type": "VEC3"
            }]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("complete data span", str(ctx.exception).lower())

    def test_accessor_invalid_component_type_rejected(self):
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 32}],
            "accessors": [{
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 9999,
                "count": 2,
                "type": "SCALAR"
            }]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("invalid or unsupported componenttype", str(ctx.exception).lower())

    def test_accessor_invalid_type_rejected(self):
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 32}],
            "accessors": [{
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,
                "count": 2,
                "type": "VEC99"
            }]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("invalid or unsupported type", str(ctx.exception).lower())

    def test_accessor_negative_count_rejected(self):
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 32}],
            "accessors": [{
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,
                "count": -5,
                "type": "VEC3"
            }]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("invalid count", str(ctx.exception).lower())

    def test_bufferview_unaligned_byte_offset_rejected(self):
        # bufferView byteOffset must be a multiple of 4
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 64}],
            "bufferViews": [{"buffer": 0, "byteOffset": 3, "byteLength": 16}]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 64)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("not 4-byte aligned", str(ctx.exception).lower())

    def test_sparse_accessor_indices_exceed_bufferview_rejected(self):
        # Sparse count 10, indices componentType 5123 (UNSIGNED_SHORT, 2 bytes) -> needs 20 bytes
        # But indices bufferView length is only 8 bytes
        json_obj = {
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 128}],
            "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 48},  # base
                {"buffer": 0, "byteOffset": 48, "byteLength": 8},  # sparse indices (too small!)
                {"buffer": 0, "byteOffset": 56, "byteLength": 64}, # sparse values
            ],
            "accessors": [{
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,
                "count": 10,
                "type": "SCALAR",
                "sparse": {
                    "count": 10,
                    "indices": {"bufferView": 1, "byteOffset": 0, "componentType": 5123},
                    "values": {"bufferView": 2, "byteOffset": 0}
                }
            }]
        }
        raw_glb = self._build_synthetic_glb(json_obj, bin_data=b"\x00" * 128)
        with self.assertRaises(GLBValidationError) as ctx:
            GLBValidator.validate(raw_glb)
        self.assertIn("sparse indices span", str(ctx.exception).lower())


class MockImageTo3DAdapterTests(APITestCase):
    """
    Automated tests verifying deterministic procedural 3D model generation and fallbacks.
    """

    def setUp(self):
        self.adapter = MockImageTo3DAdapter()

    def test_generates_valid_glb_for_all_categories(self):
        categories = ['seating', 'tables', 'storage', 'beds', 'decor']
        for cat in categories:
            res = self.adapter.generate_furniture_model(
                image_path='sample.jpg',
                category=cat,
                prompt_label=f'Test {cat}'
            )
            self.assertEqual(res.format, 'glb')
            self.assertEqual(res.provider, 'mock')
            self.assertGreater(len(res.model_bytes), 0)
            val = GLBValidator.validate(res.model_bytes)
            self.assertTrue(val['valid'])
            self.assertTrue(val['has_binary_chunk'])
            self.assertIn(cat, self.adapter.CATALOGUE_FALLBACKS)
            self.assertEqual(res.suggested_catalogue_fallback_id, self.adapter.CATALOGUE_FALLBACKS[cat])

    def test_respects_reference_dimensions(self):
        ref_dims = {'width_m': 2.4, 'height_m': 0.9, 'depth_m': 1.1}
        res = self.adapter.generate_furniture_model(
            image_path='sample.jpg',
            category='seating',
            reference_dimensions=ref_dims
        )
        self.assertAlmostEqual(res.approximate_dimensions['width_m'], 2.4, places=1)
        self.assertAlmostEqual(res.approximate_dimensions['height_m'], 0.9, places=1)
        self.assertAlmostEqual(res.approximate_dimensions['depth_m'], 1.1, places=1)

    def test_simulation_failure_hook(self):
        with self.assertRaises(RuntimeError) as ctx:
            self.adapter.generate_furniture_model(
                image_path='sample.jpg',
                context={'simulate_failure': True, 'failure_message': 'CUDA out of memory'}
            )
        self.assertIn('CUDA out of memory', str(ctx.exception))

    def test_simulation_invalid_glb_hook(self):
        res = self.adapter.generate_furniture_model(
            image_path='sample.jpg',
            context={'simulate_invalid_glb': True}
        )
        with self.assertRaises(GLBValidationError):
            GLBValidator.validate(res.model_bytes)

    def test_simulation_oversized_glb_hook(self):
        res = self.adapter.generate_furniture_model(
            image_path='sample.jpg',
            context={'simulate_oversized_glb': True}
        )
        with self.assertRaises(GLBValidationError):
            GLBValidator.validate(res.model_bytes, max_size_bytes=15 * 1024 * 1024)


class TripoAdapterStreamingAndGatingTests(APITestCase):
    """
    Tests ensuring Tripo provider enforces explicit paid authorization,
    bounds model streaming downloads, and redacts secrets.
    """

    def test_paid_requests_disabled_by_default(self):
        from django.conf import settings
        self.assertFalse(getattr(settings, 'IMAGE_TO_3D_ALLOW_PAID_REQUESTS', False))

    @patch('urllib.request.urlopen')
    def test_tripo_proves_no_http_request_when_authorization_disabled(self, mock_urlopen):
        # Even with a live key, if allow_paid=False, NO HTTP call must be made
        adapter = TripoImageTo3DAdapter(api_key='live_tripo_key_abcdef', allow_paid=False)
        res = adapter.generate_furniture_model(
            image_path='sample.jpg',
            category='seating',
            prompt_label='Nordic armchair'
        )
        mock_urlopen.assert_not_called()
        self.assertEqual(res.provider, 'mock')
        self.assertTrue(res.raw_metadata.get('fallback_used'))
        self.assertEqual(res.raw_metadata.get('fallback_reason'), 'paid_requests_not_authorized')

    def test_tripo_falls_back_when_key_unconfigured_or_placeholder(self):
        # Even if allow_paid=True, if key is placeholder or empty, fallback to mock without HTTP
        adapter = TripoImageTo3DAdapter(api_key='tsk_placeholder_12345', allow_paid=True)
        res = adapter.generate_furniture_model(
            image_path='sample.jpg',
            category='seating',
            prompt_label='Nordic sofa'
        )
        self.assertEqual(res.provider, 'mock')
        self.assertTrue(res.raw_metadata.get('fallback_used'))
        self.assertEqual(res.raw_metadata.get('fallback_reason'), 'tripo_api_key_not_configured')

    @patch('urllib.request.urlopen')
    def test_tripo_attempts_request_when_allow_paid_true(self, mock_urlopen):
        secret_key = "live_tripo_secret_7777"
        mock_urlopen.side_effect = RuntimeError("Simulated network failure")

        adapter = TripoImageTo3DAdapter(api_key=secret_key, allow_paid=True)
        res = adapter.generate_furniture_model(
            image_path='sample.jpg',
            category='tables',
            context={'file_token': 'dummy'}
        )
        # Verify network attempt was made
        mock_urlopen.assert_called()
        self.assertEqual(res.provider, 'mock')
        self.assertTrue(res.raw_metadata.get('fallback_used'))
        reason = res.raw_metadata.get('fallback_reason', '')
        # Secret key must not leak in fallback reason
        self.assertNotIn(secret_key, reason)

    def test_stream_download_enforces_max_size_and_closes_response(self):
        # Mock response that yields 2KB in 512B chunks when limit is 1KB
        chunk_data = b"X" * 512
        mock_resp = MagicMock()
        mock_resp.headers = {}
        mock_resp.read.side_effect = [chunk_data, chunk_data, chunk_data, b""]

        with patch('urllib.request.OpenerDirector.open', return_value=mock_resp):
            with self.assertRaises(GLBValidationError) as ctx:
                stream_download_model(
                    "https://tripo-models.tripo3d.ai/oversized.glb",
                    max_size_bytes=1000,
                    chunk_size=512,
                    check_dns=False,
                    pinned_ip_override="104.18.27.71"
                )
            self.assertIn("exceeded maximum allowed limit", str(ctx.exception))
            # Must close response cleanly
            mock_resp.close.assert_called()

    def test_stream_download_handles_response_without_content_length(self):
        # Response without Content-Length header, valid within limit
        valid_bytes = b"Y" * 800
        mock_resp = MagicMock()
        mock_resp.headers = {}  # No Content-Length
        mock_resp.read.side_effect = [valid_bytes, b""]

        with patch('urllib.request.OpenerDirector.open', return_value=mock_resp):
            downloaded = stream_download_model(
                "https://tripo-models.tripo3d.ai/chunked.glb",
                max_size_bytes=1024,
                chunk_size=512,
                check_dns=False,
                pinned_ip_override="104.18.27.71"
            )
            self.assertEqual(downloaded, valid_bytes)
            mock_resp.close.assert_called()

    def test_stream_download_rejects_oversized_content_length_header(self):
        mock_resp = MagicMock()
        mock_resp.headers = {'Content-Length': '25000000'}  # 25MB

        with patch('urllib.request.OpenerDirector.open', return_value=mock_resp):
            with self.assertRaises(GLBValidationError) as ctx:
                stream_download_model(
                    "https://tripo-models.tripo3d.ai/big.glb",
                    max_size_bytes=15 * 1024 * 1024,
                    check_dns=False,
                    pinned_ip_override="104.18.27.71"
                )
            self.assertIn("exceeds maximum allowed limit", str(ctx.exception))
            mock_resp.close.assert_called()

    def test_validate_download_url_rejects_non_https(self):
        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("http://tripo-models.tripo3d.ai/model.glb")
        self.assertIn("only https is permitted", str(ctx.exception).lower())

        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("file:///etc/passwd")
        self.assertIn("only https is permitted", str(ctx.exception).lower())

    def test_validate_download_url_rejects_disallowed_hosts(self):
        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("https://malicious-site.com/model.glb", check_dns=False)
        self.assertIn("not in the allowed provider/cdn whitelist", str(ctx.exception).lower())

    def test_validate_download_url_rejects_localhost_and_loopback(self):
        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("https://localhost/model.glb", check_dns=False)
        self.assertIn("disallowed destination", str(ctx.exception).lower())

        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("https://127.0.0.1/model.glb", check_dns=False)
        self.assertIn("disallowed", str(ctx.exception).lower())

    def test_validate_download_url_rejects_private_and_link_local_ips(self):
        # 192.168.x.x
        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("https://192.168.1.100/model.glb", check_dns=False)
        self.assertIn("disallowed", str(ctx.exception).lower())

        # 10.x.x.x
        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("https://10.0.0.5/model.glb", check_dns=False)
        self.assertIn("disallowed", str(ctx.exception).lower())

        # 169.254.x.x (AWS/Cloud metadata)
        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("https://169.254.169.254/latest/meta-data", check_dns=False)
        self.assertIn("disallowed", str(ctx.exception).lower())

    def test_validate_download_url_rejects_userinfo_and_non_standard_ports(self):
        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("https://user:pass@tripo-models.tripo3d.ai/model.glb", check_dns=False)
        self.assertIn("disallowed user credentials", str(ctx.exception).lower())

        with self.assertRaises(GLBValidationError) as ctx:
            validate_download_url("https://tripo-models.tripo3d.ai:8080/model.glb", check_dns=False)
        self.assertIn("disallowed port", str(ctx.exception).lower())

    def test_validate_download_url_rejects_dns_resolving_to_private_ip(self):
        # Even if domain name is in whitelist, if DNS resolves to private IP, reject!
        mock_dns = [(2, 0, 0, '', ('127.0.0.1', 443))]
        with patch('socket.getaddrinfo', return_value=mock_dns):
            with self.assertRaises(GLBValidationError) as ctx:
                validate_download_url("https://tripo-models.tripo3d.ai/model.glb", check_dns=True)
            self.assertIn("disallowed local/private address", str(ctx.exception).lower())

    def test_safe_redirect_handler_rejects_redirect_to_disallowed_host(self):
        handler = SafeRedirectHandler(allowed_hosts=['tripo3d.ai', '.tripo3d.ai'], check_dns=False)
        req = urllib.request.Request("https://tripo-models.tripo3d.ai/start.glb")
        with self.assertRaises(GLBValidationError) as ctx:
            handler.redirect_request(req, None, 302, "Found", {}, "https://evil-attacker.com/secret.glb")
        self.assertIn("not in the allowed provider/cdn whitelist", str(ctx.exception).lower())

    def test_safe_redirect_handler_rejects_redirect_to_localhost_and_private_network(self):
        handler = SafeRedirectHandler(allowed_hosts=['tripo3d.ai', '.tripo3d.ai'], check_dns=False)
        req = urllib.request.Request("https://tripo-models.tripo3d.ai/start.glb")
        with self.assertRaises(GLBValidationError) as ctx:
            handler.redirect_request(req, None, 302, "Found", {}, "http://localhost:8000/admin")
        self.assertIn("only https is permitted", str(ctx.exception).lower())

        with self.assertRaises(GLBValidationError) as ctx:
            handler.redirect_request(req, None, 302, "Found", {}, "https://127.0.0.1/admin")
        self.assertIn("disallowed", str(ctx.exception).lower())

    def test_safe_redirect_handler_allows_valid_https_redirect(self):
        handler = SafeRedirectHandler(
            allowed_hosts=['tripo3d.ai', '.tripo3d.ai', '.cloudfront.net'],
            check_dns=False,
            pinned_ip_override="104.18.27.71"
        )
        req = urllib.request.Request("https://tripo-models.tripo3d.ai/start.glb")
        redirect_req = handler.redirect_request(
            req, None, 302, "Found", {}, "https://assets.cloudfront.net/model.glb"
        )
        self.assertIsNotNone(redirect_req)
        self.assertEqual(redirect_req.full_url, "https://assets.cloudfront.net/model.glb")

    def test_validate_and_resolve_download_url_pins_public_ip(self):
        mock_dns = [(2, 0, 0, '', ('104.18.27.71', 443))]
        with patch('socket.getaddrinfo', return_value=mock_dns):
            url, pinned_ip, hostname, port = validate_and_resolve_download_url(
                "https://tripo-models.tripo3d.ai/model.glb",
                check_dns=True
            )
            self.assertEqual(url, "https://tripo-models.tripo3d.ai/model.glb")
            self.assertEqual(pinned_ip, "104.18.27.71")
            self.assertEqual(hostname, "tripo-models.tripo3d.ai")
            self.assertEqual(port, 443)

    def test_safe_https_handler_pins_validated_ip_and_preserves_sni_and_cert_check(self):
        pinned_ip = "104.18.27.71"
        hostname = "tripo-models.tripo3d.ai"
        handler = SafeHTTPSHandler(
            allowed_hosts=[hostname],
            check_dns=False,
            pinned_ip_override=pinned_ip
        )
        req = urllib.request.Request(f"https://{hostname}/model.glb")

        mock_sock = MagicMock()
        mock_create_conn = MagicMock(return_value=mock_sock)
        mock_wrap_socket = MagicMock(return_value=mock_sock)
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.reason = "OK"
        mock_response.msg = {}
        mock_response.headers = {}
        mock_response.read.return_value = b"glb_bytes"

        with patch('socket.create_connection', mock_create_conn), \
             patch('ssl.SSLContext.wrap_socket', mock_wrap_socket), \
             patch('http.client.HTTPSConnection.getresponse', return_value=mock_response):
            resp = handler.https_open(req)
            self.assertIsNotNone(resp)
            # 1. Proves connection was established directly to the pinned IP address (NO unchecked DNS query)
            mock_create_conn.assert_called_once()
            call_args = mock_create_conn.call_args[0]
            self.assertEqual(call_args[0], (pinned_ip, 443))

            # 2. Proves TLS SNI extension and cert hostname match the original hostname
            mock_wrap_socket.assert_called_once()
            wrap_kwargs = mock_wrap_socket.call_args[1]
            self.assertEqual(wrap_kwargs['server_hostname'], hostname)

    def test_dns_rebinding_simulation_blocks_connection_to_rebound_private_ip(self):
        # Even if a malicious attacker tries to return a private IP address via DNS,
        # it is rejected immediately before socket connection establishment
        mock_dns = [(2, 0, 0, '', ('169.254.169.254', 443))]
        with patch('socket.getaddrinfo', return_value=mock_dns):
            with self.assertRaises(GLBValidationError) as ctx:
                stream_download_model("https://tripo-models.tripo3d.ai/model.glb", check_dns=True)
            self.assertIn("disallowed local/private address", str(ctx.exception).lower())

    def test_pinned_ip_override_blocks_private_ip_tampering(self):
        with self.assertRaises(GLBValidationError) as ctx:
            validate_and_resolve_download_url(
                "https://tripo-models.tripo3d.ai/model.glb",
                pinned_ip_override="127.0.0.1"
            )
        self.assertIn("disallowed private or local address", str(ctx.exception).lower())

    def test_check_dns_false_without_pinned_ip_rejects_unpinned_hostname_connection(self):
        """
        Regression test: Proves that setting check_dns=False without an explicit pinned IP
        or validated IP literal rejects the download and refuses to establish an unpinned
        hostname connection.
        """
        hostname = "tripo-models.tripo3d.ai"
        url = f"https://{hostname}/model.glb"

        # 1. validate_and_resolve_download_url must reject domain hostname when check_dns=False
        with self.assertRaises(GLBValidationError) as ctx:
            validate_and_resolve_download_url(url, check_dns=False)
        self.assertIn("explicitly validated pinned ip address is required", str(ctx.exception).lower())

        # 2. stream_download_model must reject domain hostname when check_dns=False
        with self.assertRaises(GLBValidationError) as ctx:
            stream_download_model(url, check_dns=False)
        self.assertIn("explicitly validated pinned ip address is required", str(ctx.exception).lower())

        # 3. SafeHTTPSHandler.https_open must reject domain hostname when check_dns=False
        # and neither socket.create_connection nor socket.getaddrinfo must ever be invoked
        handler = SafeHTTPSHandler(allowed_hosts=[hostname], check_dns=False)
        req = urllib.request.Request(url)

        with patch('socket.create_connection') as mock_create_conn, \
             patch('socket.getaddrinfo') as mock_getaddrinfo:
            with self.assertRaises(GLBValidationError) as ctx:
                handler.https_open(req)
            self.assertIn("explicitly validated pinned ip address is required", str(ctx.exception).lower())
            mock_create_conn.assert_not_called()
            mock_getaddrinfo.assert_not_called()

    def test_check_dns_false_permitted_for_validated_ip_literal(self):
        """
        Proves that check_dns=False is permitted when destination is an explicitly validated
        public IP literal, connecting directly to the IP literal without DNS resolution.
        """
        ip_literal = "104.18.27.71"
        url = f"https://{ip_literal}/model.glb"

        # 1. validate_and_resolve_download_url returns the IP literal as pinned_ip
        validated_url, pinned_ip, hostname, port = validate_and_resolve_download_url(
            url,
            allowed_hosts=[ip_literal],
            check_dns=False
        )
        self.assertEqual(validated_url, url)
        self.assertEqual(pinned_ip, ip_literal)
        self.assertEqual(hostname, ip_literal)
        self.assertEqual(port, 443)

        # 2. SafeHTTPSHandler connects directly to the IP literal without DNS lookup
        handler = SafeHTTPSHandler(allowed_hosts=[ip_literal], check_dns=False)
        req = urllib.request.Request(url)

        mock_sock = MagicMock()
        mock_create_conn = MagicMock(return_value=mock_sock)
        mock_wrap_socket = MagicMock(return_value=mock_sock)
        mock_response = MagicMock(status=200, reason="OK", msg={}, headers={})
        mock_response.read.return_value = b"glb_bytes"

        with patch('socket.create_connection', mock_create_conn), \
             patch('ssl.SSLContext.wrap_socket', mock_wrap_socket), \
             patch('http.client.HTTPSConnection.getresponse', return_value=mock_response), \
             patch('socket.getaddrinfo') as mock_getaddrinfo:
            resp = handler.https_open(req)
            self.assertIsNotNone(resp)
            mock_create_conn.assert_called_once_with((ip_literal, 443), req.timeout, None)
            mock_getaddrinfo.assert_not_called()

    def test_pinned_connection_enforces_ip_invariant(self):
        """
        Proves that PinnedConnection.connect strictly verifies pinned_ip is a valid IP address
        and aborts if a non-IP string is present.
        """
        hostname = "tripo-models.tripo3d.ai"
        url = f"https://{hostname}/model.glb"

        # Attempting to supply a non-IP string as pinned_ip_override must fail validation
        with self.assertRaises(GLBValidationError) as ctx:
            validate_and_resolve_download_url(
                url,
                check_dns=False,
                pinned_ip_override="not-an-ip.internal"
            )
        self.assertIn("not a valid ip address", str(ctx.exception).lower())


class ReconstructionJobLifecycleTests(APITestCase):
    """
    Tests verifying FurnitureReconstructionJob state transitions, service pipeline,
    and orphan artifact cleanup.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username='reconstruct_tester',
            email='recon@example.com',
            password='Password123!'
        )

    def test_job_creation_and_state_transitions(self):
        job = create_reconstruction_job(
            user=self.user,
            target_category='seating',
            prompt_label='Lounge Chair'
        )
        self.assertEqual(job.status, FurnitureReconstructionJob.STATUS_QUEUED)
        self.assertEqual(job.suggested_catalogue_fallback_id, 'chair-accent-armchair')
        self.assertIsNone(job.completed_at)

        # Valid transition: queued -> processing
        job.transition_to(FurnitureReconstructionJob.STATUS_PROCESSING)
        self.assertEqual(job.status, FurnitureReconstructionJob.STATUS_PROCESSING)
        self.assertIsNone(job.completed_at)

        # Valid transition: processing -> completed
        job.transition_to(FurnitureReconstructionJob.STATUS_COMPLETED)
        self.assertEqual(job.status, FurnitureReconstructionJob.STATUS_COMPLETED)
        self.assertIsNotNone(job.completed_at)

        # Illegal transition: completed -> processing must raise ValueError
        with self.assertRaises(ValueError):
            job.transition_to(FurnitureReconstructionJob.STATUS_PROCESSING)

        # Illegal transition: completed -> queued must raise ValueError
        with self.assertRaises(ValueError):
            job.transition_to(FurnitureReconstructionJob.STATUS_QUEUED)

    def test_run_reconstruction_job_successful_pipeline(self):
        job = create_reconstruction_job(
            user=self.user,
            target_category='tables',
            prompt_label='Coffee Table',
            reference_dimensions={'width_m': 1.1, 'height_m': 0.45, 'depth_m': 0.65}
        )
        self.assertEqual(job.suggested_catalogue_fallback_id, 'table-oak-coffee')

        # Run pipeline
        completed_job = run_reconstruction_job(job)
        self.assertEqual(completed_job.status, FurnitureReconstructionJob.STATUS_COMPLETED)
        self.assertIsNotNone(completed_job.completed_at)
        self.assertGreater(completed_job.file_size_bytes, 0)
        self.assertTrue(completed_job.model_file_path.endswith(f"{completed_job.id.hex}.glb"))

        # Verify model file actually exists on disk in private storage
        abs_path = completed_job.get_absolute_model_path()
        self.assertIsNotNone(abs_path)
        self.assertTrue(abs_path.exists())

        # Verify file content is valid GLB
        with open(abs_path, 'rb') as f:
            saved_bytes = f.read()
        val = GLBValidator.validate(saved_bytes)
        self.assertTrue(val['valid'])

        # Clean up file
        deleted = delete_reconstruction_job_file(completed_job)
        self.assertTrue(deleted)
        self.assertFalse(abs_path.exists())

    def test_run_reconstruction_job_handles_provider_failure_without_stuck_state(self):
        job = create_reconstruction_job(
            user=self.user,
            target_category='beds',
            prompt_label='Platform Bed'
        )

        failed_job = run_reconstruction_job(
            job,
            context={'simulate_failure': True, 'failure_message': 'GPU service unavailable'}
        )

        self.assertEqual(failed_job.status, FurnitureReconstructionJob.STATUS_FAILED)
        self.assertEqual(failed_job.error_category, 'provider_error')
        self.assertIn('GPU service unavailable', failed_job.error_message)
        self.assertIsNotNone(failed_job.completed_at)
        self.assertEqual(failed_job.model_file_path, '')
        self.assertEqual(failed_job.suggested_catalogue_fallback_id, 'bed-queen-platform')

    def test_rejected_response_never_persists_as_completed_file(self):
        job = create_reconstruction_job(
            user=self.user,
            target_category='storage',
            prompt_label='Tall Bookshelf'
        )

        failed_job = run_reconstruction_job(
            job,
            context={'simulate_invalid_glb': True}
        )

        self.assertEqual(failed_job.status, FurnitureReconstructionJob.STATUS_FAILED)
        self.assertEqual(failed_job.error_category, 'validation_failed')
        self.assertIsNotNone(failed_job.completed_at)
        self.assertEqual(failed_job.model_file_path, '')
        abs_path = failed_job.get_absolute_model_path()
        self.assertIsNone(abs_path)

    def test_get_image_to_3d_adapter_rejects_unknown_mode(self):
        with self.assertRaises(ValueError) as ctx:
            get_image_to_3d_adapter('quantum_render_3d')
        self.assertIn("Unsupported image-to-3D provider mode", str(ctx.exception))

    def test_create_reconstruction_job_rejects_unknown_provider(self):
        with self.assertRaises(ValueError) as ctx:
            create_reconstruction_job(self.user, provider='dalle_3d')
        self.assertIn("Unsupported image-to-3D provider", str(ctx.exception))

    def test_validate_reference_dimensions(self):
        # 1. Valid dimensions
        valid = validate_reference_dimensions({'width_m': 1.25, 'height_m': 0.85, 'depth_m': 0.90})
        self.assertEqual(valid, {'width_m': 1.25, 'height_m': 0.85, 'depth_m': 0.90})

        # 2. Empty / None
        self.assertEqual(validate_reference_dimensions(None), {})
        self.assertEqual(validate_reference_dimensions({}), {})

        # 3. Negative dimension
        with self.assertRaises(ValueError):
            validate_reference_dimensions({'width_m': -1.5})

        # 4. Zero dimension
        with self.assertRaises(ValueError):
            validate_reference_dimensions({'width_m': 0.0})

        # 5. Boolean value
        with self.assertRaises(ValueError):
            validate_reference_dimensions({'width_m': True})

        # 6. NaN or Infinite
        with self.assertRaises(ValueError):
            validate_reference_dimensions({'width_m': float('nan')})
        with self.assertRaises(ValueError):
            validate_reference_dimensions({'width_m': float('inf')})

        # 7. Out of bounds (< 0.05m or > 10.0m)
        with self.assertRaises(ValueError):
            validate_reference_dimensions({'width_m': 0.01})
        with self.assertRaises(ValueError):
            validate_reference_dimensions({'width_m': 15.0})

        # 8. Non-dict
        with self.assertRaises(ValueError):
            validate_reference_dimensions("invalid_type")

    def test_resolve_catalogue_fallback_verifies_active_asset(self):
        # Create active desk and active sofa
        FurnitureAsset.objects.create(
            id='desk-workspace-study',
            name='Study Desk',
            category='tables',
            width=Decimal('1.4'),
            height=Decimal('0.75'),
            depth=Decimal('0.7'),
            is_active=True
        )
        res_desk = resolve_catalogue_fallback('tables', 'Study Desk')
        self.assertEqual(res_desk, 'desk-workspace-study')

    def test_catalogue_fallback_keyword_resolution(self):
        self.assertEqual(resolve_catalogue_fallback('seating', 'Velvet Armchair'), 'chair-accent-armchair')
        self.assertEqual(resolve_catalogue_fallback('tables', 'Computer Desk'), 'desk-workspace-study')
        self.assertEqual(resolve_catalogue_fallback('storage', 'Wooden Wardrobe'), 'storage-wardrobe-2door')
        self.assertEqual(resolve_catalogue_fallback('decor', 'Tall Indoor Plant'), 'decor-plant-floor-vase')
        self.assertEqual(resolve_catalogue_fallback('unknown', ''), 'sofa-modern-3seater')

    def test_sanitize_sensitive_text_redacts_credentials_and_urls(self):
        text = "Request to https://api.tripo3d.ai/v2/task failed with Bearer secret_token_12345 and api_key=super_secret_key"
        sanitized = sanitize_sensitive_text(text, secret="super_secret_key")
        self.assertNotIn("secret_token_12345", sanitized)
        self.assertNotIn("super_secret_key", sanitized)
        self.assertNotIn("https://api.tripo3d.ai", sanitized)
        self.assertIn("[REDACTED]", sanitized)
        self.assertIn("[URL_REDACTED]", sanitized)


class ReconstructionAPISecurityAndStreamingTests(APITestCase):
    """
    Tests verifying Milestone 6.2 Secure API:
      - Authenticated job creation
      - Owner-scoped job access & isolation
      - Status polling
      - Private model streaming with secure headers & MIME types
      - Deletion cleanup
      - Paid-provider authorization safeguards
    """

    def setUp(self):
        self.user1 = User.objects.create_user(
            username='recon_user_1',
            email='recon1@example.com',
            password='Password123!'
        )
        self.user2 = User.objects.create_user(
            username='recon_user_2',
            email='recon2@example.com',
            password='Password123!'
        )
        self.client.force_authenticate(user=self.user1)
        self.jobs_url = reverse('furniture:reconstruction-jobs-list')

    def test_job_create_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(self.jobs_url, {"target_category": "seating"})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_job_create_authenticated_success_with_defaults(self):
        payload = {
            "target_category": "seating",
            "prompt_label": "Comfortable Scandinavian Armchair",
            "reference_dimensions": {"width_m": 0.9, "height_m": 0.85, "depth_m": 0.8},
            "sync": True
        }
        resp = self.client.post(self.jobs_url, payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        data = resp.data

        self.assertIn('id', data)
        self.assertEqual(data['owner_id'], self.user1.id)
        self.assertEqual(data['status'], 'completed')
        self.assertEqual(data['target_category'], 'seating')
        self.assertEqual(data['prompt_label'], 'Comfortable Scandinavian Armchair')
        self.assertIsNotNone(data['model_download_url'])
        self.assertIn(f"/api/v1/furniture/reconstruction/jobs/{data['id']}/model/", data['model_download_url'])
        self.assertGreater(data['file_size_bytes'], 0)
        self.assertIn('width_m', data['approximate_dimensions'])

    def test_job_create_with_auto_process_false_creates_queued_job(self):
        payload = {
            "target_category": "tables",
            "prompt_label": "Oak Coffee Table",
            "auto_process": False
        }
        resp = self.client.post(self.jobs_url, payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        data = resp.data

        self.assertEqual(data['status'], 'queued')
        self.assertIsNone(data['model_download_url'])
        self.assertIsNone(data['file_size_bytes'])

    def test_job_create_validates_photo_upload_ownership(self):
        from django.utils import timezone
        # Photo owned by user 2
        foreign_photo = RoomPhotoUpload.objects.create(
            owner=self.user2,
            file_path="/tmp/user2_photo.jpg",
            original_filename="user2_photo.jpg",
            file_size_bytes=1024,
            content_type="image/jpeg",
            image_format="JPEG",
            width=800,
            height=600,
            expires_at=timezone.now() + timezone.timedelta(hours=1)
        )

        # User 1 attempts to link foreign photo
        resp = self.client.post(self.jobs_url, {
            "photo_upload_id": str(foreign_photo.id),
            "target_category": "seating"
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("photo_upload_id", resp.data)
        self.assertIn("does not belong to you", str(resp.data['photo_upload_id']))

        # Photo owned by user 1
        own_photo = RoomPhotoUpload.objects.create(
            owner=self.user1,
            file_path="/tmp/user1_photo.jpg",
            original_filename="user1_photo.jpg",
            file_size_bytes=1024,
            content_type="image/jpeg",
            image_format="JPEG",
            width=800,
            height=600,
            expires_at=timezone.now() + timezone.timedelta(hours=1)
        )
        resp_own = self.client.post(self.jobs_url, {
            "photo_upload_id": str(own_photo.id),
            "target_category": "seating",
            "auto_process": False
        })
        self.assertEqual(resp_own.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp_own.data['photo_upload_id'], str(own_photo.id))

    def test_job_create_validates_reference_dimensions(self):
        # Negative dimension
        resp1 = self.client.post(self.jobs_url, {
            "reference_dimensions": {"width_m": -1.5}
        }, format='json')
        self.assertEqual(resp1.status_code, status.HTTP_400_BAD_REQUEST)

        # Zero dimension
        resp2 = self.client.post(self.jobs_url, {
            "reference_dimensions": {"width_m": 0.0}
        }, format='json')
        self.assertEqual(resp2.status_code, status.HTTP_400_BAD_REQUEST)

        # Out of bounds (> 10m)
        resp3 = self.client.post(self.jobs_url, {
            "reference_dimensions": {"width_m": 12.0}
        }, format='json')
        self.assertEqual(resp3.status_code, status.HTTP_400_BAD_REQUEST)

        # Non-numeric
        resp4 = self.client.post(self.jobs_url, {
            "reference_dimensions": {"width_m": "one-point-five"}
        }, format='json')
        self.assertEqual(resp4.status_code, status.HTTP_400_BAD_REQUEST)

    def test_job_create_validates_provider_mode(self):
        resp = self.client.post(self.jobs_url, {
            "provider": "unsupported_foreign_cloud"
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("provider", resp.data)

    def test_jobs_list_is_owner_scoped_and_filterable(self):
        # Create 2 jobs for user1, 1 for user2
        job1 = create_reconstruction_job(self.user1, target_category='seating')
        job2 = create_reconstruction_job(self.user1, target_category='tables')
        run_reconstruction_job(job2)
        create_reconstruction_job(self.user2, target_category='beds')

        # User 1 listing
        resp = self.client.get(self.jobs_url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        returned_ids = [j['id'] for j in resp.data]
        self.assertEqual(len(returned_ids), 2)
        self.assertIn(str(job1.id), returned_ids)
        self.assertIn(str(job2.id), returned_ids)

        # Status filter
        resp_status = self.client.get(f"{self.jobs_url}?status=completed")
        self.assertEqual(resp_status.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp_status.data), 1)
        self.assertEqual(resp_status.data[0]['id'], str(job2.id))

        # Category filter
        resp_cat = self.client.get(f"{self.jobs_url}?category=seating")
        self.assertEqual(resp_cat.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp_cat.data), 1)
        self.assertEqual(resp_cat.data[0]['id'], str(job1.id))

        # User 2 listing
        self.client.force_authenticate(user=self.user2)
        resp_u2 = self.client.get(self.jobs_url)
        self.assertEqual(resp_u2.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp_u2.data), 1)
        self.assertNotIn(str(job1.id), [j['id'] for j in resp_u2.data])

    def test_job_detail_is_owner_scoped_and_serves_status_polling(self):
        job = create_reconstruction_job(self.user1, target_category='seating')
        detail_url = reverse('furniture:reconstruction-jobs-detail', kwargs={'pk': job.id})

        # User 1 polling queued job
        resp = self.client.get(detail_url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['status'], 'queued')
        self.assertIsNone(resp.data['model_download_url'])

        # User 2 accessing user 1's job -> 404
        self.client.force_authenticate(user=self.user2)
        resp_foreign = self.client.get(detail_url)
        self.assertEqual(resp_foreign.status_code, status.HTTP_404_NOT_FOUND)

        # Anonymous -> 401
        self.client.force_authenticate(user=None)
        resp_anon = self.client.get(detail_url)
        self.assertEqual(resp_anon.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_job_process_action_triggers_queued_job(self):
        job = create_reconstruction_job(self.user1, target_category='storage')
        process_url = reverse('furniture:reconstruction-jobs-process', kwargs={'pk': job.id})

        # Trigger process with sync=True
        resp = self.client.post(process_url, {"sync": True}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['status'], 'completed')
        self.assertIsNotNone(resp.data['model_download_url'])

        # Re-triggering completed job -> 400 Bad Request
        resp_repeat = self.client.post(process_url, {"sync": True}, format='json')
        self.assertEqual(resp_repeat.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already completed", resp_repeat.data['detail'])

        # User 2 triggering user 1's job -> 404
        self.client.force_authenticate(user=self.user2)
        resp_foreign = self.client.post(process_url, {"sync": True})
        self.assertEqual(resp_foreign.status_code, status.HTTP_404_NOT_FOUND)

    def test_job_model_streaming_security_headers_and_payload(self):
        job = create_reconstruction_job(self.user1, target_category='seating')
        run_reconstruction_job(job)
        model_url = reverse('furniture:reconstruction-jobs-model', kwargs={'pk': job.id})

        # User 1 streaming completed model
        resp = self.client.get(model_url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp['Content-Type'], 'model/gltf-binary')
        self.assertEqual(resp['Cache-Control'], 'private, no-cache, no-store, must-revalidate')
        self.assertEqual(resp['X-Content-Type-Options'], 'nosniff')

        # Read streaming content
        streamed_content = b"".join(resp.streaming_content)
        self.assertEqual(len(streamed_content), job.file_size_bytes)
        # Verify valid glTF 2.0 binary header
        self.assertTrue(streamed_content.startswith(b'glTF'))

        # User 2 streaming user 1's model -> 404
        self.client.force_authenticate(user=self.user2)
        resp_foreign = self.client.get(model_url)
        self.assertEqual(resp_foreign.status_code, status.HTTP_404_NOT_FOUND)

        # Anonymous streaming -> 401
        self.client.force_authenticate(user=None)
        resp_anon = self.client.get(model_url)
        self.assertEqual(resp_anon.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_job_model_streaming_rejects_non_completed_job(self):
        job = create_reconstruction_job(self.user1, target_category='decor')
        model_url = reverse('furniture:reconstruction-jobs-model', kwargs={'pk': job.id})

        resp = self.client.get(model_url)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not ready", resp.data['detail'])

    def test_job_model_streaming_handles_missing_file_or_path_traversal(self):
        job = create_reconstruction_job(self.user1, target_category='seating')
        run_reconstruction_job(job)
        model_url = reverse('furniture:reconstruction-jobs-model', kwargs={'pk': job.id})

        # Simulate missing file on disk
        delete_reconstruction_job_file(job)
        resp_missing = self.client.get(model_url)
        self.assertEqual(resp_missing.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("not found on disk", resp_missing.data['detail'])

        # Simulate path traversal attempt
        job.model_file_path = "../../etc/passwd"
        job.save()
        resp_traversal = self.client.get(model_url)
        self.assertEqual(resp_traversal.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Security violation", resp_traversal.data['detail'])

    def test_job_delete_cleans_up_record_and_file(self):
        job = create_reconstruction_job(self.user1, target_category='seating')
        run_reconstruction_job(job)
        abs_path = job.get_absolute_model_path()
        self.assertTrue(abs_path.exists())

        detail_url = reverse('furniture:reconstruction-jobs-detail', kwargs={'pk': job.id})
        resp = self.client.delete(detail_url)
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

        # Database record must be gone
        self.assertFalse(FurnitureReconstructionJob.objects.filter(id=job.id).exists())
        # Model file on disk must be purged
        self.assertFalse(abs_path.exists())

    def test_paid_provider_safeguard_retained_in_api(self):
        # When user creates job with provider="tripo" while IMAGE_TO_3D_ALLOW_PAID_REQUESTS=False,
        # it falls back to mock safely and records audit reason
        payload = {
            "target_category": "seating",
            "prompt_label": "Tripo Gated Armchair",
            "provider": "tripo",
            "sync": True
        }
        with patch('apps.furniture.reconstruction.tripo.urllib.request.urlopen') as mock_urlopen:
            resp = self.client.post(self.jobs_url, payload, format='json')
            self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
            # Never touched the network
            mock_urlopen.assert_not_called()

        data = resp.data
        self.assertEqual(data['status'], 'completed')
        self.assertIsNotNone(data['model_download_url'])



