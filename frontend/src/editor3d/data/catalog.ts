import type { FurnitureCatalogItem } from '../../types/scene';

export const SAMPLE_CATALOG: FurnitureCatalogItem[] = [
  {
    id: 'sofa-modern-3seater',
    name: 'Modern 3-Seater Sofa',
    category: 'seating',
    dimensions: [2.1, 0.85, 0.9], // Width: 2.1m, Height: 0.85m, Depth: 0.9m
    pricePaise: 2999900,         // ₹29,999
    license: 'CC0 - Public Domain',
    source: 'RoomGenie Curated Architectural Library (CC0)',
    description: 'Contemporary low-profile three-seater sofa with deep foam cushions and solid wood base.',
    defaultColor: '#4f46e5',     // Indigo / Slate
  },
  {
    id: 'table-oak-coffee',
    name: 'Minimalist Coffee Table',
    category: 'tables',
    dimensions: [1.2, 0.45, 0.6], // Width: 1.2m, Height: 0.45m, Depth: 0.6m
    pricePaise: 849900,          // ₹8,499
    license: 'CC0 - Public Domain',
    source: 'RoomGenie Curated Architectural Library (CC0)',
    description: 'Clean Scandinavian solid oak coffee table with rounded chamfered edges.',
    defaultColor: '#b45309',     // Amber / Oak
  },
  {
    id: 'desk-workspace-study',
    name: 'Ergonomic Study Desk',
    category: 'tables',
    dimensions: [1.4, 0.75, 0.7], // Width: 1.4m, Height: 0.75m, Depth: 0.7m
    pricePaise: 1499900,         // ₹14,999
    license: 'CC0 - Public Domain',
    source: 'RoomGenie Curated Architectural Library (CC0)',
    description: 'Spacious work-from-home desk with dual cable cutouts and matte steel legs.',
    defaultColor: '#334155',     // Slate
  },
  {
    id: 'chair-accent-armchair',
    name: 'Lounge Accent Armchair',
    category: 'seating',
    dimensions: [0.85, 0.88, 0.85], // Width: 0.85m, Height: 0.88m, Depth: 0.85m
    pricePaise: 1199900,            // ₹11,999
    license: 'CC0 - Public Domain',
    source: 'RoomGenie Curated Architectural Library (CC0)',
    description: 'Comfortable textured fabric reading armchair with tapered wooden legs.',
    defaultColor: '#059669',        // Emerald
  },
  {
    id: 'storage-bookshelf-tall',
    name: '4-Tier Architectural Bookshelf',
    category: 'storage',
    dimensions: [1.0, 1.8, 0.35], // Width: 1.0m, Height: 1.8m, Depth: 0.35m
    pricePaise: 1649900,          // ₹16,499
    license: 'CC0 - Public Domain',
    source: 'RoomGenie Curated Architectural Library (CC0)',
    description: 'Open-backed vertical display shelving unit crafted from walnut veneer and blackened steel.',
    defaultColor: '#1e293b',      // Dark slate
  },
];
