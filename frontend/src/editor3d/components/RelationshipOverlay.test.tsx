import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SocketOverlay } from './SocketOverlay';
import { RelationshipOverlay } from './RelationshipOverlay';
import { useEditorStore } from '../store/editorStore';
import type { CanonicalScene } from '../../types/scene';
import type { SocketCandidate } from '../../spatial';
import { defaultSocketRegistry } from '../../spatial';

describe('Viewport Visual Indicators — SocketOverlay & RelationshipOverlay', () => {
  const baseScene: CanonicalScene = {
    schemaVersion: 1,
    unit: 'm',
    room: { width: 6, length: 6, height: 2.8 },
    objects: [
      {
        id: 'sofa-1',
        assetId: 'sofa-modern-3seater',
        name: 'Modern 3-Seater Sofa',
        dimensions: [2.1, 0.85, 0.9],
        position: [0, 0.425, 0],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        id: 'table-1',
        assetId: 'table-oak-coffee',
        name: 'Minimalist Coffee Table',
        dimensions: [1.2, 0.45, 0.6],
        position: [0, 0.225, 1.2],
        rotationEuler: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
    relationships: [],
  };

  beforeEach(() => {
    useEditorStore.setState({
      scene: baseScene,
      selectedId: null,
      draggedObjectId: null,
      activeSocketCandidate: null,
    });
  });

  it('SocketOverlay renders null when no object is selected and no object is dragged', () => {
    const { container } = render(<SocketOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('SocketOverlay renders 3D socket markers when anchor is selected', () => {
    useEditorStore.setState({ selectedId: 'sofa-1' });
    const { container } = render(<SocketOverlay />);

    // Sofa has 3 canonical sockets: front-table, left-accent, right-accent
    const sofaSockets = defaultSocketRegistry.getSocketsForAsset('sofa-modern-3seater');
    expect(sofaSockets.length).toBe(3);

    // Should render a group with socket mesh elements
    expect(container.querySelector('group')).toBeDefined();
    const meshes = container.querySelectorAll('mesh');
    expect(meshes.length).toBeGreaterThanOrEqual(3);
  });

  it('SocketOverlay renders compatible sockets across anchors when an item is being dragged', () => {
    // When dragging the coffee table, sofa's front socket is compatible
    useEditorStore.setState({
      selectedId: null,
      draggedObjectId: 'table-1',
    });

    const { container } = render(<SocketOverlay />);
    expect(container.firstChild).not.toBeNull();
    const meshes = container.querySelectorAll('mesh');
    expect(meshes.length).toBeGreaterThan(0);
  });

  it('RelationshipOverlay renders existing active relationship connection line', () => {
    const sceneWithRel: CanonicalScene = {
      ...baseScene,
      relationships: [
        {
          id: 'rel-1',
          anchorObjectId: 'sofa-1',
          socketId: 'sofa-front-table',
          childObjectId: 'table-1',
          gap: 0.45,
          relativeYaw: 0,
        },
      ],
    };

    useEditorStore.setState({ scene: sceneWithRel, selectedId: 'sofa-1' });
    const { container } = render(<RelationshipOverlay />);

    // Should render lineSegments and contact spheres
    const lineSegments = container.querySelector('lineSegments');
    expect(lineSegments).toBeDefined();

    const spheres = container.querySelectorAll('mesh');
    expect(spheres.length).toBeGreaterThanOrEqual(2);
  });

  it('RelationshipOverlay renders magnetic ghost preview and guide line when activeSocketCandidate is set', () => {
    const socket = defaultSocketRegistry.getSocketDefinition('sofa-modern-3seater', 'sofa-front-table')!;
    const candidate: SocketCandidate = {
      socket,
      anchorPlacement: baseScene.objects[0],
      targetPlacement: baseScene.objects[1],
      targetPosition: [0, 0.225, 1.2],
      targetRotation: [0, 0, 0],
      distanceToTarget: 0.2,
      gap: 0.45,
      valid: true,
      violations: [],
    };

    useEditorStore.setState({
      activeSocketCandidate: candidate,
      draggedObjectId: 'table-1',
    });

    const { container } = render(<RelationshipOverlay />);

    // Renders magnetic guide line
    const lineSegments = container.querySelector('lineSegments');
    expect(lineSegments).toBeDefined();

    // Renders ghost wireframe mesh and target ring
    const meshes = container.querySelectorAll('mesh');
    expect(meshes.length).toBeGreaterThanOrEqual(3);
  });
});
