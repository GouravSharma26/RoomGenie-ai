from rest_framework import exceptions, permissions, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db import transaction
from django.shortcuts import get_object_or_404
from apps.ai_agent.models import AgentSession, AgentRun
from apps.ai_agent.serializers import (
    AgentSessionSerializer,
    AgentRunSerializer,
    AgentPromptRequestSerializer,
)
from apps.ai_agent.adapters import get_design_llm_adapter
from apps.ai_agent.tools import validate_and_simulate_actions
from apps.ai_agent.candidate_types import compute_canonical_scene_hash
from apps.ai_agent.candidate_generator import CandidateGenerator
from apps.designs.models import Design
from apps.designs.validators import validate_canonical_scene
from apps.furniture.models import FurnitureAsset



class AgentSessionViewSet(viewsets.ModelViewSet):
    """
    CRUD viewset for persistent AI interior design sessions.
    Strictly isolated by user ownership: users can never access sessions of other users.
    """
    serializer_class = AgentSessionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return AgentSession.objects.filter(owner=self.request.user)  # pyrefly: ignore[missing-attribute]

    def perform_create(self, serializer):
        design = serializer.validated_data.get('design')
        if design and design.owner != self.request.user:
            raise exceptions.PermissionDenied("Cannot attach a design owned by another user.")
        serializer.save(owner=self.request.user)


