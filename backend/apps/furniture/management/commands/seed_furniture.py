from decimal import Decimal
from django.core.management.base import BaseCommand
from apps.furniture.models import FurnitureAsset

SEED_DATA = [
    {
        'id': 'sofa-modern-3seater',
        'name': 'Modern 3-Seater Sofa',
        'category': 'seating',
        'style_tags': ['modern', 'minimalist', 'living-room'],
        'width': Decimal('2.10'),
        'height': Decimal('0.85'),
        'depth': Decimal('0.90'),
        'price_paise': 2999900,
        'model_url': '/models/sofa.glb',
        'license': 'CC0 1.0 Universal',
        'source': 'RoomGenie Architectural Assets (see ASSET_LICENSES.md)',
        'description': 'Contemporary low-profile three-seater sofa with deep foam cushions and solid wood base.',
    },
    {
        'id': 'table-oak-coffee',
        'name': 'Minimalist Coffee Table',
        'category': 'tables',
        'style_tags': ['scandinavian', 'wood', 'living-room'],
        'width': Decimal('1.20'),
        'height': Decimal('0.45'),
        'depth': Decimal('0.60'),
        'price_paise': 849900,
        'model_url': '/models/coffee_table.glb',
        'license': 'CC0 1.0 Universal',
        'source': 'RoomGenie Architectural Assets (see ASSET_LICENSES.md)',
        'description': 'Clean Scandinavian solid oak coffee table with rounded chamfered edges.',
    },
    {
        'id': 'desk-workspace-study',
        'name': 'Ergonomic Study Desk',
        'category': 'tables',
        'style_tags': ['industrial', 'workspace', 'home-office'],
        'width': Decimal('1.40'),
        'height': Decimal('0.75'),
        'depth': Decimal('0.70'),
        'price_paise': 1499900,
        'model_url': '/models/desk.glb',
        'license': 'CC0 1.0 Universal',
        'source': 'RoomGenie Architectural Assets (see ASSET_LICENSES.md)',
        'description': 'Spacious work-from-home desk with dual cable cutouts and matte steel legs.',
    },
    {
        'id': 'chair-accent-armchair',
        'name': 'Lounge Accent Armchair',
        'category': 'seating',
        'style_tags': ['accent', 'living-room', 'reading'],
        'width': Decimal('0.85'),
        'height': Decimal('0.88'),
        'depth': Decimal('0.85'),
        'price_paise': 1199900,
        'model_url': None,
        'license': 'CC0 1.0 Universal',
        'source': 'RoomGenie Architectural Assets (Procedural, see ASSET_LICENSES.md)',
        'description': 'Comfortable textured fabric reading armchair with tapered wooden legs.',
    },
    {
        'id': 'storage-bookshelf-tall',
        'name': '4-Tier Architectural Bookshelf',
        'category': 'storage',
        'style_tags': ['modern', 'walnut', 'storage'],
        'width': Decimal('1.00'),
        'height': Decimal('1.80'),
        'depth': Decimal('0.35'),
        'price_paise': 1649900,
        'model_url': None,
        'license': 'CC0 1.0 Universal',
        'source': 'RoomGenie Architectural Assets (Procedural, see ASSET_LICENSES.md)',
        'description': 'Open-backed vertical display shelving unit crafted from walnut veneer and blackened steel.',
    },
]


class Command(BaseCommand):
    help = 'Seeds initial CC0 architectural furniture catalogue items'

    def handle(self, *args, **options):
        count = 0
        for item in SEED_DATA:
            asset, created = FurnitureAsset.objects.update_or_create(
                id=item['id'],
                defaults=item
            )
            count += 1
            action = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f"{action} furniture asset: {asset.name} ({asset.id})"))
        self.stdout.write(self.style.SUCCESS(f"Successfully seeded {count} furniture catalogue assets."))
