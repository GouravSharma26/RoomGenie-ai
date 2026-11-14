/**
 * Design Preferences Architecture for RoomGenie AI (Phase 7.1).
 * Strictly typed versioned preference model and controlled taxonomies.
 */

export type InteriorStyle =
  | 'minimalist'
  | 'modern'
  | 'contemporary'
  | 'scandinavian'
  | 'industrial'
  | 'traditional'
  | 'japandi'
  | 'bohemian'
  | 'midcentury_modern'
  | 'luxury';

export type ColourPreference =
  | 'warm_neutrals'
  | 'cool_neutrals'
  | 'earth_tones'
  | 'monochrome'
  | 'pastel'
  | 'bold_accents'
  | 'natural_wood';

export type MaterialPreference =
  | 'wood'
  | 'metal'
  | 'glass'
  | 'fabric'
  | 'stone'
  | 'marble'
  | 'concrete'
  | 'leather';

export type LayoutPreference =
  | 'open_space'
  | 'perimeter'
  | 'symmetrical'
  | 'conversation'
  | 'workspace'
  | 'max_usable_floor'
  | 'balanced_distribution';

export type FunctionalPriority =
  | 'circulation'
  | 'storage'
  | 'seating'
  | 'workspace'
  | 'natural_light'
  | 'open_floor_area'
  | 'accessibility'
  | 'zoning';

export interface BudgetPreference {
  max_budget_paise?: number | null;
  currency?: string;
}

export interface FurniturePreference {
  preferred_categories?: string[];
  disliked_categories?: string[];
}

export interface PreservationPreference {
  preserve_all_existing?: boolean;
  preserve_object_ids?: string[];
}

export interface DesignPreferences {
  id?: string;
  schema_version?: number;
  style_preferences?: InteriorStyle[];
  primary_style?: InteriorStyle | '';
  colour_preferences?: ColourPreference[];
  material_preferences?: MaterialPreference[];
  layout_preferences?: LayoutPreference[];
  functional_priorities?: FunctionalPriority[];
  budget_preferences?: BudgetPreference;
  furniture_preferences?: FurniturePreference;
  preservation_preferences?: PreservationPreference;
  preference_weights?: Record<string, number>;
  created_at?: string;
  updated_at?: string;
}

export interface PreferencesFeedback {
  interpreted_preferences: DesignPreferences;
  detected_conflicts: string[];
  unrecognized_preferences: string[];
  source: 'request' | 'saved' | 'prompt_only';
  has_meaningful_preferences: boolean;
}

export const PREFERENCE_TAXONOMY_LABELS = {
  styles: {
    minimalist: 'Minimalist',
    modern: 'Modern',
    contemporary: 'Contemporary',
    scandinavian: 'Scandinavian',
    industrial: 'Industrial',
    traditional: 'Traditional',
    japandi: 'Japandi',
    bohemian: 'Bohemian',
    midcentury_modern: 'Mid-Century',
    luxury: 'Luxury',
  },
  colours: {
    warm_neutrals: 'Warm Neutrals (Beige/Cream)',
    cool_neutrals: 'Cool Neutrals (Grey/Slate)',
    earth_tones: 'Earth Tones (Terracotta/Olive)',
    monochrome: 'Monochrome (Black & White)',
    pastel: 'Pastels (Soft Tones)',
    bold_accents: 'Bold Accents',
    natural_wood: 'Natural Wood Tones',
  },
  materials: {
    wood: 'Natural Wood',
    metal: 'Steel & Metal',
    glass: 'Glass',
    fabric: 'Textiles & Linen',
    stone: 'Natural Stone',
    marble: 'Polished Marble',
    concrete: 'Architectural Concrete',
    leather: 'Leather',
  },
  layouts: {
    open_space: 'Open & Spacious Floor',
    perimeter: 'Perimeter Wall Placement',
    symmetrical: 'Symmetrical Arrangement',
    conversation: 'Conversational Seating',
    workspace: 'Workspace-Focused Nook',
    max_usable_floor: 'Max Usable Floor Area',
    balanced_distribution: 'Balanced Distribution',
  },
  priorities: {
    circulation: 'High Walking Clearance',
    storage: 'Ample Storage & Shelving',
    seating: 'Maximum Seating Capacity',
    workspace: 'Dedicated Study/Work Area',
    natural_light: 'Unobstructed Window Daylight',
    open_floor_area: 'Clear Center Floor Area',
    accessibility: 'Easy Furniture Access',
    zoning: 'Clear Functional Room Division',
  },
} as const;
