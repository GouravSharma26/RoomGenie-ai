from rest_framework import serializers
from apps.ai_agent.models import AgentSession, AgentRun
from apps.designs.models import Design


class AgentRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentRun
        fields = [
            'id',
            'session',
            'user_prompt',
            'status',
            'ai_response_text',
            'proposed_actions',
            'validation_results',
            'provider_metadata',
            'base_scene_snapshot',
            'candidate_scene_snapshot',
            'applied_scene_snapshot',
            'created_at',
        ]
        read_only_fields = [
            'id',
            'status',
            'ai_response_text',
            'proposed_actions',
            'validation_results',
            'provider_metadata',
            'base_scene_snapshot',
            'candidate_scene_snapshot',
            'applied_scene_snapshot',
            'created_at',
        ]


class AgentSessionSerializer(serializers.ModelSerializer):
    runs = AgentRunSerializer(many=True, read_only=True)
    runs_count = serializers.IntegerField(source='runs.count', read_only=True)

    class Meta:
        model = AgentSession
        fields = [
            'id',
            'owner',
            'design',
            'title',
            'runs_count',
            'runs',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'owner', 'created_at', 'updated_at']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get('request')
        if request and hasattr(request, 'user') and request.user.is_authenticated:
            design_field = getattr(self, 'fields', {}).get('design')
            if design_field is not None:
                design_field.queryset = Design.objects.filter(owner=request.user)  # pyrefly: ignore[missing-attribute]

    def validate_design(self, value):
        if value is None:
            return value
        request = self.context.get('request')
        if request and hasattr(request, 'user') and request.user.is_authenticated:
            if value.owner != request.user:
                raise serializers.ValidationError("Cannot link a design owned by another user.")
        return value


class AgentPromptRequestSerializer(serializers.Serializer):
    prompt = serializers.CharField(
        max_length=2000,
        required=True,
        help_text="Natural language design prompt or spatial instructions."
    )
    scene_json = serializers.DictField(
        required=False,
        default=None,
        help_text="Current 3D editor scene state in canonical format."
    )
    design_id = serializers.UUIDField(
        required=False,
        default=None,
        help_text="Optional persisted design ID for context."
    )
