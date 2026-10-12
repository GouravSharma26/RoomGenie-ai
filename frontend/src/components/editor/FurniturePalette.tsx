import React, { useState } from 'react';
import { Plus, Armchair, Table, Package, Sparkles } from 'lucide-react';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';
import { useEditorStore } from '../../editor3d/store/editorStore';
import type { FurnitureCatalogItem } from '../../types/scene';

export const FurniturePalette: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const addFurniture = useEditorStore((state) => state.addFurniture);

  const categories = [
    { id: 'all', label: 'All Items' },
    { id: 'seating', label: 'Seating' },
    { id: 'tables', label: 'Tables' },
    { id: 'storage', label: 'Storage' },
  ];

  const filteredItems = selectedCategory === 'all'
    ? SAMPLE_CATALOG
    : SAMPLE_CATALOG.filter((item) => item.category === selectedCategory);

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'seating':
        return <Armchair className="w-4 h-4 text-indigo-400" />;
      case 'tables':
        return <Table className="w-4 h-4 text-amber-400" />;
      default:
        return <Package className="w-4 h-4 text-emerald-400" />;
    }
  };

  return (
    <aside className="w-80 bg-slate-900/95 border-r border-slate-800 flex flex-col h-full overflow-hidden shrink-0 z-10">
      {/* Palette Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            Furniture Catalogue
          </h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {SAMPLE_CATALOG.length} models
          </span>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                selectedCategory === cat.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog Items List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filteredItems.map((item: FurnitureCatalogItem) => (
          <div
            key={item.id}
            className="group p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-800/40 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center border border-slate-800">
                    {getCategoryIcon(item.category)}
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white group-hover:text-indigo-300 transition">
                      {item.name}
                    </h4>
                    <span className="text-[10px] text-slate-500">
                      {item.dimensions[0]}m &times; {item.dimensions[1]}m &times; {item.dimensions[2]}m
                    </span>
                  </div>
                </div>

                <span className="text-[11px] font-bold text-slate-200 font-mono">
                  ₹{(item.pricePaise / 100).toLocaleString('en-IN')}
                </span>
              </div>

              <p className="text-[11px] text-slate-400 mt-2 line-clamp-2">
                {item.description}
              </p>
            </div>

            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-800/60">
              <span className="text-[9px] text-slate-500 tracking-tight" title={item.source}>
                {item.license}
              </span>

              <button
                onClick={() => addFurniture(item)}
                className="px-2.5 py-1 rounded-lg bg-indigo-600/90 hover:bg-indigo-600 text-white text-[11px] font-medium flex items-center gap-1 transition shadow-sm hover:shadow-indigo-500/20 active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                Add to Room
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
