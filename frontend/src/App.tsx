import { useState, useEffect } from 'react';
import { 
  Boxes, 
  Server, 
  Database, 
  Sparkles, 
  CheckCircle2, 
  Activity, 
  RefreshCw, 
  Layers, 
  ShieldCheck,
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { checkBackendHealth, type HealthResponse } from './services/api';
import { RoomCanvas } from './editor3d/components/RoomCanvas';
import { EditorHeader } from './components/editor/EditorHeader';
import { FurniturePalette } from './components/editor/FurniturePalette';
import { PropertiesPanel } from './components/editor/PropertiesPanel';
import { ControlsHelpModal } from './components/editor/ControlsHelpModal';
import { DesignPersistenceModal } from './components/editor/DesignPersistenceModal';
import { BudgetBreakdownModal } from './components/editor/BudgetBreakdownModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'editor' | 'dashboard'>('editor');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [isSaveLoadOpen, setIsSaveLoadOpen] = useState<boolean>(false);
  const [isBudgetOpen, setIsBudgetOpen] = useState<boolean>(false);

  const fetchHealth = async () => {
    setLoading(true);
    const result = await checkBackendHealth();
    setHealth(result);
    setLastChecked(new Date());
    setLoading(false);
  };

  useEffect(() => {
    let isMounted = true;
    checkBackendHealth().then((result) => {
      if (isMounted) {
        setHealth(result);
        setLastChecked(new Date());
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="h-screen w-screen bg-[#0a0d14] text-slate-100 flex flex-col font-sans overflow-hidden selection:bg-indigo-500/30">
      {/* Top Application Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md shrink-0 z-30">
        <div className="w-full px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/20">
              <Boxes className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-bold text-base tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                RoomGenie AI
              </span>
              <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                Phase 3 Active
              </span>
            </div>
          </div>

          {/* Tab Switcher: 3D Editor vs System Dashboard */}
          <div className="flex items-center bg-slate-950/60 p-1 rounded-xl border border-slate-800/80">
            <button
              onClick={() => setActiveTab('editor')}
              className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                activeTab === 'editor'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>3D Room Editor</span>
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                activeTab === 'dashboard'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>System Status</span>
            </button>
          </div>

          <div className="flex items-center space-x-3 text-xs text-slate-400">
            <span className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/60 border border-slate-700/60 text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              B.Tech CSE Project
            </span>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      {activeTab === 'editor' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Editor Header Bar with room dimensions & reset controls */}
          <EditorHeader 
            onOpenHelp={() => setIsHelpOpen(true)} 
            onOpenSaveLoad={() => setIsSaveLoadOpen(true)}
            onOpenBudgetBreakdown={() => setIsBudgetOpen(true)}
          />

          {/* 3D Viewport with Left and Right Toolbars */}
          <div className="flex-1 flex overflow-hidden relative">
            <FurniturePalette />
            <main className="flex-1 h-full relative overflow-hidden">
              <RoomCanvas />
            </main>
            <PropertiesPanel />
          </div>

          <ControlsHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
          <DesignPersistenceModal isOpen={isSaveLoadOpen} onClose={() => setIsSaveLoadOpen(false)} />
          <BudgetBreakdownModal isOpen={isBudgetOpen} onClose={() => setIsBudgetOpen(false)} />
        </div>
      ) : (
        /* System Status Dashboard View */
        <div className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-8 max-w-7xl w-full mx-auto">
          {/* Hero Header */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-indigo-950/40 via-slate-900/40 to-slate-950/40 border border-indigo-500/20 p-8 shadow-2xl">
            <div className="relative z-10 max-w-3xl space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                Phase 0 & 1 Verification
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                AI-Agent-Assisted 3D Interior Design System
              </h1>
              <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                Deterministic architecture, React Three Fiber scene graph, and modular Django backend with PostgreSQL persistence.
              </p>
            </div>
          </div>

          {/* System Status Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Django REST API Card */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 flex flex-col justify-between shadow-lg">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
                    <Server className="w-5 h-5" />
                  </div>
                  <button
                    onClick={fetchHealth}
                    disabled={loading}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    title="Refresh backend status"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">Django REST API</h3>
                  <p className="text-xs text-slate-400 mt-1">Endpoint: <code className="text-indigo-300">/api/v1/health/</code></p>
                </div>
                <div className="pt-2">
                  {loading ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Activity className="w-4 h-4 animate-spin text-indigo-400" />
                      Checking API status...
                    </div>
                  ) : health && health.status === 'ok' ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-3 py-2 rounded-lg">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>API Online ({health.service} v{health.version})</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3 py-2 rounded-lg">
                      <Activity className="w-4 h-4 shrink-0" />
                      <span>Django offline or starting ({health?.status || 'unreachable'})</span>
                    </div>
                  )}
                </div>
              </div>
              {lastChecked && (
                <p className="text-[10px] text-slate-500 mt-4 pt-4 border-t border-slate-800">
                  Last checked: {lastChecked.toLocaleTimeString()}
                </p>
              )}
            </div>

            {/* PostgreSQL Database Card */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 flex flex-col justify-between shadow-lg">
              <div className="space-y-4">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">PostgreSQL 17</h3>
                  <p className="text-xs text-slate-400 mt-1">Authoritative persistence & scene storage</p>
                </div>
                <div className="text-xs text-slate-300 space-y-2 bg-slate-800/40 p-3 rounded-lg border border-slate-700/40">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Database Engine:</span>
                    <span className="font-mono text-purple-300">PostgreSQL</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Connectivity:</span>
                    {loading ? (
                      <span className="text-slate-400 font-medium flex items-center gap-1">
                        <Activity className="w-3 h-3 animate-spin text-indigo-400" />
                        Checking...
                      </span>
                    ) : health?.status === 'unreachable' ? (
                      <span className="text-amber-400 font-medium bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40 text-[11px]">
                        Backend Unreachable
                      </span>
                    ) : health?.database === 'connected' ? (
                      <span className="text-emerald-400 font-medium bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40 text-[11px] flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        Connected
                      </span>
                    ) : health?.database === 'disconnected' ? (
                      <span className="text-rose-400 font-medium bg-rose-950/40 px-2 py-0.5 rounded border border-rose-800/40 text-[11px] flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                        Disconnected
                      </span>
                    ) : (
                      <span className="text-slate-400 font-medium text-[11px]">Unknown</span>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-4 pt-4 border-t border-slate-800">
                Docker Compose bound to 127.0.0.1 loopback
              </p>
            </div>

            {/* Model Providers Card */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 flex flex-col justify-between shadow-lg">
              <div className="space-y-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">Model Providers & Cost Gate</h3>
                  <p className="text-xs text-slate-400 mt-1">Zero-cost deterministic development</p>
                </div>
                <div className="text-xs text-slate-300 space-y-1 bg-slate-800/40 p-3 rounded-lg border border-slate-700/40">
                  <div className="flex justify-between">
                    <span className="text-slate-400">LLM Provider:</span>
                    <span className="text-amber-300 font-medium">Mock Mode (Gemini 3.8 Ready)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">3D Provider:</span>
                    <span className="text-amber-300 font-medium">Mock Mode (Tripo v3.1 Gated)</span>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-4 pt-4 border-t border-slate-800">
                Cost & API keys locked behind human approval
              </p>
            </div>
          </div>

          {/* Phase 1 Overview */}
          <div className="rounded-2xl bg-slate-900/40 border border-slate-800 p-6 sm:p-8 space-y-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-400" />
              Phase 1 — Interactive 3D Room Editor Active
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
              Switch to the <strong>3D Room Editor</strong> tab to interactively customize room dimensions in metres, place furniture from the curated catalogue, rotate, move, and scale objects with real-time room boundary clamping.
            </p>
            <div className="flex items-center gap-4 pt-2">
              <button
                onClick={() => setActiveTab('editor')}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition"
              >
                Open 3D Editor
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
