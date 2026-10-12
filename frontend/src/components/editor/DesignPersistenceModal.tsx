import React, { useState, useEffect } from 'react';
import { 
  Cloud, 
  Save, 
  FolderOpen, 
  Trash2, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Boxes 
} from 'lucide-react';
import { useEditorStore } from '../../editor3d/store/editorStore';
import { 
  listSavedDesigns, 
  saveDesignToBackend, 
  deleteDesignFromBackend, 
  type DesignRecord 
} from '../../services/designApi';

interface DesignPersistenceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DesignPersistenceModal: React.FC<DesignPersistenceModalProps> = ({ isOpen, onClose }) => {
  const scene = useEditorStore((state) => state.scene);
  const loadScene = useEditorStore((state) => state.loadScene);

  const [designs, setDesigns] = useState<DesignRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('My Living Room Design');
  const [currentDesignId, setCurrentDesignId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refreshDesigns = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const records = await listSavedDesigns();
      setDesigns(records);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to fetch designs.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let isSubscribed = true;

    void Promise.resolve().then(async () => {
      if (!isSubscribed) return;
      setLoading(true);
      try {
        const records = await listSavedDesigns();
        if (isSubscribed) {
          setDesigns(records);
        }
      } catch (err: any) {
        if (isSubscribed) {
          setStatusMsg({ type: 'error', text: err.message || 'Failed to fetch designs.' });
        }
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    });

    return () => {
      isSubscribed = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (asNew: boolean = false) => {
    setSaving(true);
    setStatusMsg(null);
    try {
      const saveId = asNew ? null : currentDesignId;
      const saved = await saveDesignToBackend(title, scene, saveId);
      setCurrentDesignId(saved.id);
      setStatusMsg({ type: 'success', text: `Saved "${saved.title}" successfully!` });
      await refreshDesigns();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to save design.' });
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = (record: DesignRecord) => {
    loadScene(record.scene_json);
    setCurrentDesignId(record.id);
    setTitle(record.title);
    setStatusMsg({ type: 'success', text: `Loaded "${record.title}" into 3D Editor.` });
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this saved design?')) return;
    try {
      await deleteDesignFromBackend(id);
      if (currentDesignId === id) {
        setCurrentDesignId(null);
      }
      setStatusMsg({ type: 'success', text: 'Design deleted.' });
      await refreshDesigns();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to delete design.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm">Save & Load Room Designs</h3>
              <p className="text-[11px] text-slate-400">PostgreSQL Cloud Persistence (Phase 2)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Message */}
        {statusMsg && (
          <div
            className={`px-4 py-2.5 mx-6 mt-4 rounded-xl text-xs flex items-center gap-2 border ${
              statusMsg.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {statusMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Save Current Scene Section */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5 text-indigo-400" />
                <span>Save Active Scene</span>
              </label>
              <span className="text-[11px] text-slate-500">
                {scene.objects.length} furniture items &bull; {scene.room.width}m &times; {scene.room.length}m
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter design name..."
                className="flex-1 bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => handleSave(false)}
                disabled={saving || !title.trim()}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 transition active:scale-95 shadow-sm"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{currentDesignId ? 'Update' : 'Save'}</span>
              </button>
              {currentDesignId && (
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving || !title.trim()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                  title="Save as a new separate copy"
                >
                  Save As New
                </button>
              )}
            </div>
          </div>

          {/* Saved Designs List Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                <span>Saved Designs in Database</span>
              </h4>
              <span className="text-[11px] text-slate-500">{designs.length} saved</span>
            </div>

            {loading ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                <span>Loading designs from API...</span>
              </div>
            ) : designs.length === 0 ? (
              <div className="py-8 px-4 text-center rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs">
                No designs saved yet. Save your current scene above!
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {designs.map((record) => (
                  <div
                    key={record.id}
                    onClick={() => handleLoad(record)}
                    className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                      currentDesignId === record.id
                        ? 'bg-indigo-600/10 border-indigo-500/40 text-white'
                        : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-indigo-400 shrink-0">
                        <Boxes className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{record.title}</p>
                        <p className="text-[10px] text-slate-400">
                          {record.object_count} item{record.object_count === 1 ? '' : 's'} &bull;{' '}
                          {new Date(record.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleLoad(record)}
                        className="px-2.5 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-[11px] font-medium border border-indigo-500/20 transition"
                      >
                        Load
                      </button>
                      <button
                        onClick={(e) => handleDelete(record.id, e)}
                        className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition"
                        title="Delete design"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between text-[11px] text-slate-500">
          <span>Authoritative DRF serialization & PostgreSQL 17</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
