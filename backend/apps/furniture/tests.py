from decimal import Decimal
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from apps.furniture.models import FurnitureAsset
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

    def test_budget_estimate_via_persisted_design_id(self):
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

