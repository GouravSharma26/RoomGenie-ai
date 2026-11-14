from rest_framework import serializers
from apps.ai_agent.models import AgentSession, AgentRun, UserDesignPreference
from apps.ai_agent.preference_engine import (
    SUPPORTED_STYLES,
    SUPPORTED_COLOURS,
    SUPPORTED_MATERIALS,
    SUPPORTED_LAYOUTS,
    SUPPORTED_FUNCTIONAL_PRIORITIES,
)
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
    spatial_context = serializers.DictField(
        required=False,
        default=None,
        help_text="Optional versioned SpatialContext representation."
    )
    candidate_count = serializers.IntegerField(
        required=False,
        default=3,
        min_value=1,
        max_value=5,
        help_text="Number of candidate layout alternatives to generate (1 to 5, default 3)."
    )
    user_requirements = serializers.DictField(
        required=False,
        default=None,
        help_text="Optional user constraints, e.g. required_categories, budget_paise."
    )
    preferences = serializers.DictField(
        required=False,
        default=None,
        help_text="Optional structured design preferences (Phase 7.1)."
    )


class UserDesignPreferenceSerializer(serializers.ModelSerializer):
    budget_ceiling_paise = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=0,
    )
    preserve_object_ids = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list,
    )

    class Meta:
        model = UserDesignPreference
        fields = [
            'id',
            'schema_version',
            'style_preferences',
            'primary_style',
            'colour_preferences',
            'material_preferences',
            'layout_preferences',
            'functional_priorities',
            'budget_preferences',
            'budget_ceiling_paise',
            'furniture_preferences',
            'preservation_preferences',
            'preserve_object_ids',
            'preference_weights',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        budget_pref = instance.budget_preferences or {}
        pres_pref = instance.preservation_preferences or {}
        ret['budget_ceiling_paise'] = budget_pref.get('budget_ceiling_paise')
        ret['preserve_object_ids'] = pres_pref.get('preserve_object_ids', [])
        return ret

    def create(self, validated_data):
        budget_ceiling = validated_data.pop('budget_ceiling_paise', None)
        preserve_ids = validated_data.pop('preserve_object_ids', None)
        if budget_ceiling is not None:
            bp = validated_data.setdefault('budget_preferences', {})
            bp['budget_ceiling_paise'] = budget_ceiling
        if preserve_ids is not None:
            pp = validated_data.setdefault('preservation_preferences', {})
            pp['preserve_object_ids'] = preserve_ids
        return super().create(validated_data)

    def update(self, instance, validated_data):
        budget_ceiling = validated_data.pop('budget_ceiling_paise', None)
        preserve_ids = validated_data.pop('preserve_object_ids', None)
        if budget_ceiling is not None:
            bp = instance.budget_preferences or {}
            bp['budget_ceiling_paise'] = budget_ceiling
            instance.budget_preferences = bp
        if preserve_ids is not None:
            pp = instance.preservation_preferences or {}
            pp['preserve_object_ids'] = preserve_ids
            instance.preservation_preferences = pp
        return super().update(instance, validated_data)

    def validate_style_preferences(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("style_preferences must be a list.")
        for item in value:
            clean = str(item).lower().strip().replace('-', '_')
            if clean not in SUPPORTED_STYLES:
                raise serializers.ValidationError(f"Unsupported style '{item}'. Supported: {sorted(list(SUPPORTED_STYLES))}")
        return [str(item).lower().strip().replace('-', '_') for item in value]

    def validate_colour_preferences(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("colour_preferences must be a list.")
        for item in value:
            clean = str(item).lower().strip().replace('-', '_')
            if clean not in SUPPORTED_COLOURS:
                raise serializers.ValidationError(f"Unsupported colour '{item}'. Supported: {sorted(list(SUPPORTED_COLOURS))}")
        return [str(item).lower().strip().replace('-', '_') for item in value]

    def validate_material_preferences(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("material_preferences must be a list.")
        for item in value:
            clean = str(item).lower().strip().replace('-', '_')
            if clean not in SUPPORTED_MATERIALS:
                raise serializers.ValidationError(f"Unsupported material '{item}'. Supported: {sorted(list(SUPPORTED_MATERIALS))}")
        return [str(item).lower().strip().replace('-', '_') for item in value]

    def validate_layout_preferences(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("layout_preferences must be a list.")
        for item in value:
            clean = str(item).lower().strip().replace('-', '_')
            if clean not in SUPPORTED_LAYOUTS:
                raise serializers.ValidationError(f"Unsupported layout '{item}'. Supported: {sorted(list(SUPPORTED_LAYOUTS))}")
        return [str(item).lower().strip().replace('-', '_') for item in value]

    def validate_functional_priorities(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("functional_priorities must be a list.")
        for item in value:
            clean = str(item).lower().strip().replace('-', '_')
            if clean not in SUPPORTED_FUNCTIONAL_PRIORITIES:
                raise serializers.ValidationError(f"Unsupported priority '{item}'. Supported: {sorted(list(SUPPORTED_FUNCTIONAL_PRIORITIES))}")
        return [str(item).lower().strip().replace('-', '_') for item in value]

    def validate_preference_weights(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("preference_weights must be a dictionary.")
        for k, v in value.items():
            try:
                num = float(v)
                if num < 0.0 or num > 5.0:
                    raise serializers.ValidationError(f"Weight '{k}' must be between 0.0 and 5.0.")
            except (ValueError, TypeError):
                raise serializers.ValidationError(f"Weight '{k}' must be a valid float number.")
        return value

