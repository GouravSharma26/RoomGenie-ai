import React from 'react';
import { X, Mouse, Keyboard, Touchpad, CheckCircle2 } from 'lucide-react';

interface ControlsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ControlsHelpModal: React.FC<ControlsHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Mouse className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">3D Navigation & Controls</h3>
              <p className="text-xs text-slate-400">Mouse, touch, and keyboard reference guide</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Mouse Controls */}
          <div className="space-y-2">
            <div className="font-semibold text-indigo-400 flex items-center gap-1.5 text-xs">
              <Mouse className="w-3.5 h-3.5" />
              Mouse Actions
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 space-y-1.5 text-slate-300">
              <div className="flex justify-between">
                <span>Left Click on object:</span>
                <span className="font-medium text-white">Select furniture item</span>
              </div>
              <div className="flex justify-between">
                <span>Left Click & Drag on floor:</span>
                <span className="font-medium text-white">Orbit / rotate camera</span>
              </div>
              <div className="flex justify-between">
                <span>Right Click & Drag:</span>
                <span className="font-medium text-white">Pan camera</span>
              </div>
              <div className="flex justify-between">
                <span>Scroll Wheel:</span>
                <span className="font-medium text-white">Zoom in / out</span>
              </div>
            </div>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="space-y-2">
            <div className="font-semibold text-indigo-400 flex items-center gap-1.5 text-xs">
              <Keyboard className="w-3.5 h-3.5" />
              Keyboard Shortcuts
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 space-y-1.5 text-slate-300">
              <div className="flex justify-between items-center">
                <span>Delete selected item:</span>
                <span className="font-mono bg-slate-800 px-2 py-0.5 rounded text-white text-[10px]">Delete / Backspace</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Deselect current item:</span>
                <span className="font-mono bg-slate-800 px-2 py-0.5 rounded text-white text-[10px]">Escape</span>
              </div>
            </div>
          </div>

          {/* Touch Controls */}
          <div className="space-y-2">
            <div className="font-semibold text-indigo-400 flex items-center gap-1.5 text-xs">
              <Touchpad className="w-3.5 h-3.5" />
              Touchscreen Gestures
            </div>
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 space-y-1.5 text-slate-300">
              <div className="flex justify-between">
                <span>One-finger Drag:</span>
                <span className="font-medium text-white">Orbit camera</span>
              </div>
              <div className="flex justify-between">
                <span>Two-finger Pinch:</span>
                <span className="font-medium text-white">Zoom camera</span>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-2 transition"
        >
          <CheckCircle2 className="w-4 h-4" />
          Got It
        </button>
      </div>
    </div>
  );
};
