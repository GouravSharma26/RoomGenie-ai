from rest_framework import exceptions, permissions, serializers, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db import transaction
from django.shortcuts import get_object_or_404
from apps.ai_agent.models import AgentSession, AgentRun, UserDesignPreference
from apps.ai_agent.serializers import (
    AgentSessionSerializer,
    AgentRunSerializer,
    AgentPromptRequestSerializer,
    UserDesignPreferenceSerializer,
)
from apps.ai_agent.adapters import get_design_llm_adapter
from apps.ai_agent.tools import validate_and_simulate_actions
from apps.ai_agent.candidate_types import compute_canonical_scene_hash
from apps.ai_agent.candidate_generator import CandidateGenerator
from apps.ai_agent.preference_engine import normalize_preferences
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

        # Phase 7.1: Resolve structured preferences (request override > saved profile > prompt signals)
        raw_preferences = serializer.validated_data.get('preferences')
        saved_pref = UserDesignPreference.objects.filter(owner=request.user).first()
        pref_dict = raw_preferences
        pref_source = 'request' if raw_preferences else ('saved' if saved_pref else 'prompt_only')
        if not pref_dict and saved_pref:
            pref_dict = {
                'style_preferences': saved_pref.style_preferences,
                'primary_style': saved_pref.primary_style,
                'colour_preferences': saved_pref.colour_preferences,
                'material_preferences': saved_pref.material_preferences,
                'layout_preferences': saved_pref.layout_preferences,
                'functional_priorities': saved_pref.functional_priorities,
                'budget_preferences': saved_pref.budget_preferences,
                'furniture_preferences': saved_pref.furniture_preferences,
                'preservation_preferences': saved_pref.preservation_preferences,
                'preference_weights': saved_pref.preference_weights,
            }

        norm_prefs = normalize_preferences(
            structured_preferences=pref_dict,
            prompt_instruction=prompt,
            existing_scene_objects=current_scene.get('objects', []),
        )

        # Phase 7.3: Blend active learned preference adjustments into preferences
        try:
            from apps.ai_agent.feedback import FeedbackRepository, PreferenceLearningEngine
            learned_state = FeedbackRepository.get_learned_preference_state(request.user)
            if learned_state.is_active and learned_state.adjusted_weights:
                blended_pref_dict = PreferenceLearningEngine.apply_learned_weights_to_preferences(
                    base_preferences=pref_dict or {},
                    learned_state=learned_state,
                )
                norm_prefs = normalize_preferences(
                    structured_preferences=blended_pref_dict,
                    prompt_instruction=prompt,
                    existing_scene_objects=current_scene.get('objects', []),
                )
        except Exception as ex:
            import logging
            logging.getLogger(__name__).warning("Could not apply learned preferences: %s", ex)

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
            preferences=norm_prefs,
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
            'preferences_feedback': {
                'interpreted_preferences': norm_prefs.to_dict(),
                'applied_preferences': norm_prefs.to_dict(),
                'detected_conflicts': norm_prefs.detected_conflicts,
                'unrecognized_preferences': norm_prefs.unrecognized_preferences,
                'source': pref_source,
                'has_meaningful_preferences': norm_prefs.has_meaningful_preferences,
            },
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


