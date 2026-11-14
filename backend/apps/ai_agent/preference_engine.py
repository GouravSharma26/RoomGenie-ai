"""
Preference Interpretation Engine for RoomGenie AI (Phase 7.1).
Normalizes structured selections and natural language instructions into validated,
deterministic design preferences, detects contradictions, and exposes structured feedback.
"""

from dataclasses import dataclass, field
import re
from typing import Any, Dict, List, Optional, Set, Tuple

# Supported Controlled Taxonomies
SUPPORTED_STYLES: Set[str] = {
    'minimalist',
    'modern',
    'contemporary',
    'scandinavian',
    'industrial',
    'traditional',
    'japandi',
    'bohemian',
    'midcentury_modern',
    'luxury',
}

SUPPORTED_COLOURS: Set[str] = {
    'warm_neutrals',
    'cool_neutrals',
    'earth_tones',
    'monochrome',
    'pastel',
    'bold_accents',
    'natural_wood',
}

SUPPORTED_MATERIALS: Set[str] = {
    'wood',
    'metal',
    'glass',
    'fabric',
    'stone',
    'marble',
    'concrete',
    'leather',
}

SUPPORTED_LAYOUTS: Set[str] = {
    'open_space',
    'perimeter',
    'symmetrical',
    'conversation',
    'workspace',
    'max_usable_floor',
    'balanced_distribution',
}

SUPPORTED_FUNCTIONAL_PRIORITIES: Set[str] = {
    'circulation',
    'storage',
    'seating',
    'workspace',
    'natural_light',
    'open_floor_area',
    'accessibility',
    'zoning',
}

# Synonyms & Keyword Mapping for Natural Language Prompts
STYLE_SYNONYMS: Dict[str, str] = {
    'minimalist': 'minimalist',
    'minimal': 'minimalist',
    'minimalism': 'minimalist',
    'modern': 'modern',
    'contemporary': 'contemporary',
    'scandinavian': 'scandinavian',
    'scandi': 'scandinavian',
    'nordic': 'scandinavian',
    'industrial': 'industrial',
    'loft': 'industrial',
    'traditional': 'traditional',
    'classic': 'traditional',
    'japandi': 'japandi',
    'zen': 'japandi',
    'bohemian': 'bohemian',
    'boho': 'bohemian',
    'midcentury': 'midcentury_modern',
    'mid-century': 'midcentury_modern',
    'luxury': 'luxury',
    'luxurious': 'luxury',
}

COLOUR_SYNONYMS: Dict[str, str] = {
    'warm neutral': 'warm_neutrals',
    'warm neutrals': 'warm_neutrals',
    'warm colors': 'warm_neutrals',
    'beige': 'warm_neutrals',
    'cream': 'warm_neutrals',
    'cool neutral': 'cool_neutrals',
    'cool neutrals': 'cool_neutrals',
    'grey': 'cool_neutrals',
    'gray': 'cool_neutrals',
    'earth tone': 'earth_tones',
    'earth tones': 'earth_tones',
    'terracotta': 'earth_tones',
    'olive': 'earth_tones',
    'monochrome': 'monochrome',
    'black and white': 'monochrome',
    'pastel': 'pastel',
    'soft colors': 'pastel',
    'bold accent': 'bold_accents',
    'bold accents': 'bold_accents',
    'vibrant': 'bold_accents',
    'natural wood': 'natural_wood',
    'wood tones': 'natural_wood',
}

MATERIAL_SYNONYMS: Dict[str, str] = {
    'wood': 'wood',
    'wooden': 'wood',
    'timber': 'wood',
    'oak': 'wood',
    'walnut': 'wood',
    'pine': 'wood',
    'metal': 'metal',
    'metallic': 'metal',
    'steel': 'metal',
    'iron': 'metal',
    'glass': 'glass',
    'fabric': 'fabric',
    'textile': 'fabric',
    'linen': 'fabric',
    'stone': 'stone',
    'marble': 'marble',
    'concrete': 'concrete',
    'leather': 'leather',
}

LAYOUT_SYNONYMS: Dict[str, str] = {
    'open space': 'open_space',
    'open layout': 'open_space',
    'spacious': 'open_space',
    'roomy': 'open_space',
    'perimeter': 'perimeter',
    'along the walls': 'perimeter',
    'around the walls': 'perimeter',
    'against the wall': 'perimeter',
    'symmetry': 'symmetrical',
    'symmetrical': 'symmetrical',
    'conversation': 'conversation',
    'conversational': 'conversation',
    'social': 'conversation',
    'workspace': 'workspace',
    'study': 'workspace',
    'workstation': 'workspace',
    'max usable floor': 'max_usable_floor',
    'maximum floor': 'max_usable_floor',
    'balanced': 'balanced_distribution',
}

