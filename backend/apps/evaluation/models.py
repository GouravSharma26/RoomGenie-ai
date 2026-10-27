import uuid
from django.db import models
from django.utils import timezone


class EvaluationSession(models.Model):
    """
    Persistent Research Evaluation Session Model for RoomGenie AI.
    Conforms to ExperimentSessionRecord schema defined in docs/RESEARCH_PROTOCOL_AND_TASKS.md Section 9.3.
    """
    CONDITION_CHOICES = (
        ('manual', 'Manual'),
        ('ai_assisted', 'AI-Assisted'),
    )

    SEQUENCE_CHOICES = (
        ('G1', 'G1'),
        ('G2', 'G2'),
        ('G3', 'G3'),
        ('G4', 'G4'),
    )

    TASK_CHOICES = (
        ('living_room', 'Living Room'),
        ('home_study', 'Home Study'),
    )

    STATUS_CHOICES = (
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('aborted', 'Aborted'),
    )

    ABORT_REASON_CHOICES = (
        ('user_cancelled', 'User Cancelled'),
        ('inactivity_timeout', 'Inactivity Timeout'),
        ('browser_closed', 'Browser Closed'),
    )

    # Core identification & study assignment
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    participant_id = models.CharField(max_length=64, db_index=True)
    condition = models.CharField(max_length=32, choices=CONDITION_CHOICES)
    sequence_order = models.CharField(max_length=8, choices=SEQUENCE_CHOICES)
    trial_period = models.PositiveSmallIntegerField(
        choices=((1, 'Period 1'), (2, 'Period 2')),
        default=1,
        help_text="Trial period within the 2-trial crossover sequence (1 or 2)."
    )
    task_name = models.CharField(max_length=64, choices=TASK_CHOICES)
    session_status = models.CharField(max_length=32, default='in_progress', choices=STATUS_CHOICES, db_index=True)

    # Capability-based authorization: high-entropy secret hash
    session_secret_hash = models.CharField(
        max_length=64,
        blank=True,
        default='',
        help_text="SHA-256 hash of capability bearer token issued at session start."
    )

    # Revision-ordered checkpoint tracking
    checkpoint_sequence = models.PositiveIntegerField(default=0)

    # Timestamps & durations
    start_time = models.DateTimeField(default=timezone.now)
    end_time = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.FloatField(null=True, blank=True)
    active_duration_seconds = models.FloatField(default=0.0)

    # Abort tracking
    aborted_at = models.DateTimeField(null=True, blank=True)
    abort_reason = models.CharField(max_length=64, null=True, blank=True, choices=ABORT_REASON_CHOICES)

    # Granular inactivity tracking
    idle_intervals = models.JSONField(default=list, blank=True)
    total_idle_duration_seconds = models.FloatField(default=0.0)
    max_single_idle_gap_seconds = models.FloatField(default=0.0)
    has_prolonged_interruption = models.BooleanField(default=False)

    # Authoritative server-side evaluated metrics
    budget_total_paise = models.BigIntegerField(null=True, blank=True)
    budget_ceiling_paise = models.BigIntegerField(default=0)
    is_budget_compliant = models.BooleanField(null=True, blank=True)
    attempted_out_of_bounds_count = models.PositiveIntegerField(default=0)
    final_scene_out_of_bounds_count = models.PositiveIntegerField(null=True, blank=True)
    aabb_overlap_pairs_count = models.PositiveIntegerField(null=True, blank=True)
    doorway_intrusions_count = models.PositiveIntegerField(null=True, blank=True)
    is_task_successful = models.BooleanField(null=True, blank=True)

    # Interaction effort counters
    total_edits = models.PositiveIntegerField(default=0)
    undo_redo_count = models.PositiveIntegerField(default=0)

    # AI Agent multi-tier validity metrics (Condition B only)
    agent_proposals_count = models.PositiveIntegerField(default=0)
    agent_accepted_count = models.PositiveIntegerField(default=0)
    agent_tier1_success_count = models.PositiveIntegerField(default=0)
    agent_tier2_schema_valid_count = models.PositiveIntegerField(default=0)
    agent_tier3_domain_valid_count = models.PositiveIntegerField(default=0)

    # Dual Scene Snapshots: intermediate recovery vs authoritative final submission
    checkpoint_scene_snapshot = models.JSONField(null=True, blank=True)
    final_scene_snapshot = models.JSONField(null=True, blank=True)

    # Standard Usability Survey (System Usability Scale - Brooke 1996)
    sus_responses = models.JSONField(
        null=True,
        blank=True,
        help_text="10-item System Usability Scale Likert responses (1-5)."
    )
    sus_score = models.FloatField(
        null=True,
        blank=True,
        help_text="Composite System Usability Scale score (0-100)."
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_time']
        verbose_name = 'Evaluation Session'
        verbose_name_plural = 'Evaluation Sessions'

    def __str__(self):
        return f"{self.participant_id} [{self.condition}/{self.task_name}] ({self.session_status})"
