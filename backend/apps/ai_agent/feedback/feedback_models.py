import uuid
from django.conf import settings
from django.db import models


class UserCandidateFeedback(models.Model):
    """
    Stores explicit user feedback (select, like, dislike, reject, modify)
    for an AI layout candidate (Phase 7.3).
    Maintains strict user isolation and links back to AgentRun and Design.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='candidate_feedbacks',
        db_index=True
    )
    design = models.ForeignKey(
        'designs.Design',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='candidate_feedbacks'
    )
    run = models.ForeignKey(
        'ai_agent.AgentRun',
        on_delete=models.CASCADE,
        related_name='candidate_feedbacks'
    )
    candidate_id = models.CharField(max_length=100, db_index=True)
    feedback_type = models.CharField(max_length=50, db_index=True)
    structured_reasons = models.JSONField(default=list, blank=True)
    feedback_text = models.TextField(blank=True, default="")
    candidate_score = models.FloatField(default=0.0)
    candidate_label = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'candidate_id']),
            models.Index(fields=['user', 'feedback_type']),
            models.Index(fields=['user', '-created_at']),
        ]

    def __str__(self):
        return f"Feedback[{self.feedback_type}] by {self.user} on {self.candidate_id}"


class UserPairwiseComparison(models.Model):
    """
    Stores structured pairwise comparisons between two candidates (Phase 7.3).
    Captures directional relative preference and explicit justification reasons.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='pairwise_comparisons',
        db_index=True
    )
    design = models.ForeignKey(
        'designs.Design',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='pairwise_comparisons'
    )
    run = models.ForeignKey(
        'ai_agent.AgentRun',
        on_delete=models.CASCADE,
        related_name='pairwise_comparisons'
    )
    candidate_a_id = models.CharField(max_length=100)
    candidate_b_id = models.CharField(max_length=100)
    outcome = models.CharField(max_length=50)  # 'a_preferred', 'b_preferred', 'both_acceptable', 'neither_acceptable'
    structured_reasons = models.JSONField(default=list, blank=True)
    comparison_text = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
        ]

    def __str__(self):
        return f"Comparison[{self.outcome}] by {self.user} between {self.candidate_a_id} and {self.candidate_b_id}"


class LearnedPreferenceAdjustment(models.Model):
    """
    Stores bounded, deterministic preference weight adjustments derived from
    explicit user feedback and pairwise comparisons (Phase 7.3).
    Maintains transparency: explains why each weight changed and tracks evidence count.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='learned_preference_adjustment'
    )
    model_version = models.IntegerField(default=1)
    feedback_count = models.IntegerField(default=0)
    adjusted_weights = models.JSONField(default=dict, blank=True)
    confidence_scores = models.JSONField(default=dict, blank=True)
    explanations = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"LearnedAdjustments for {self.user.username} (count={self.feedback_count}, active={self.is_active})"
