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
    ) -> DesignProposalResult:
        """
        Processes user intent in the context of the 3D room scene and catalogue,
        and returns a structured proposal with natural language guidance and typed actions.
        """
        pass
