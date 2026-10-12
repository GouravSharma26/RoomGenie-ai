import uuid
from django.conf import settings
from django.db import models


class AgentSession(models.Model):
    """
    Persistent conversational session between a user and RoomGenie AI design agent.
    Optionally attached to a saved design project.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='agent_sessions'
    )
    design = models.ForeignKey(
        'designs.Design',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='agent_sessions'
    )
    title = models.CharField(max_length=255, default='AI Interior Design Session')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"AgentSession {self.id} ({self.owner.email}): {self.title}"


class AgentRun(models.Model):
    """
    Represents an individual agent execution step / turn.
    Stores user instruction, AI structured proposal, deterministic validation results,
    and user approval state. The design scene is NEVER mutated until user explicitly approves.
    """
    STATUS_PROPOSED = 'proposed'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_FAILED = 'failed'

    STATUS_CHOICES = [
        (STATUS_PROPOSED, 'Proposed (Pending User Approval)'),
        (STATUS_APPROVED, 'Approved & Applied'),
        (STATUS_REJECTED, 'Rejected by User'),
        (STATUS_FAILED, 'Failed Execution'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        AgentSession,
        on_delete=models.CASCADE,
        related_name='runs'
    )
    user_prompt = models.TextField()
    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default=STATUS_PROPOSED
    )
    ai_response_text = models.TextField(blank=True, default='')
    proposed_actions = models.JSONField(
        default=list,
        help_text="Allowlisted list of structured actions proposed by the model."
    )
    validation_results = models.JSONField(
        default=dict,
        help_text="Deterministic application validation (bounds, containment, budget, errors)."
    )
    provider_metadata = models.JSONField(
        default=dict,
        help_text="Provider, model ID, latency, and safe telemetry metadata."
    )
    applied_scene_snapshot = models.JSONField(
        null=True,
        blank=True,
        help_text="Scene snapshot when actions are applied."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"AgentRun {self.id} [{self.status}]: {self.user_prompt[:40]}"