class UserDesignPreferenceView(APIView):
    """
    GET, POST, PUT, DELETE /api/v1/agent/preferences/
    Manages persistent user design preferences (Phase 7.1).
    Strictly isolated by user ownership: users can only view, update, or delete
    their own preferences.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        pref, _ = UserDesignPreference.objects.get_or_create(owner=request.user)
        serializer = UserDesignPreferenceSerializer(pref)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        return self._save_preferences(request)

    def put(self, request):
        return self._save_preferences(request)

    def delete(self, request):
        pref = UserDesignPreference.objects.filter(owner=request.user).first()
        if pref:
            pref.delete()
            return Response(
                {"detail": "User design preferences have been reset."},
                status=status.HTTP_200_OK
            )
        return Response({"detail": "No saved preferences found."}, status=status.HTTP_200_OK)

    def _save_preferences(self, request):
        pref, _ = UserDesignPreference.objects.get_or_create(owner=request.user)
        serializer = UserDesignPreferenceSerializer(pref, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)


# =============================================================================
# Phase 7.3: Explainable, Feedback-Driven Spatial Design Refinement Views
# =============================================================================

from apps.ai_agent.candidate_types import LayoutCandidate
from apps.ai_agent.feedback.feedback_service import FeedbackService


class CandidateFeedbackView(APIView):
    """
    POST /api/v1/agent/feedback/
    Records explicit user feedback (selected, liked, disliked, rejected, modified)
    for a generated layout candidate, updating learned preference weights.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        data = request.data
        run_id = data.get('run_id')
        candidate_id = data.get('candidate_id')
        feedback_type = data.get('feedback_type')

        if not run_id or not candidate_id or not feedback_type:
            return Response(
                {"detail": "Missing required fields: run_id, candidate_id, feedback_type."},
                status=status.HTTP_400_BAD_REQUEST
            )

        run = get_object_or_404(AgentRun, id=run_id, session__owner=request.user)

        service = FeedbackService()
        result = service.submit_candidate_feedback(
            user=request.user,
            run=run,
            candidate_id=candidate_id,
            feedback_type=feedback_type,
            structured_reasons=data.get('structured_reasons', []),
            feedback_text=data.get('feedback_text', ''),
            candidate_score=float(data.get('candidate_score', 0.0)),
            candidate_label=data.get('candidate_label', ''),
        )
        return Response(result, status=status.HTTP_201_CREATED)


class PairwiseComparisonView(APIView):
    """
    POST /api/v1/agent/feedback/compare/
    Records structured pairwise comparisons between two candidates.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        data = request.data
        run_id = data.get('run_id')
        candidate_a_id = data.get('candidate_a_id')
        candidate_b_id = data.get('candidate_b_id')
        outcome = data.get('outcome')

        if not run_id or not candidate_a_id or not candidate_b_id or not outcome:
            return Response(
                {"detail": "Missing required fields: run_id, candidate_a_id, candidate_b_id, outcome."},
                status=status.HTTP_400_BAD_REQUEST
            )

        run = get_object_or_404(AgentRun, id=run_id, session__owner=request.user)

        service = FeedbackService()
        result = service.submit_pairwise_comparison(
            user=request.user,
            run=run,
            candidate_a_id=candidate_a_id,
            candidate_b_id=candidate_b_id,
            outcome=outcome,
            structured_reasons=data.get('structured_reasons', []),
            comparison_text=data.get('comparison_text', ''),
        )
        return Response(result, status=status.HTTP_201_CREATED)


class LearnedPreferencesView(APIView):
    """
    GET /api/v1/agent/feedback/learned-preferences/
    Returns the user's active learned preference weights, explanations, and evidence count.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        service = FeedbackService()
        result = service.get_user_learned_preferences(request.user)
        return Response(result, status=status.HTTP_200_OK)


class ResetLearnedPreferencesView(APIView):
    """
    POST /api/v1/agent/feedback/learned-preferences/reset/
    Explicitly resets learned preference adjustments back to baseline.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        service = FeedbackService()
        result = service.reset_user_learned_preferences(request.user)
        return Response(result, status=status.HTTP_200_OK)


class CandidateExplainView(APIView):
    """
    GET /api/v1/agent/runs/{run_id}/candidates/{candidate_id}/explain/
    Returns evidence-based explanations for a specific candidate.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, run_id, candidate_id):
        run = get_object_or_404(AgentRun, id=run_id, session__owner=request.user)
        candidates_data = run.validation_results.get('candidates', [])

        cand_dict = None
        cand_rank = 1
        for idx, c in enumerate(candidates_data):
            if c.get('id') == candidate_id:
                cand_dict = c
                cand_rank = idx + 1
                break

        if not cand_dict:
            return Response(
                {"detail": f"Candidate '{candidate_id}' not found in run {run_id}."},
                status=status.HTTP_404_NOT_FOUND
            )

        candidate = LayoutCandidate.from_dict(cand_dict)
        initial_scene = run.session.design.scene_json if run.session.design else None

        service = FeedbackService()
        explanation = service.get_candidate_explanation(
            candidate=candidate,
            rank=cand_rank,
            total_candidates=len(candidates_data),
            initial_scene=initial_scene,
        )
        return Response(explanation, status=status.HTTP_200_OK)


