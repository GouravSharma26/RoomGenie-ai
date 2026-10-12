from decimal import Decimal
from django.db import models


class FurnitureAsset(models.Model):
    """
    Authoritative furniture asset metadata.
    Pricing is strictly represented in integer paise (INR minor units).
    """
    CATEGORY_CHOICES = [
        ('seating', 'Seating'),
        ('tables', 'Tables'),
        ('storage', 'Storage'),
        ('beds', 'Beds'),
        ('decor', 'Decor'),
    ]

    id = models.CharField(max_length=80, primary_key=True, help_text='Catalog asset slug/ID')
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default='seating')
    style_tags = models.JSONField(default=list, blank=True)
    
    width = models.DecimalField(max_digits=5, decimal_places=2, help_text='Width in metres')
    height = models.DecimalField(max_digits=5, decimal_places=2, help_text='Height in metres')
    depth = models.DecimalField(max_digits=5, decimal_places=2, help_text='Depth in metres')

    price_paise = models.BigIntegerField(
        default=0,
        help_text='Deterministic price in INR paise (1 INR = 100 paise)'
    )
    currency = models.CharField(max_length=10, default='INR')

    model_url = models.CharField(max_length=255, blank=True, null=True, help_text='Static or CDN model GLB URL')
    thumbnail_url = models.CharField(max_length=255, blank=True, null=True)

    license = models.CharField(max_length=100, default='CC0 1.0 Universal')
    source = models.CharField(max_length=255, default='RoomGenie Architectural Assets')
    description = models.TextField(blank=True, default='')

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['category', 'name']

    @property
    def price_inr(self) -> Decimal:
        """Helper property to calculate exact INR rupees as Decimal."""
        return Decimal(self.price_paise) / Decimal(100)

    def __str__(self):
        return f"{self.name} (₹{self.price_inr:,.2f}) [{self.id}]"
