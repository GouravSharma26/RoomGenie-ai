from decimal import Decimal
from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from apps.designs.models import Design
from apps.rooms.models import Room


def create_sample_scene(room_w=5.0, room_l=4.0, room_h=2.8):
    return {
        'schemaVersion': 1,
        'unit': 'm',
        'room': {
            'width': room_w,
            'length': room_l,
            'height': room_h,
        },
        'objects': [
            {
                'id': 'placement-sofa-1',
                'assetId': 'sofa-modern-3seater',
                'name': 'Modern 3-Seater Sofa',
                'position': [0.5, 0.425, -0.2],
                'rotationEuler': [0.0, 1.57, 0.0],
                'scale': [1.0, 1.0, 1.0],
                'dimensions': [2.1, 0.85, 0.9],
                'materialOverrides': {
                    'color': '#4f46e5',
                    'roughness': 0.7,
                    'metalness': 0.1,
                },
            }
        ],
    }


class DesignPersistenceTests(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(username='alice', password='AlicePassword2026!')
        self.token_a = Token.objects.create(user=self.user_a)

        self.user_b = User.objects.create_user(username='bob', password='BobPassword2026!')
        self.token_b = Token.objects.create(user=self.user_b)

        self.room_a = Room.objects.create(
            owner=self.user_a,
            name="Alice's Living Room",
            width=Decimal('5.00'),
            length=Decimal('4.00'),
            height=Decimal('2.80')
        )
        self.room_b = Room.objects.create(
            owner=self.user_b,
            name="Bob's Studio",
            width=Decimal('6.00'),
            length=Decimal('5.00'),
            height=Decimal('3.00')
        )

        self.list_url = reverse('designs:design-list')

    def test_unauthenticated_requests_are_rejected(self):
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_design_with_valid_canonical_scene(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        payload = {
            'title': 'Contemporary Minimalist Lounge',
            'description': 'Lounge concept with low-profile sofa',
            'room_id': str(self.room_a.id),
            'budget': 3500000,
            'style_preferences': ['minimalist', 'contemporary'],
            'scene_json': create_sample_scene(),
        }
        response = self.client.post(self.list_url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['title'], 'Contemporary Minimalist Lounge')
        self.assertEqual(response.data['object_count'], 1)
        self.assertEqual(response.data['owner_username'], 'alice')

        design = Design.objects.get(id=response.data['id'])
        self.assertEqual(design.owner, self.user_a)
        self.assertEqual(design.room, self.room_a)
        self.assertEqual(len(design.scene_json['objects']), 1)

    def test_reject_unsupported_schema_version(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        scene = create_sample_scene()
        scene['schemaVersion'] = 99
        payload = {'title': 'Bad Schema', 'scene_json': scene}
        response = self.client.post(self.list_url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('scene_json', response.data)

    def test_reject_non_metric_units(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        scene = create_sample_scene()
        scene['unit'] = 'inches'
        payload = {'title': 'Bad Unit', 'scene_json': scene}
        response = self.client.post(self.list_url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_missing_or_out_of_bounds_room_dimensions(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        # Width too small (< 2m)
        scene = create_sample_scene(room_w=1.2)
        response = self.client.post(self.list_url, {'title': 'Narrow Room', 'scene_json': scene}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        # Length too large (> 25m)
        scene2 = create_sample_scene(room_l=35.0)
        response2 = self.client.post(self.list_url, {'title': 'Massive Room', 'scene_json': scene2}, format='json')
        self.assertEqual(response2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_furniture_position_outside_room_boundaries(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        scene = create_sample_scene(room_w=5.0, room_l=4.0)
        # Room width is 5.0m, so bounds are ±2.5m. Place object at X = 5.0m:
        scene['objects'][0]['position'] = [5.0, 0.425, 0.0]
        response = self.client.post(self.list_url, {'title': 'Out of Bounds', 'scene_json': scene}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('scene_json', response.data)

    def test_reject_extreme_or_invalid_scale(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        scene = create_sample_scene()
        scene['objects'][0]['scale'] = [0.01, 1.0, 1.0]  # Below MIN_SCALE 0.1
        response = self.client.post(self.list_url, {'title': 'Tiny Scale', 'scene_json': scene}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_nan_or_infinite_numbers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        scene = create_sample_scene()
        scene['objects'][0]['position'] = ['not-a-number', 0, 0]
        response = self.client.post(self.list_url, {'title': 'NaN Pos', 'scene_json': scene}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_duplicate_object_ids(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        scene = create_sample_scene()
        second_obj = dict(scene['objects'][0])
        scene['objects'].append(second_obj)  # Duplicate ID 'placement-sofa-1'
        response = self.client.post(self.list_url, {'title': 'Dup IDs', 'scene_json': scene}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_prevent_associating_another_users_room(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        payload = {
            'title': 'Cross User Room Exploit',
            'room_id': str(self.room_b.id),  # Belongs to user_b
            'scene_json': create_sample_scene(),
        }
        response = self.client.post(self.list_url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('room_id', response.data)

    def test_ownership_isolation_for_designs(self):
        design_a = Design.objects.create(
            owner=self.user_a,
            room=self.room_a,
            title="Alice's Private Design",
            scene_json=create_sample_scene()
        )
        detail_url = reverse('designs:design-detail', kwargs={'pk': design_a.id})
        dup_url = reverse('designs:design-duplicate', kwargs={'pk': design_a.id})

        # User B queries list
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_b.key}')
        list_response = self.client.get(self.list_url)
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data), 0)

        # User B cannot retrieve User A's design (404)
        get_response = self.client.get(detail_url)
        self.assertEqual(get_response.status_code, status.HTTP_404_NOT_FOUND)

        # User B cannot update User A's design (404)
        patch_response = self.client.patch(detail_url, {'title': 'Hacked Title'}, format='json')
        self.assertEqual(patch_response.status_code, status.HTTP_404_NOT_FOUND)

        # User B cannot delete User A's design (404)
        del_response = self.client.delete(detail_url)
        self.assertEqual(del_response.status_code, status.HTTP_404_NOT_FOUND)

        # User B cannot duplicate User A's design (404)
        dup_response = self.client.post(dup_url)
        self.assertEqual(dup_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_and_delete_design_authenticated_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        design = Design.objects.create(
            owner=self.user_a,
            title="Initial Title",
            scene_json=create_sample_scene()
        )
        detail_url = reverse('designs:design-detail', kwargs={'pk': design.id})

        # Update
        updated_scene = create_sample_scene()
        updated_scene['objects'][0]['materialOverrides']['color'] = '#10b981'
        patch_response = self.client.patch(detail_url, {
            'title': 'Updated Title',
            'scene_json': updated_scene
        }, format='json')
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_response.data['title'], 'Updated Title')
        self.assertEqual(patch_response.data['scene_json']['objects'][0]['materialOverrides']['color'], '#10b981')

        # Delete
        delete_response = self.client.delete(detail_url)
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Design.objects.filter(id=design.id).exists())

    def test_duplicate_design_creates_independent_copy(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token_a.key}')
        design = Design.objects.create(
            owner=self.user_a,
            room=self.room_a,
            title="Master Bedroom Plan",
            scene_json=create_sample_scene()
        )
        dup_url = reverse('designs:design-duplicate', kwargs={'pk': design.id})

        response = self.client.post(dup_url)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['title'], 'Copy of Master Bedroom Plan')
        self.assertNotEqual(str(response.data['id']), str(design.id))
        self.assertEqual(Design.objects.filter(owner=self.user_a).count(), 2)

    def test_foreign_key_room_deletion_preserves_design(self):
        design = Design.objects.create(
            owner=self.user_a,
            room=self.room_a,
            title="Design with Room",
            scene_json=create_sample_scene()
        )
        # Delete room_a
        self.room_a.delete()
        # Design must NOT be deleted, but design.room becomes None (SET_NULL)
        design.refresh_from_db()
        self.assertIsNone(design.room)
        self.assertEqual(design.title, "Design with Room")
