import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Armchair, Table, Package, Sparkles, Search, SlidersHorizontal, Bed, Palette } from 'lucide-react';
import { SAMPLE_CATALOG } from '../../editor3d/data/catalog';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { fetchFurnitureCatalog } from '../../services/designApi';
import type { FurnitureCatalogItem } from '../../types/scene';

export const FurniturePalette: React.FC = () => {
  const [items, setItems] = useState<FurnitureCatalogItem[]>(SAMPLE_CATALOG);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStyle, setSelectedStyle] = useState<string>('all');
  const [maxPrice, setMaxPrice] = useState<number>(50000); // 50,000 INR
  const [showFilters, setShowFilters] = useState<boolean>(false);

  const addFurniture = useEditorStore((state) => state.addFurniture);

  const categories = [
    { id: 'all', label: 'All Items' },
    { id: 'seating', label: 'Seating' },
    { id: 'tables', label: 'Tables' },
    { id: 'storage', label: 'Storage' },
    { id: 'beds', label: 'Beds' },
    { id: 'decor', label: 'Decor' },
  ];

  const styles = [
    { id: 'all', label: 'All Styles' },
    { id: 'modern', label: 'Modern' },
    { id: 'scandinavian', label: 'Scandinavian' },
    { id: 'minimalist', label: 'Minimalist' },
    { id: 'industrial', label: 'Industrial' },
  ];

  // Attempt to fetch from backend catalogue on mount
  useEffect(() => {
    let isMounted = true;
    async function loadCatalog() {
      try {
        const backendAssets = await fetchFurnitureCatalog();
        if (isMounted && backendAssets.length > 0) {
          const mapped: FurnitureCatalogItem[] = backendAssets.map((b) => ({
            id: b.id,
            name: b.name,
            category: (b.category as any) || 'seating',
            styleTags: b.style_tags || [],
            dimensions: b.dimensions || [1.0, 1.0, 1.0],
            pricePaise: b.price_paise,
            modelUrl: b.model_url || undefined,
            thumbnail: b.thumbnail_url || undefined,
            license: b.license || 'CC0 1.0 Universal',
            source: b.source || 'RoomGenie Architectural Assets',
            description: b.description || '',
            defaultColor: '#4f46e5',
          }));
          setItems(mapped);
        }
      } catch {
        // Fallback gracefully to SAMPLE_CATALOG
        if (isMounted) setItems(SAMPLE_CATALOG);
      }
    }
    loadCatalog();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter items based on user criteria
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Category filter
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      // 2. Style tag filter
      if (selectedStyle !== 'all') {
        const tags = item.styleTags || [];
        const hasStyle = tags.some((t) => t.toLowerCase() === selectedStyle.toLowerCase());
        if (!hasStyle) return false;
      }
      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesDesc = item.description.toLowerCase().includes(q);
        const matchesTags = (item.styleTags || []).some((t) => t.toLowerCase().includes(q));
        if (!matchesName && !matchesDesc && !matchesTags) return false;
      }
      // 4. Max price filter (unpriced items are retained unless user explicitly filters out)
      if (item.pricePaise !== null) {
        const priceInr = item.pricePaise / 100;
        if (priceInr > maxPrice) return false;
      }
      return true;
    });
  }, [items, selectedCategory, selectedStyle, searchQuery, maxPrice]);

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'seating':
        return <Armchair className="w-4 h-4 text-indigo-400" />;
      case 'tables':
        return <Table className="w-4 h-4 text-amber-400" />;
      case 'beds':
        return <Bed className="w-4 h-4 text-rose-400" />;
      case 'decor':
        return <Palette className="w-4 h-4 text-purple-400" />;
      default:
        return <Package className="w-4 h-4 text-emerald-400" />;
    }
  };

  return (
    <aside className="w-80 bg-slate-900/95 border-r border-slate-800 flex flex-col h-full overflow-hidden shrink-0 z-10">
      {/* Palette Header */}
      <div className="p-4 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            Furniture Catalogue
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowFilters(!showFilters)}
              title="Toggle Advanced Filters"
              className={`p-1.5 rounded-lg border text-xs transition ${
                showFilters || selectedStyle !== 'all' || maxPrice < 50000
                  ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {filteredItems.length} models
            </span>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search furniture, styles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950/60 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
          />
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

        {/* Advanced Filter Drawer */}
        {showFilters && (
          <div className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl space-y-2.5 animate-in fade-in duration-150">
            {/* Style Filter */}
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                Style Filter
              </span>
              <div className="flex flex-wrap gap-1">
                {styles.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setSelectedStyle(st.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                      selectedStyle === st.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Max Price Slider */}
            <div>
              <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                <span>Max Budget (INR)</span>
                <span className="font-mono text-white">₹{maxPrice.toLocaleString('en-IN')}</span>
              </div>
              <input
                type="range"
                min="5000"
                max="50000"
                step="2500"
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Catalog Items List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            No furniture matches the selected filters.
          </div>
        ) : (
          filteredItems.map((item: FurnitureCatalogItem) => (
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

                  {item.pricePaise !== null ? (
                    <span className="text-[11px] font-bold text-slate-200 font-mono">
                      ₹{(item.pricePaise / 100).toLocaleString('en-IN')}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/50">
                      On Request
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-400 mt-2 line-clamp-2">
                  {item.description}
                </p>

                {/* Style Tags Chips */}
                {item.styleTags && item.styleTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.styleTags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800/90 text-slate-400 border border-slate-700/60"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
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
          ))
        )}
      </div>
    </aside>
  );
};
