from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class DesignProposalResult:
    text_response: str
    proposed_actions: list[dict[str, Any]] = field(default_factory=list)
    provider: str = 'unknown'
    model: str = 'unknown'
    latency_ms: int = 0
    raw_metadata: dict[str, Any] = field(default_factory=dict)
    candidate_label: str = 'Layout Option'
    description: str = ''
    trade_offs: list[str] = field(default_factory=list)
    intended_relationships: list[dict[str, Any]] = field(default_factory=list)


class BaseDesignLLMAdapter(ABC):
    """
    Abstract interface for interior design LLM providers.
    All model providers (Gemini, Mock, etc.) must implement this interface.
    The frontend NEVER interacts with providers directly.
    """

    @abstractmethod
    def generate_design_proposal(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        conversation_history: list[dict[str, str]] | None = None,
        catalogue_context: list[dict[str, Any]] | None = None,
        spatial_context: dict[str, Any] | None = None,
    ) -> DesignProposalResult:
        """
        Processes user intent in the context of the 3D room scene and catalogue,
        and returns a structured proposal with natural language guidance and typed actions.
        """
        pass

    def generate_candidate_variants(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        candidate_count: int = 3,
        conversation_history: list[dict[str, str]] | None = None,
        catalogue_context: list[dict[str, Any]] | None = None,
        spatial_context: dict[str, Any] | None = None,
        user_requirements: dict[str, Any] | None = None,
        preferences: Any = None,
    ) -> list[DesignProposalResult]:
        """
        Generates multiple distinct candidate layout proposals for the same user request.
        Default implementation calls generate_design_proposal.
        """
        single = self.generate_design_proposal(
            user_prompt=user_prompt,
            current_scene=current_scene,
            conversation_history=conversation_history,
            catalogue_context=catalogue_context,
            spatial_context=spatial_context,
        )
        return [single]

    def refine_candidate_proposal(
        self,
        user_prompt: str,
        current_scene: dict[str, Any],
        failed_proposal: DesignProposalResult,
        validation_feedback: dict[str, Any],
        catalogue_context: list[dict[str, Any]] | None = None,
        spatial_context: dict[str, Any] | None = None,
        attempt: int = 1,
    ) -> DesignProposalResult:
        """
        Attempts to correct a candidate proposal that failed deterministic spatial validation.
        """
        return failed_proposal

