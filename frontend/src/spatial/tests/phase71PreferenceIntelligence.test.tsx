import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreferenceSettingsModal } from '../../components/editor/PreferenceSettingsModal';
import * as agentApi from '../../services/agentApi';
import { setAuthToken } from '../../services/designApi';
import type { DesignPreferences } from '../../types/preferenceTypes';
import type { CanonicalScene } from '../../types/scene';

describe('Phase 7.1: Preference-Aware Design Intelligence Frontend Tests', () => {
  const mockScene: CanonicalScene = {
    schemaVersion: 1,
    unit: 'm',
    room: { width: 5, length: 4, height: 2.8 },
    objects: [
      {
        id: 'sofa-anchor-01',
        name: 'Modern 3-Seater Sofa',
        assetId: 'sofa-modern-3seater',
        dimensions: [2.1, 0.85, 0.9],
        position: [0, 0.425, -1.0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        id: 'table-coffee-02',
        name: 'Oak Coffee Table',
        assetId: 'table-oak-coffee',
        dimensions: [1.0, 0.45, 0.6],
        position: [0, 0.225, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setAuthToken('test-valid-bearer-token');
  });

  describe('PreferenceSettingsModal Component', () => {
    it('renders with taxonomy sections and titles', () => {
      render(
        <PreferenceSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          currentPreferences={{}}
          scene={mockScene}
          onSavePreferences={vi.fn().mockResolvedValue(undefined)}
          onResetPreferences={vi.fn().mockResolvedValue(undefined)}
        />
      );

      expect(screen.getByText('Design Preferences & Priorities')).toBeDefined();
      expect(screen.getByText('Interior Styles')).toBeDefined();
      expect(screen.getByText('Colour Palette')).toBeDefined();
      expect(screen.getByText('Primary Materials')).toBeDefined();
      expect(screen.getByText(/Layout Intent/)).toBeDefined();
      expect(screen.getByText('Functional Priorities')).toBeDefined();
      expect(screen.getByText('Preserve Existing Furniture')).toBeDefined();
      expect(screen.getByText('Budget Cap (₹ INR)')).toBeDefined();
    });

    it('toggles interior style badges and calls onSavePreferences on "Use for this Request"', async () => {
      const handleSave = vi.fn().mockResolvedValue(undefined);
      render(
        <PreferenceSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          currentPreferences={{ style_preferences: ['minimalist'] }}
          scene={mockScene}
          onSavePreferences={handleSave}
          onResetPreferences={vi.fn().mockResolvedValue(undefined)}
        />
      );

      // Click Scandinavian badge
      const scandinavianBtn = screen.getByText('Scandinavian');
      fireEvent.click(scandinavianBtn);

      // Click Use for this Request
      const applyBtn = screen.getByText('Use for this Request');
      fireEvent.click(applyBtn);

      await waitFor(() => {
        expect(handleSave).toHaveBeenCalledWith(
          expect.objectContaining({
            style_preferences: expect.arrayContaining(['minimalist', 'scandinavian']),
          }),
          false
        );
      });
    });

    it('toggles material badges when clicked', async () => {
      const handleSave = vi.fn().mockResolvedValue(undefined);
      render(
        <PreferenceSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          currentPreferences={{}}
          scene={mockScene}
          onSavePreferences={handleSave}
          onResetPreferences={vi.fn().mockResolvedValue(undefined)}
        />
      );

      const woodBtn = screen.getByText('Natural Wood');
      fireEvent.click(woodBtn);

      const applyBtn = screen.getByText('Use for this Request');
      fireEvent.click(applyBtn);

      await waitFor(() => {
        expect(handleSave).toHaveBeenCalledWith(
          expect.objectContaining({
            material_preferences: ['wood'],
          }),
          false
        );
      });
    });

    it('toggles preservation checkboxes for existing scene items', async () => {
      const handleSave = vi.fn().mockResolvedValue(undefined);
      render(
        <PreferenceSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          currentPreferences={{}}
          scene={mockScene}
          onSavePreferences={handleSave}
          onResetPreferences={vi.fn().mockResolvedValue(undefined)}
        />
      );

      const sofaPreserveCheckbox = screen.getByLabelText(/Modern 3-Seater Sofa/);
      fireEvent.click(sofaPreserveCheckbox);

      const applyBtn = screen.getByText('Use for this Request');
      fireEvent.click(applyBtn);

      await waitFor(() => {
        expect(handleSave).toHaveBeenCalledWith(
          expect.objectContaining({
            preservation_preferences: {
              preserve_all_existing: false,
              preserve_object_ids: ['sofa-anchor-01'],
            },
          }),
          false
        );
      });
    });

    it('persists preferences to backend when "Save as Default Profile" is clicked', async () => {
      const handleSave = vi.fn().mockResolvedValue(undefined);

      render(
        <PreferenceSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          currentPreferences={{ style_preferences: ['minimalist'], colour_preferences: ['warm_neutrals'] }}
          scene={mockScene}
          onSavePreferences={handleSave}
          onResetPreferences={vi.fn().mockResolvedValue(undefined)}
        />
      );

      const saveDefaultBtn = screen.getByText('Save as Default Profile');
      fireEvent.click(saveDefaultBtn);

      await waitFor(() => {
        expect(handleSave).toHaveBeenCalledWith(
          expect.objectContaining({
            style_preferences: ['minimalist'],
            colour_preferences: ['warm_neutrals'],
          }),
          true
        );
      });
    });

    it('invokes onResetPreferences when "Reset Defaults" is clicked', async () => {
      const handleReset = vi.fn().mockResolvedValue(undefined);
      render(
        <PreferenceSettingsModal
          isOpen={true}
          onClose={vi.fn()}
          currentPreferences={{ style_preferences: ['minimalist', 'modern'] }}
          scene={mockScene}
          onSavePreferences={vi.fn().mockResolvedValue(undefined)}
          onResetPreferences={handleReset}
        />
      );

      const resetBtn = screen.getByText('Reset Defaults');
      fireEvent.click(resetBtn);

      await waitFor(() => {
        expect(handleReset).toHaveBeenCalled();
      });
    });
  });

  describe('API Client Preference Transmission', () => {
    it('dispatches preferences in sendAgentPrompt payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          run: { id: 'run-1', status: 'proposed' },
          candidates: [],
          preferences_feedback: {
            interpreted_preferences: { style_preferences: ['japandi'] },
            detected_conflicts: [],
          },
        }),
      });
      globalThis.fetch = mockFetch;

      const prefs: DesignPreferences = {
        style_preferences: ['japandi', 'minimalist'],
        colour_preferences: ['warm_neutrals'],
        material_preferences: ['wood'],
      };

      await agentApi.sendAgentPrompt(
        'session-pref-456',
        'Arrange a japandi living room',
        mockScene,
        undefined,
        3,
        undefined,
        prefs
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/agent/sessions/session-pref-456/prompt/'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: expect.stringContaining('"style_preferences":["japandi","minimalist"]'),
        })
      );
    });
  });
});
