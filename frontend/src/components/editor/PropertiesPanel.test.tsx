import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertiesPanel } from './PropertiesPanel';
import { useEditorStore } from '../../editor3d/store/editorStore';
import type { CanonicalScene } from '../../types/scene';

describe('PropertiesPanel — Semantic Relationships & Sockets Integration', () => {
  beforeEach(() => {
    const initialScene: CanonicalScene = {
      schemaVersion: 1,
      unit: 'm',
      room: { width: 6, length: 6, height: 2.8 },
      objects: [
        {
          id: 'sofa-1',
          assetId: 'sofa-modern-3seater',
          name: 'Contemporary 3-Seat Sofa',
          dimensions: [2.2, 0.85, 0.95],
          position: [0, 0.425, 0],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'table-1',
          assetId: 'table-oak-coffee',
          name: 'Modern Wooden Coffee Table',
          dimensions: [1.2, 0.45, 0.6],
          position: [0, 0.225, 1.225],
          rotationEuler: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
      relationships: [],
    };

    useEditorStore.setState({
      scene: initialScene,
      selectedId: null,
      history: [],
      future: [],
    });
  });

  it('renders "No Object Selected" placeholder when no furniture is selected', () => {
    useEditorStore.setState({ selectedId: null });
    render(<PropertiesPanel />);

    expect(screen.getByText('No Object Selected')).toBeDefined();
    expect(screen.getByText(/Click any furniture model in the 3D viewport/i)).toBeDefined();
  });

  it('renders available sockets chips when an anchor furniture item with sockets is selected', () => {
    useEditorStore.setState({ selectedId: 'sofa-1' });
    render(<PropertiesPanel />);

    expect(screen.getByText('Contemporary 3-Seat Sofa')).toBeDefined();
    expect(screen.getByTestId('available-sockets-card')).toBeDefined();
    expect(screen.getByText(/Front Coffee Table/i)).toBeDefined();
  });

  it('renders attached relationship card with gap slider and detach button for child item', () => {
    // Attach table to sofa
    const attachResult = useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1', { gap: 0.45 });
    expect(attachResult.success).toBe(true);

    useEditorStore.setState({ selectedId: 'table-1' });
    render(<PropertiesPanel />);

    expect(screen.getByText('Modern Wooden Coffee Table')).toBeDefined();
    expect(screen.getByTestId('attached-relationship-card')).toBeDefined();
    expect(screen.getByText('Contemporary 3-Seat Sofa')).toBeDefined();
    expect(screen.getByText('Front Coffee Table')).toBeDefined();

    // Verify Spacing Gap slider is present
    const gapSlider = screen.getByLabelText('Spacing Gap') as HTMLInputElement;
    expect(gapSlider).toBeDefined();
    expect(parseFloat(gapSlider.value)).toBeCloseTo(0.45, 2);

    // Verify Detach button is present
    expect(screen.getByText('Detach from Socket')).toBeDefined();
  });

  it('updates relationship gap when slider is adjusted', () => {
    useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1', { gap: 0.45 });
    useEditorStore.setState({ selectedId: 'table-1' });

    render(<PropertiesPanel />);

    const gapSlider = screen.getByLabelText('Spacing Gap') as HTMLInputElement;
    fireEvent.change(gapSlider, { target: { value: '0.60' } });

    const currentRel = useEditorStore.getState().scene.relationships?.[0];
    expect(currentRel).toBeDefined();
    expect(currentRel?.gap).toBeCloseTo(0.60, 2);
  });

  it('detaches child item when "Detach from Socket" button is clicked', () => {
    useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1', { gap: 0.45 });
    useEditorStore.setState({ selectedId: 'table-1' });

    render(<PropertiesPanel />);

    const detachBtn = screen.getByText('Detach from Socket');
    fireEvent.click(detachBtn);

    // Relationship is removed
    const currentRels = useEditorStore.getState().scene.relationships || [];
    expect(currentRels.length).toBe(0);

    // Table transform is retained in scene
    const table = useEditorStore.getState().scene.objects.find((o) => o.id === 'table-1');
    expect(table).toBeDefined();
  });

  it('renders connected furniture group card with attached items and detach buttons when anchor is selected', () => {
    useEditorStore.getState().attachObjectToSocket('sofa-1', 'sofa-front-table', 'table-1', { gap: 0.45 });
    useEditorStore.setState({ selectedId: 'sofa-1' });

    render(<PropertiesPanel />);

    expect(screen.getByTestId('connected-group-card')).toBeDefined();
    expect(screen.getByText('1 Attached')).toBeDefined();
    expect(screen.getByText(/Group Movement Active/i)).toBeDefined();
    expect(screen.getByText('Modern Wooden Coffee Table')).toBeDefined();

    // Detach child from anchor panel
    const detachChildBtn = screen.getByTitle('Detach Modern Wooden Coffee Table');
    fireEvent.click(detachChildBtn);

    expect(useEditorStore.getState().scene.relationships?.length).toBe(0);
  });
});
