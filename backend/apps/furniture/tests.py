from decimal import Decimal
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from apps.furniture.models import FurnitureAsset


class FurnitureCatalogueTests(APITestCase):
    def setUp(self):
        self.list_url = reverse('furniture:furniture-list')
        self.asset_sofa = FurnitureAsset.objects.create(
            id='test-sofa',
            name='Modern Leather Sofa',
            category='seating',
            width=Decimal('2.10'),
            height=Decimal('0.85'),
            depth=Decimal('0.90'),
            price_paise=2999900,
            currency='INR',
            license='CC0 1.0 Universal',
            description='Test sofa'
        )
        self.asset_desk = FurnitureAsset.objects.create(
            id='test-desk',
            name='Wooden Writing Desk',
            category='tables',
            width=Decimal('1.40'),
            height=Decimal('0.75'),
            depth=Decimal('0.70'),
            price_paise=1499900,
            currency='INR',
            license='CC0 1.0 Universal',
            description='Test desk'
        )

    def test_public_catalogue_list_allows_anonymous(self):
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)

    def test_filter_by_category(self):
        response = self.client.get(self.list_url, {'category': 'seating'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], 'test-sofa')

    def test_search_by_query(self):
        response = self.client.get(self.list_url, {'search': 'Writing'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['id'], 'test-desk')

    def test_price_calculation_in_inr_rupees(self):
        detail_url = reverse('furniture:furniture-detail', kwargs={'pk': 'test-sofa'})
        response = self.client.get(detail_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['price_paise'], 2999900)
        self.assertEqual(response.data['price_inr'], '29999.00')
        self.assertEqual(response.data['dimensions'], [2.1, 0.85, 0.9])
