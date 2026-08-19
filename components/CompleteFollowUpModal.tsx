import React, { useState } from 'react';
import { 
  CheckCircle2, 
  X, 
  FileText, 
  Calendar, 
  PlusCircle,
  Calculator,
  MessageSquare
} from 'lucide-react';
import { ActivityV2 } from '../types';

interface CompleteFollowUpModalProps {
  isOpen: boolean;
  activity: ActivityV2 | null;
  onClose: () => void;
  onConfirm: (activityId: string, resultNote?: string, options?: { createNextFollowUp?: boolean; createQuote?: boolean }) => void;
}

export const CompleteFollowUpModal: React.FC<CompleteFollowUpModalProps> = ({
  isOpen,
  activity,
  onClose,
  onConfirm
}) => {
  const [resultNote, setResultNote] = useState('');
  const [createNextFollowUp, setCreateNextFollowUp] = useState(false);
  const [createQuote, setCreateQuote] = useState(false);

  if (!isOpen || !activity) return null;

  const handleSaveWithNote = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onConfirm(activity.id, resultNote.trim(), { createNextFollowUp, createQuote });
    setResultNote('');
    setCreateNextFollowUp(false);
    setCreateQuote(false);
  };

  const handleSaveWithoutNote = () => {
    onConfirm(activity.id, undefined, { createNextFollowUp, createQuote });
    setResultNote('');
    setCreateNextFollowUp(false);
    setCreateQuote(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 rounded-[28px] shadow-2xl w-full max-w-lg border border-slate-100 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-850">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                Completar Seguimiento
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Gestión y Cierre de Tarea
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSaveWithNote} className="p-6 space-y-5">
          {/* Tarjeta de contexto del seguimiento */}
          <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
              Seguimiento a completar:
            </p>
            <p className="font-bold text-slate-800 dark:text-slate-200 line-clamp-3">
              {activity.description || "Seguimiento programado"}
            </p>
            {activity.followUpAt && (
              <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold mt-2 flex items-center gap-1">
                <Calendar size={12} />
                Programado para: {new Date(activity.followUpAt).toLocaleDateString("es-CO", { dateStyle: "medium" })}
              </p>
            )}
          </div>

          {/* Campo de texto para el resultado de la gestión */}
          <div className="space-y-2">
            <label className="block text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Resultado o Notas de la Gestión:
            </label>
            <div className="relative">
              <textarea
                value={resultNote}
                onChange={(e) => setResultNote(e.target.value)}
                placeholder="Escribe el resultado de la llamada o gestión (ej: Cliente solicitó cotización actualizada, reunión acordada para el viernes, etc.)..."
                className="w-full h-28 p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:bg-white dark:focus:bg-slate-950 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:focus:ring-emerald-950/50 outline-none transition-all resize-none"
                autoFocus
              />
              <MessageSquare size={16} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Acciones rápidas / Siguientes pasos opcionales */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Siguientes acciones (Opcional):
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCreateNextFollowUp(!createNextFollowUp)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                  createNextFollowUp
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <PlusCircle size={13} />
                Agendar nuevo seguimiento
              </button>

              <button
                type="button"
                onClick={() => setCreateQuote(!createQuote)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                  createQuote
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 text-indigo-700 dark:text-indigo-300'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <Calculator size={13} />
                Crear cotización
              </button>
            </div>
          </div>

          {/* Botones de acción */}
          <div className="pt-3 flex flex-col sm:flex-row items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={handleSaveWithoutNote}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              Marcar sin nota
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 size={15} />
                Guardar y cerrar
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
