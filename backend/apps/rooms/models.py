import uuid
from decimal import Decimal
from django.conf import settings
from django.db import models


class Room(models.Model):
    """
    Physical room envelope owned by a user.
    Dimensions stored authoritatively in metres (m).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='rooms'
    )
    name = models.CharField(max_length=120, default='My Room')
    width = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('5.00'),
        help_text='Room width along X axis in metres'
    )
    length = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('4.00'),
        help_text='Room length along Z axis in metres'
    )
    height = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal('2.80'),
        help_text='Room ceiling height along Y axis in metres'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.name} ({self.width}m x {self.length}m x {self.height}m) [{self.owner.username}]"
