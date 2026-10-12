import uuid
from django.conf import settings
from django.db import models


class Design(models.Model):
    """
    Saved 3D room design snapshot authored by an authenticated user.
    Holds the canonical scene JSON representation (Room + Placed Furniture objects).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='designs'
    )
    room = models.ForeignKey(
        'rooms.Room',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='designs',
        help_text='Associated physical room envelope (optional)'
    )
    title = models.CharField(max_length=120, default='Untitled Design')
    description = models.TextField(blank=True, default='')
    budget = models.BigIntegerField(
        null=True,
        blank=True,
        help_text='Design budget constraint in INR paise (e.g., 5000000 = ₹50,000)'
    )
    style_preferences = models.JSONField(default=list, blank=True)
    scene_json = models.JSONField(help_text='Canonical scene JSON representation')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.title} [{self.owner.username}] ({self.id})"

    @property
    def object_count(self) -> int:
        if isinstance(self.scene_json, dict):
            objects = self.scene_json.get('objects', [])
            if isinstance(objects, list):
                return len(objects)
        return 0
