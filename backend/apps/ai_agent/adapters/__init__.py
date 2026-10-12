from django.conf import settings
from apps.ai_agent.adapters.base import BaseDesignLLMAdapter, DesignProposalResult
from apps.ai_agent.adapters.mock import MockDesignLLMAdapter
from apps.ai_agent.adapters.gemini import GeminiDesignLLMAdapter


def get_design_llm_adapter() -> BaseDesignLLMAdapter:
    """
    Factory function providing the configured AI adapter.
    Defaults to MockDesignLLMAdapter for local development and automated tests.
    """
    mode = getattr(settings, 'AI_PROVIDER_MODE', 'mock').lower()
    if mode == 'gemini':
        return GeminiDesignLLMAdapter()
    return MockDesignLLMAdapter()


__all__ = [
    'BaseDesignLLMAdapter',
    'DesignProposalResult',
    'MockDesignLLMAdapter',
    'GeminiDesignLLMAdapter',
    'get_design_llm_adapter',
]