PRIORITY_SYNONYMS: Dict[str, str] = {
    'circulation': 'circulation',
    'walking': 'circulation',
    'walkway': 'circulation',
    'traffic': 'circulation',
    'storage': 'storage',
    'organization': 'storage',
    'shelving': 'storage',
    'seating': 'seating',
    'chairs': 'seating',
    'sofa': 'seating',
    'workspace': 'workspace',
    'desk': 'workspace',
    'natural light': 'natural_light',
    'daylight': 'natural_light',
    'window view': 'natural_light',
    'open floor area': 'open_floor_area',
    'clear floor': 'open_floor_area',
    'accessibility': 'accessibility',
    'zoning': 'zoning',
    'division': 'zoning',
}


@dataclass
class NormalizedDesignPreferences:
    """
    Standardized, validated preference representation for spatial candidate generation and scoring.
    """
    schema_version: int = 1
    style_preferences: List[str] = field(default_factory=list)
    primary_style: Optional[str] = None
    colour_preferences: List[str] = field(default_factory=list)
    material_preferences: List[str] = field(default_factory=list)
    layout_preferences: List[str] = field(default_factory=list)
    functional_priorities: List[str] = field(default_factory=list)
    budget_ceiling_paise: Optional[int] = None
    preferred_categories: List[str] = field(default_factory=list)
    disliked_categories: List[str] = field(default_factory=list)
    preserve_all_existing: bool = False
    preserve_object_ids: List[str] = field(default_factory=list)
    preference_weights: Dict[str, float] = field(default_factory=lambda: {
        'style': 1.0,
        'colour': 0.8,
        'material': 0.8,
        'layout': 1.0,
        'functional_priorities': 1.0,
        'furniture': 0.8,
        'preservation': 1.2,
    })
    detected_conflicts: List[str] = field(default_factory=list)
    unrecognized_preferences: List[str] = field(default_factory=list)
    has_meaningful_preferences: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            'schema_version': self.schema_version,
            'style_preferences': self.style_preferences,
            'styles': self.style_preferences,
            'primary_style': self.primary_style,
            'colour_preferences': self.colour_preferences,
            'colours': self.colour_preferences,
            'material_preferences': self.material_preferences,
            'materials': self.material_preferences,
            'layout_preferences': self.layout_preferences,
            'layouts': self.layout_preferences,
            'functional_priorities': self.functional_priorities,
            'priorities': self.functional_priorities,
            'budget_ceiling_paise': self.budget_ceiling_paise,
            'preferred_categories': self.preferred_categories,
            'disliked_categories': self.disliked_categories,
            'preserve_all_existing': self.preserve_all_existing,
            'preserve_object_ids': self.preserve_object_ids,
            'preference_weights': self.preference_weights,
            'detected_conflicts': self.detected_conflicts,
            'unrecognized_preferences': self.unrecognized_preferences,
            'has_meaningful_preferences': self.has_meaningful_preferences,
        }


def parse_prompt_for_preferences(prompt: str) -> Dict[str, Any]:
    """
    Extracts explicit preference signals from natural-language instructions.
    Does not guess or infer private user traits.
    """
    if not prompt or not isinstance(prompt, str):
        return {}

    prompt_lower = prompt.lower()
    styles: List[str] = []
    colours: List[str] = []
    materials: List[str] = []
    layouts: List[str] = []
    priorities: List[str] = []
    preserve_ids: List[str] = []
    preserve_all = False
    budget_paise: Optional[int] = None

    # Style matching
    for phrase, canonical in STYLE_SYNONYMS.items():
        if re.search(r'\b' + re.escape(phrase) + r'\b', prompt_lower):
            if canonical not in styles:
                styles.append(canonical)

    # Colour matching
    for phrase, canonical in COLOUR_SYNONYMS.items():
        if re.search(r'\b' + re.escape(phrase) + r'\b', prompt_lower):
            if canonical not in colours:
                colours.append(canonical)

    # Material matching
    for phrase, canonical in MATERIAL_SYNONYMS.items():
        if re.search(r'\b' + re.escape(phrase) + r'\b', prompt_lower):
            if canonical not in materials:
                materials.append(canonical)

    # Layout matching
    for phrase, canonical in LAYOUT_SYNONYMS.items():
        if re.search(r'\b' + re.escape(phrase) + r'\b', prompt_lower):
            if canonical not in layouts:
                layouts.append(canonical)

    # Priority matching
    for phrase, canonical in PRIORITY_SYNONYMS.items():
        if re.search(r'\b' + re.escape(phrase) + r'\b', prompt_lower):
            if canonical not in priorities:
                priorities.append(canonical)

    # Preservation matching
    if any(k in prompt_lower for k in ('preserve all', 'keep everything', 'keep all existing', 'retain everything')):
        preserve_all = True
    elif any(k in prompt_lower for k in ('keep the', 'preserve the', 'retain the', 'keep existing', 'preserve existing')):
        # Check specific items mentioned
        if 'sofa' in prompt_lower or 'couch' in prompt_lower:
            preserve_ids.append('sofa')
        if 'desk' in prompt_lower or 'table' in prompt_lower:
            preserve_ids.append('desk')
        if 'bed' in prompt_lower:
            preserve_ids.append('bed')

    # Budget extraction (e.g. "under 50000", "budget of 40000 rupees", "within 30000")
    budget_match = re.search(r'(?:under|within|budget of|ceiling of)\s*(?:rs\.?|inr|₹)?\s*(\d+[\d,]*)\s*(?:rupees|rs)?', prompt_lower)
    if budget_match:
        try:
            num_str = budget_match.group(1).replace(',', '')
            budget_rupees = int(num_str)
            budget_paise = budget_rupees * 100
        except ValueError:
            pass

    return {
        'styles': styles,
        'colours': colours,
        'materials': materials,
        'layouts': layouts,
        'priorities': priorities,
        'preserve_all': preserve_all,
        'preserve_ids': preserve_ids,
        'budget_paise': budget_paise,
    }