class CandidateCompareDetailedView(APIView):
    """
    POST /api/v1/agent/runs/{run_id}/candidates/compare-detailed/
    Computes exact side-by-side spatial displacements, asset selection differences,
    and objective deltas between two candidates.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, run_id):
        cand_a_id = request.data.get('candidate_a_id')
        cand_b_id = request.data.get('candidate_b_id')

        if not cand_a_id or not cand_b_id:
            return Response(
                {"detail": "Both candidate_a_id and candidate_b_id are required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        run = get_object_or_404(AgentRun, id=run_id, session__owner=request.user)
        candidates_data = run.validation_results.get('candidates', [])
        cands_by_id = {c.get('id'): c for c in candidates_data}

        if cand_a_id not in cands_by_id or cand_b_id not in cands_by_id:
            return Response(
                {"detail": "One or both specified candidate IDs could not be found in this run."},
                status=status.HTTP_404_NOT_FOUND
            )

        cand_a = LayoutCandidate.from_dict(cands_by_id[cand_a_id])
        cand_b = LayoutCandidate.from_dict(cands_by_id[cand_b_id])

        service = FeedbackService()
        detail = service.compare_candidates(cand_a, cand_b)
        return Response(detail, status=status.HTTP_200_OK)


class CandidateRefineView(APIView):
    """
    POST /api/v1/agent/runs/{run_id}/candidates/{candidate_id}/refine/
    Refines an existing candidate layout based on a natural language instruction.
    Preserves protected items, canonical scene immutability, and hard spatial validity.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, run_id, candidate_id):
        instruction = request.data.get('instruction', '').strip()
        if not instruction:
            return Response(
                {"detail": "Instruction is required for layout refinement."},
                status=status.HTTP_400_BAD_REQUEST
            )

        run = get_object_or_404(AgentRun, id=run_id, session__owner=request.user)
        candidates_data = run.validation_results.get('candidates', [])
        cands_by_id = {c.get('id'): c for c in candidates_data}

        if candidate_id not in cands_by_id:
            return Response(
                {"detail": f"Candidate '{candidate_id}' not found in run {run_id}."},
                status=status.HTTP_404_NOT_FOUND
            )

        base_candidate = LayoutCandidate.from_dict(cands_by_id[candidate_id])
        service = FeedbackService()

        # 1. Interpret instruction into typed request
        ref_req = service.interpret_refinement_instruction(instruction, base_candidate.candidate_scene)

        # 2. Check ambiguity
        if ref_req.is_ambiguous:
            return Response({
                'is_ambiguous': True,
                'ambiguity_reason': ref_req.ambiguity_reason,
                'refinement_request': ref_req.to_dict(),
                'clarification_prompt': ref_req.ambiguity_reason,
                'refined_candidates': [],
            }, status=status.HTTP_200_OK)

        # 3. Execute refinement runner
        refined_cands = service.execute_refinement(
            base_candidate=base_candidate,
            refinement_request=ref_req,
        )

        # Return serialized results without mutating persisted scene
        return Response({
            'is_ambiguous': False,
            'base_candidate_id': base_candidate.id,
            'refinement_request': ref_req.to_dict(),
            'refined_candidates': [c.to_dict() for c in refined_cands],
            'count': len(refined_cands),
        }, status=status.HTTP_200_OK)

