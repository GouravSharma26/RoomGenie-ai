from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404
from apps.ai_agent.models import AgentSession, AgentRun
from apps.ai_agent.serializers import (
    AgentSessionSerializer,
    AgentRunSerializer,
    AgentPromptRequestSerializer,
)
from apps.ai_agent.adapters import get_design_llm_adapter
from apps.ai_agent.tools import validate_and_simulate_actions
from apps.furniture.models import FurnitureAsset


class AgentSessionViewSet(viewsets.ModelViewSet):
    """
    CRUD viewset for persistent AI interior design sessions.
    Strictly isolated by user ownership: users can never access sessions of other users.
    """
    serializer_class = AgentSessionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return AgentSession.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
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

        # Determine current scene context
        if client_scene and isinstance(client_scene, dict) and 'room' in client_scene:
            current_scene = client_scene
        elif session.design and session.design.scene_json:
            current_scene = session.design.scene_json
        else:
            current_scene = {
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [],
            }

        # Catalogue context summary for model
        catalogue_items = list(
            FurnitureAsset.objects.filter(is_active=True).values(
                'id', 'name', 'category', 'width', 'height', 'depth', 'price_paise'
            )
        )

        # Build conversation history
        history = [
            {'role': 'user' if i % 2 == 0 else 'assistant', 'content': r.user_prompt if i % 2 == 0 else r.ai_response_text}
            for i, r in enumerate(session.runs.order_by('created_at')[:6])
        ]

        # Call adapter
        adapter = get_design_llm_adapter()
        proposal = adapter.generate_design_proposal(
            user_prompt=prompt,
            current_scene=current_scene,
            conversation_history=history,
            catalogue_context=catalogue_items,
        )

        # Deterministically simulate and validate proposed actions
        sim_result = validate_and_simulate_actions(current_scene, proposal.proposed_actions)

        # Persist AgentRun
        run = AgentRun.objects.create(
            session=session,
            user_prompt=prompt,
            status=AgentRun.STATUS_PROPOSED,
            ai_response_text=proposal.text_response,
            proposed_actions=proposal.proposed_actions,
            validation_results={
                'is_valid': sim_result['is_valid'],
                'errors': sim_result['errors'],
                'warnings': sim_result['warnings'],
                'budget_diff': sim_result['budget_diff'],
            },
            provider_metadata={
                'provider': proposal.provider,
                'model': proposal.model,
                'latency_ms': proposal.latency_ms,
                'raw_metadata': proposal.raw_metadata,
            },
        )

        return Response({
            'run': AgentRunSerializer(run).data,
            'candidate_scene': sim_result['candidate_scene'],
            'budget_diff': sim_result['budget_diff'],
            'requires_approval': True,
        }, status=status.HTTP_200_OK)


class AgentApplyRunView(APIView):
    """
    POST /api/v1/agent/runs/{run_id}/apply/
    Applies the proposed agent actions into the design scene after explicit user approval.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, run_id):
        run = get_object_or_404(AgentRun, id=run_id, session__owner=request.user)

        if run.status != AgentRun.STATUS_PROPOSED:
            return Response(
                {"detail": f"Agent run is in '{run.status}' state and cannot be applied."},
                status=status.HTTP_400_BAD_REQUEST
            )

        client_scene = request.data.get('scene_json')
        if client_scene and isinstance(client_scene, dict) and 'room' in client_scene:
            base_scene = client_scene
        elif run.session.design and run.session.design.scene_json:
            base_scene = run.session.design.scene_json
        else:
            base_scene = {
                'schemaVersion': 1,
                'unit': 'm',
                'room': {'width': 5.0, 'length': 4.0, 'height': 2.8},
                'objects': [],
            }

        sim_result = validate_and_simulate_actions(base_scene, run.proposed_actions)
        if not sim_result['is_valid']:
            return Response(
                {"detail": "Cannot apply invalid actions.", "errors": sim_result['errors']},
                status=status.HTTP_400_BAD_REQUEST
            )

        applied_scene = sim_result['candidate_scene']

        # Persist scene onto associated design if attached
        if run.session.design:
            run.session.design.scene_json = applied_scene
            run.session.design.save(update_fields=['scene_json', 'updated_at'])

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
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, run_id):
        run = get_object_or_404(AgentRun, id=run_id, session__owner=request.user)

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
