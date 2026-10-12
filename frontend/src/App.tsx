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
  ChevronRight
} from 'lucide-react';
import { checkBackendHealth, type HealthResponse } from './services/api';

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

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
    <div className="min-h-screen bg-[#0a0d14] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/20">
              <Boxes className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                RoomGenie AI
              </span>
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                Phase 0 Scaffold
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-3 text-xs text-slate-400">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              B.Tech CSE Project
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        {/* Hero Section */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-indigo-950/40 via-slate-900/40 to-slate-950/40 border border-indigo-500/20 p-8 sm:p-12 shadow-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(99,102,241,0.15),transparent_50%)]"></div>
          <div className="relative z-10 max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              Autonomous Scaffold Complete
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
              AI-Agent-Assisted 3D Interior Design System
            </h1>
            <p className="text-slate-300 text-base sm:text-lg leading-relaxed">
              Interactive 3D furniture placement, room-photo analysis, photo-to-3D reconstruction, and AR visualization with deterministic budget enforcement.
            </p>
          </div>
        </div>

        {/* Phase 0 Architecture Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Backend API Health Card */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 flex flex-col justify-between shadow-lg hover:border-slate-700 transition-all">
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

          {/* Database Card */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 flex flex-col justify-between shadow-lg hover:border-slate-700 transition-all">
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-base">PostgreSQL 17</h3>
                <p className="text-xs text-slate-400 mt-1">Authoritative persistence & scene storage</p>
              </div>
              <div className="text-xs text-slate-300 space-y-1 bg-slate-800/40 p-3 rounded-lg border border-slate-700/40">
                <div className="flex justify-between">
                  <span className="text-slate-400">Database Engine:</span>
                  <span className="font-mono text-purple-300">PostgreSQL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Service Status:</span>
                  <span className="text-emerald-400 font-medium">Running (Port 5432)</span>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-4 pt-4 border-t border-slate-800">
              Docker Compose fallback configured
            </p>
          </div>

          {/* AI Adapter Mode Card */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 flex flex-col justify-between shadow-lg hover:border-slate-700 transition-all">
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
                  <span className="text-amber-300 font-medium">Mock Mode (Gemini 3.7 Ready)</span>
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

        {/* Next Milestone: Phase 1 Preview */}
        <div className="rounded-2xl bg-slate-900/40 border border-slate-800/80 p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
            <div>
              <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-1">
                Upcoming Milestone
              </div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Layers className="w-6 h-6 text-indigo-400" />
                Phase 1 — Interactive 3D Room Editor
              </h2>
            </div>
            <span className="px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700">
              Awaiting Developer Review
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 text-xs">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <ChevronRight className="w-4 h-4 text-indigo-400" />
                Three.js & R3F Scene
              </div>
              <p className="text-slate-400">
                Room boundary dimensions in metres, floor grid, lighting, orbit controls, and camera reset.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <ChevronRight className="w-4 h-4 text-indigo-400" />
                Furniture Manipulations
              </div>
              <p className="text-slate-400">
                Selection, translate, rotate, scale clamping, duplicate, and delete with legal sample GLB models.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <ChevronRight className="w-4 h-4 text-indigo-400" />
                Canonical Scene JSON
              </div>
              <p className="text-slate-400">
                Serializable scene state separated from Three.js live instances as specified in ARCHITECTURE.md.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/30 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <div>
            RoomGenie AI &bull; Solo B.Tech CSE Project &bull; Gourav Sharma
          </div>
          <div className="flex items-center space-x-6">
            <span>React + TypeScript + Vite</span>
            <span>Tailwind CSS</span>
            <span>Django REST Framework</span>
            <span>PostgreSQL</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
