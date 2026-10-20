import struct
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from apps.furniture.models import FurnitureAsset, FurnitureReconstructionJob
from apps.furniture.reconstruction.validator import GLBValidator, GLBValidationError
from apps.furniture.reconstruction.mock import MockImageTo3DAdapter, build_procedural_furniture_glb
from apps.furniture.reconstruction.tripo import TripoImageTo3DAdapter
from apps.designs.models import Design

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
        # Should raise either chunk header truncated or unparsed trailing bytes
        self.assertTrue("trailing bytes" in str(ctx.exception) or "truncated" in str(ctx.exception).lower())


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
            # Must strictly pass GLBValidator
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
        # Returns HTML/bad bytes
        with self.assertRaises(GLBValidationError):
            GLBValidator.validate(res.model_bytes)

    def test_simulation_oversized_glb_hook(self):
        res = self.adapter.generate_furniture_model(
            image_path='sample.jpg',
            context={'simulate_oversized_glb': True}
        )
        with self.assertRaises(GLBValidationError):
            GLBValidator.validate(res.model_bytes, max_size_bytes=15 * 1024 * 1024)


class TripoAdapterFallbackTests(APITestCase):
    """
    Tests ensuring TripoImageTo3DAdapter safely falls back to mock and redacts secrets.
    """

    def test_tripo_falls_back_when_key_unconfigured_or_placeholder(self):
        adapter = TripoImageTo3DAdapter(api_key='tsk_placeholder_12345')
        res = adapter.generate_furniture_model(
            image_path='sample.jpg',
            category='seating',
            prompt_label='Nordic sofa'
        )
        self.assertEqual(res.provider, 'mock')
        self.assertTrue(res.raw_metadata.get('fallback_used'))
        self.assertEqual(res.raw_metadata.get('fallback_reason'), 'tripo_api_key_not_configured')
        # Ensure returned model is valid GLB
        val = GLBValidator.validate(res.model_bytes)
        self.assertTrue(val['valid'])

    def test_tripo_error_redacts_api_key(self):
        secret_key = "secret_live_api_key_9999"
        adapter = TripoImageTo3DAdapter(api_key=secret_key)
        # Simulating live call without network should trigger exception and fall back
        res = adapter.generate_furniture_model(
            image_path='sample.jpg',
            category='tables',
            context={'file_token': 'dummy'}
        )
        self.assertEqual(res.provider, 'mock')
        self.assertTrue(res.raw_metadata.get('fallback_used'))
        reason = res.raw_metadata.get('fallback_reason', '')
        self.assertNotIn(secret_key, reason)


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
        from apps.furniture.reconstruction.services import create_reconstruction_job
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
        from apps.furniture.reconstruction.services import (
            create_reconstruction_job,
            run_reconstruction_job,
            delete_reconstruction_job_file
        )
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
        from apps.furniture.reconstruction.services import create_reconstruction_job, run_reconstruction_job
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
        # Verify no orphan file created
        self.assertEqual(failed_job.model_file_path, '')
        self.assertEqual(failed_job.suggested_catalogue_fallback_id, 'bed-queen-platform')

    def test_run_reconstruction_job_handles_validation_failure_and_cleans_up(self):
        from apps.furniture.reconstruction.services import create_reconstruction_job, run_reconstruction_job
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

    def test_catalogue_fallback_keyword_resolution(self):
        from apps.furniture.reconstruction.services import resolve_catalogue_fallback
        self.assertEqual(resolve_catalogue_fallback('seating', 'Velvet Armchair'), 'chair-accent-armchair')
        self.assertEqual(resolve_catalogue_fallback('tables', 'Computer Desk'), 'desk-workspace-study')
        self.assertEqual(resolve_catalogue_fallback('storage', 'Wooden Wardrobe'), 'storage-wardrobe-2door')
        self.assertEqual(resolve_catalogue_fallback('decor', 'Tall Indoor Plant'), 'decor-plant-floor-vase')
        self.assertEqual(resolve_catalogue_fallback('unknown', ''), 'sofa-modern-3seater')