class AgentPromptView(APIView):
    """
    POST /api/v1/agent/sessions/{session_id}/prompt/
    Submit a user instruction to the AI design assistant.
    1. The model proposes typed, structured operations.
    2. Django and application rules deterministically simulate and validate them.
    3. An AgentRun is recorded in 'proposed' state.
    4. The design is NOT mutated until explicit user approval.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, session_id):
        session = get_object_or_404(AgentSession, id=session_id, owner=request.user)

        serializer = AgentPromptRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        prompt = serializer.validated_data['prompt']
        client_scene = serializer.validated_data.get('scene_json')
        spatial_context = serializer.validated_data.get('spatial_context')

        # Determine current scene context:
        # For sessions attached to saved designs, the authoritative saved design scene is used.
        if session.design and session.design.scene_json:
            current_scene = session.design.scene_json
        elif client_scene and isinstance(client_scene, dict) and 'room' in client_scene:
            current_scene = client_scene
        else:
            current_scene = {
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [],
            }

        # Catalogue context summary for model
        catalogue_items = list(
            FurnitureAsset.objects.filter(is_active=True).values(  # pyrefly: ignore[missing-attribute]
                'id', 'name', 'category', 'width', 'height', 'depth', 'price_paise'
            )
        )

        # Build conversation history
        history = [
            {'role': 'user' if i % 2 == 0 else 'assistant', 'content': r.user_prompt if i % 2 == 0 else r.ai_response_text}
            for i, r in enumerate(session.runs.order_by('created_at')[:6])
        ]

        # Extract candidate parameters
        candidate_count = serializer.validated_data.get('candidate_count', 3)
        user_requirements = serializer.validated_data.get('user_requirements')
        max_budget = session.design.budget if (session.design and session.design.budget) else None

        # Call CandidateGenerator orchestrator
        adapter = get_design_llm_adapter()
        generator = CandidateGenerator(adapter=adapter)
        candidates = generator.generate_candidates(
            user_prompt=prompt,
            current_scene=current_scene,
            candidate_count=candidate_count,
            max_budget_paise=max_budget,
            user_requirements=user_requirements,
            conversation_history=history,
            catalogue_context=catalogue_items,
            spatial_context=spatial_context,
        )

        source_scene_hash = compute_canonical_scene_hash(current_scene)

        # Primary candidate (top-ranked candidate or fallback)
        primary_candidate = candidates[0] if candidates else None
        proposed_actions = primary_candidate.proposed_actions if primary_candidate else []
        candidate_scene = primary_candidate.candidate_scene if primary_candidate else current_scene
        ai_response_text = primary_candidate.reasoning_summary if primary_candidate else "No candidates generated."
        budget_diff = primary_candidate.budget_diff if primary_candidate else {}
        is_valid = primary_candidate.is_valid if primary_candidate else False
        schema_valid = primary_candidate.schema_valid if primary_candidate else True
        reference_valid = primary_candidate.reference_valid if primary_candidate else True
        domain_valid = primary_candidate.domain_valid if primary_candidate else is_valid
        budget_valid = primary_candidate.budget_valid if primary_candidate else True
        schema_errors = primary_candidate.schema_errors if primary_candidate else []
        reference_errors = primary_candidate.reference_errors if primary_candidate else []
        domain_errors = primary_candidate.domain_errors if primary_candidate else []
        budget_errors = primary_candidate.budget_errors if primary_candidate else []
        errors = [e.message for e in primary_candidate.validation_feedback.fatal_errors] if primary_candidate else []
        warnings = [w.message for w in primary_candidate.validation_feedback.advisory_warnings] if primary_candidate else []

        candidates_data = [c.to_dict() for c in candidates]

        # Persist AgentRun with base and candidate snapshots
        run = AgentRun.objects.create(  # pyrefly: ignore[missing-attribute]
            session=session,
            user_prompt=prompt,
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text=ai_response_text,
            proposed_actions=proposed_actions,
            validation_results={
                'is_valid': is_valid,
                'schema_valid': schema_valid,
                'reference_valid': reference_valid,
                'domain_valid': domain_valid,
                'budget_valid': budget_valid,
                'schema_errors': schema_errors,
                'reference_errors': reference_errors,
                'domain_errors': domain_errors,
                'budget_errors': budget_errors,
                'errors': errors,
                'warnings': warnings,
                'budget_diff': budget_diff,
                'candidates': candidates_data,
                'candidates_count': len(candidates),
                'valid_candidates_count': sum(1 for c in candidates if c.is_valid),
                'selected_candidate_id': primary_candidate.id if primary_candidate else None,
                'source_scene_hash': source_scene_hash,
            },
            provider_metadata={
                'provider': getattr(adapter, 'provider_name', 'mock' if not getattr(adapter, 'api_key', None) else 'gemini'),
                'model': getattr(adapter, 'model_name', 'deterministic-mock-v1'),
                'candidates_generated': len(candidates),
                'source_scene_hash': source_scene_hash,
            },
            base_scene_snapshot=current_scene,
            candidate_scene_snapshot=candidate_scene,
        )

        return Response({
            'run': AgentRunSerializer(run).data,
            'candidates': candidates_data,
            'selected_candidate': primary_candidate.to_dict() if primary_candidate else None,
            'source_scene_hash': source_scene_hash,
            'candidate_scene': candidate_scene,
            'budget_diff': budget_diff,
            'schema_valid': schema_valid,
            'reference_valid': reference_valid,
            'domain_valid': domain_valid,
            'budget_valid': budget_valid,
            'requires_approval': True,
        }, status=status.HTTP_200_OK)



class AgentApplyRunView(APIView):
    """
    POST /api/v1/agent/runs/{run_id}/apply/
    Applies the proposed agent actions into the design scene after explicit user approval.
    Executes inside transaction.atomic() with select_for_update() row locks on AgentRun
    and Design to guarantee atomicity and eliminate race conditions on concurrent apply requests.
    Supports selecting an explicit candidate_id from a multi-candidate run.
    Enforces deterministic SHA-256 stale proposal rejection.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, run_id):
        with transaction.atomic():  # pyrefly: ignore[bad-context-manager]
            # Acquire exclusive row lock on the AgentRun record
            run = (
                AgentRun.objects  # pyrefly: ignore[missing-attribute]
                .select_for_update()
                .filter(id=run_id, session__owner=request.user)
                .select_related('session')
                .first()
            )
            if not run:
                return Response(
                    {"detail": "Not found."},
                    status=status.HTTP_404_NOT_FOUND
                )

            # Recheck status after acquiring the row lock
            if run.status != AgentRun.STATUS_PROPOSED:
                return Response(
                    {"detail": f"Agent run is in '{run.status}' state and cannot be applied."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # If the session is attached to a persisted design, acquire exclusive row lock on the Design
            design = None
            if run.session.design_id:
                design = (
                    Design.objects  # pyrefly: ignore[missing-attribute]
                    .select_for_update()
                    .filter(id=run.session.design_id, owner=request.user)
                    .first()
                )
                if not design:
                    return Response(
                        {"detail": "Design not found or access denied."},
                        status=status.HTTP_404_NOT_FOUND
                    )

            # For sessions attached to saved designs, use the authoritative locked saved scene as the apply base.
            if design:
                base_scene = design.scene_json
            else:
                base_scene = run.base_scene_snapshot or {
                    'schemaVersion': 1,
                    'unit': 'm',
                    'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                    'objects': [],
                }

            # Check Stale Proposal Protection: Compare SHA-256 hashes
            current_scene_hash = compute_canonical_scene_hash(base_scene)
            saved_scene_hash = None
            if isinstance(run.validation_results, dict):
                saved_scene_hash = run.validation_results.get('source_scene_hash')
            if not saved_scene_hash and run.base_scene_snapshot is not None:
                saved_scene_hash = compute_canonical_scene_hash(run.base_scene_snapshot)

            if saved_scene_hash and current_scene_hash != saved_scene_hash:
                return Response(
                    {
                        "detail": "The saved design has been modified since this proposal was generated. Proposal is stale.",
                        "code": "stale_proposal",
                        "stale": True,
                        "current_scene_hash": current_scene_hash,
                        "source_scene_hash": saved_scene_hash,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            # Fallback direct equality check against base_scene_snapshot
            if run.base_scene_snapshot is not None and base_scene != run.base_scene_snapshot:
                return Response(
                    {
                        "detail": "The saved design has been modified since this proposal was generated. Proposal is stale.",
                        "code": "stale_proposal",
                        "stale": True,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            # Resolve candidate actions (supporting candidate selection)
            selected_cand_id = request.data.get('candidate_id')
            candidate_actions = run.proposed_actions
            if selected_cand_id and isinstance(run.validation_results, dict):
                candidates_list = run.validation_results.get('candidates', [])
                matched_cand = next((c for c in candidates_list if c.get('id') == selected_cand_id), None)
                if not matched_cand:
                    return Response(
                        {"detail": f"Candidate with id '{selected_cand_id}' not found in this proposal run."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if not matched_cand.get('is_valid', True) or not matched_cand.get('is_approval_eligible', True):
                    return Response(
                        {
                            "detail": "Cannot apply invalid or ineligible candidate.",
                            "errors": matched_cand.get('validation_feedback', {}).get('errors', []),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                candidate_actions = matched_cand.get('proposed_actions', candidate_actions)

            max_budget = design.budget if (design and design.budget) else None
            sim_result = validate_and_simulate_actions(base_scene, candidate_actions, max_budget_paise=max_budget)
            if not sim_result['is_valid']:
                return Response(
                    {"detail": "Cannot apply invalid actions.", "errors": sim_result['errors']},
                    status=status.HTTP_400_BAD_REQUEST
                )


            applied_scene = sim_result['candidate_scene']

            # Validate the final candidate with the canonical scene validator before persisting
            try:
                validate_canonical_scene(applied_scene)
            except serializers.ValidationError as exc:
                return Response(
                    {
                        "detail": "Candidate scene failed canonical scene validation.",
                        "errors": exc.detail,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Persist scene onto associated design if attached within the same transaction
            if design:
                design.scene_json = applied_scene
                design.save(update_fields=['scene_json', 'updated_at'])

            # Transition run to APPROVED atomically within the same transaction
            run.status = AgentRun.STATUS_APPROVED
            run.applied_scene_snapshot = applied_scene
            run.save(update_fields=['status', 'applied_scene_snapshot'])

            return Response({
                'detail': 'Proposal successfully approved and applied to design.',
                'run': AgentRunSerializer(run).data,
                'applied_scene': applied_scene,
                'budget_diff': sim_result['budget_diff'],
            }, status=status.HTTP_200_OK)


class AgentRejectRunView(APIView):
    """
    POST /api/v1/agent/runs/{run_id}/reject/
    Marks a proposed agent run as rejected without modifying any design scene state.
    Executes inside transaction.atomic() with select_for_update() row lock.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, run_id):
        with transaction.atomic():  # pyrefly: ignore[bad-context-manager]
            run = (
                AgentRun.objects  # pyrefly: ignore[missing-attribute]
                .select_for_update()
                .filter(id=run_id, session__owner=request.user)
                .first()
            )
            if not run:
                return Response(
                    {"detail": "Not found."},
                    status=status.HTTP_404_NOT_FOUND
                )

            if run.status != AgentRun.STATUS_PROPOSED:
                return Response(
                    {"detail": f"Agent run is in '{run.status}' state and cannot be rejected."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            run.status = AgentRun.STATUS_REJECTED
            run.save(update_fields=['status'])

            return Response({
                'detail': 'Proposal rejected by user.',
                'run': AgentRunSerializer(run).data,
            }, status=status.HTTP_200_OK)