def normalize_preferences(
    structured_preferences: Optional[Dict[str, Any]] = None,
    prompt_instruction: Optional[str] = None,
    existing_scene_objects: Optional[List[Dict[str, Any]]] = None,
) -> NormalizedDesignPreferences:
    """
    Merges structured UI preferences with explicit prompt instructions,
    validates values against controlled taxonomies, and identifies contradictions.
    Structured selections take precedence over prompt mentions.
    """
    raw_sp = structured_preferences if isinstance(structured_preferences, dict) else {}
    prompt_signals = parse_prompt_for_preferences(prompt_instruction or "")

    # 1. Styles
    styles: List[str] = []
    unrecognized: List[str] = []
    raw_styles = raw_sp.get('style_preferences') or raw_sp.get('styles') or []
    if isinstance(raw_styles, list):
        for s in raw_styles:
            s_clean = str(s).lower().strip().replace('-', '_')
            if s_clean in SUPPORTED_STYLES:
                if s_clean not in styles:
                    styles.append(s_clean)
            elif s:
                unrecognized.append(f"Style '{s}' is unsupported.")
    if not styles:
        for s in prompt_signals.get('styles', []):
            if s not in styles:
                styles.append(s)

    primary_style = raw_sp.get('primary_style') or (styles[0] if styles else None)
    if primary_style and str(primary_style).lower().strip() in SUPPORTED_STYLES:
        primary_style = str(primary_style).lower().strip()
    else:
        primary_style = styles[0] if styles else None

    # 2. Colours
    colours: List[str] = []
    raw_colours = raw_sp.get('colour_preferences') or raw_sp.get('colours') or []
    if isinstance(raw_colours, list):
        for c in raw_colours:
            c_clean = str(c).lower().strip().replace('-', '_')
            if c_clean in SUPPORTED_COLOURS:
                if c_clean not in colours:
                    colours.append(c_clean)
            elif c:
                unrecognized.append(f"Colour '{c}' is unsupported.")
    if not colours:
        for c in prompt_signals.get('colours', []):
            if c not in colours:
                colours.append(c)

    # 3. Materials
    materials: List[str] = []
    raw_materials = raw_sp.get('material_preferences') or raw_sp.get('materials') or []
    if isinstance(raw_materials, list):
        for m in raw_materials:
            m_clean = str(m).lower().strip().replace('-', '_')
            if m_clean in SUPPORTED_MATERIALS:
                if m_clean not in materials:
                    materials.append(m_clean)
            elif m:
                unrecognized.append(f"Material '{m}' is unsupported.")
    if not materials:
        for m in prompt_signals.get('materials', []):
            if m not in materials:
                materials.append(m)

    # 4. Layout
    layouts: List[str] = []
    raw_layouts = raw_sp.get('layout_preferences') or raw_sp.get('layouts') or []
    if isinstance(raw_layouts, list):
        for l in raw_layouts:
            l_clean = str(l).lower().strip().replace('-', '_')
            if l_clean in SUPPORTED_LAYOUTS:
                if l_clean not in layouts:
                    layouts.append(l_clean)
            elif l:
                unrecognized.append(f"Layout '{l}' is unsupported.")
    if not layouts:
        for l in prompt_signals.get('layouts', []):
            if l not in layouts:
                layouts.append(l)

    # 5. Functional Priorities
    priorities: List[str] = []
    raw_priorities = raw_sp.get('functional_priorities') or raw_sp.get('priorities') or []
    if isinstance(raw_priorities, list):
        for p in raw_priorities:
            p_clean = str(p).lower().strip().replace('-', '_')
            if p_clean in SUPPORTED_FUNCTIONAL_PRIORITIES:
                if p_clean not in priorities:
                    priorities.append(p_clean)
            elif p:
                unrecognized.append(f"Priority '{p}' is unsupported.")
    if not priorities:
        for p in prompt_signals.get('priorities', []):
            if p not in priorities:
                priorities.append(p)

    # 6. Budget
    budget_ceiling = raw_sp.get('budget_preferences', {}).get('max_budget_paise')
    if budget_ceiling is None:
        budget_ceiling = raw_sp.get('budget_ceiling_paise')
    if budget_ceiling is None:
        budget_ceiling = prompt_signals.get('budget_paise')

    # 7. Furniture Preferences
    furniture_pref = raw_sp.get('furniture_preferences', {})
    preferred_categories = furniture_pref.get('preferred_categories', [])
    disliked_categories = furniture_pref.get('disliked_categories', [])

    # 8. Preservation Preferences
    preservation_pref = raw_sp.get('preservation_preferences', {})
    preserve_all = bool(preservation_pref.get('preserve_all_existing', raw_sp.get('preserve_all_existing', prompt_signals.get('preserve_all', False))))
    preserve_ids = list(preservation_pref.get('preserve_object_ids') or raw_sp.get('preserve_object_ids') or [])

    # Match prompt preservation items with existing scene objects
    if existing_scene_objects and prompt_signals.get('preserve_ids'):
        for sig in prompt_signals['preserve_ids']:
            for obj in existing_scene_objects:
                obj_name = str(obj.get('name', '')).lower()
                obj_cat = str(obj.get('category', '')).lower()
                obj_id = str(obj.get('id', ''))
                if sig in obj_name or sig in obj_cat or sig in obj_id:
                    if obj_id not in preserve_ids:
                        preserve_ids.append(obj_id)

    # 9. Contradiction Detection
    conflicts: List[str] = []

    # Conflict A: Maximum open floor vs storage/dense seating
    if 'max_usable_floor' in layouts or 'open_space' in layouts:
        if 'storage' in priorities:
            conflicts.append("Contradiction: 'open_space' layout priority conflicts with heavy 'storage' requirement.")

    # Conflict B: Perimeter arrangement vs Conversation-focused arrangement
    if 'perimeter' in layouts and 'conversation' in layouts:
        conflicts.append("Contradiction: 'perimeter' layout (along walls) directly conflicts with 'conversation' seating (central focal grouping).")

    # Conflict C: Preservation of item vs explicit instruction to remove it
    if prompt_instruction and preserve_ids:
        p_lower = prompt_instruction.lower()
        if 'remove' in p_lower or 'delete' in p_lower or 'clear' in p_lower:
            for pid in preserve_ids:
                if pid in p_lower:
                    conflicts.append(f"Contradiction: Request explicitly commands removal of preserved item '{pid}'.")

    # Conflict D: Preferred and disliked categories overlap
    overlap = set(preferred_categories).intersection(set(disliked_categories))
    if overlap:
        conflicts.append(f"Contradiction: Category '{', '.join(overlap)}' is marked as both preferred and disliked.")

    # 10. Weights validation
    raw_weights = raw_sp.get('preference_weights', {})
    weights: Dict[str, float] = {
        'style': 1.0,
        'colour': 0.8,
        'material': 0.8,
        'layout': 1.0,
        'functional_priorities': 1.0,
        'furniture': 0.8,
        'preservation': 1.2,
    }
    if isinstance(raw_weights, dict):
        for k, v in raw_weights.items():
            if k in weights:
                try:
                    f_val = float(v)
                    # Clamp weight between [0.1, 3.0]
                    weights[k] = max(0.1, min(f_val, 3.0))
                except (ValueError, TypeError):
                    pass

    has_meaningful = bool(
        styles or colours or materials or layouts or priorities or
        budget_ceiling is not None or preferred_categories or
        preserve_all or preserve_ids
    )

    return NormalizedDesignPreferences(
        schema_version=1,
        style_preferences=styles,
        primary_style=primary_style,
        colour_preferences=colours,
        material_preferences=materials,
        layout_preferences=layouts,
        functional_priorities=priorities,
        budget_ceiling_paise=budget_ceiling,
        preferred_categories=preferred_categories,
        disliked_categories=disliked_categories,
        preserve_all_existing=preserve_all,
        preserve_object_ids=preserve_ids,
        preference_weights=weights,
        detected_conflicts=conflicts,
        unrecognized_preferences=unrecognized,
        has_meaningful_preferences=has_meaningful,
    )
