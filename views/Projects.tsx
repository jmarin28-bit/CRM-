// pages/Projects.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Task, AccountV2, ContactV2, TaskStatus, TaskPriority, TimeLog
} from '../types';
import { 
  getTasksByUser, saveTasks, addTask, updateTaskStatus, 
  getTimeLogs, startTimeLog, stopTimeLog, createActivity,
  listAccounts, listContacts, getActiveUser, listAccountsByUser,
  reopenTask
} from '../services/storage';
import { 
  DndContext, DragOverlay, useDraggable, useDroppable, DragEndEvent, DragStartEvent 
} from '@dnd-kit/core';
import { 
  Plus, CalendarRange, Kanban, Play, Square, Clock, X, AlertTriangle, Lock
} from 'lucide-react';

// --- Utils ---
const getPriorityColor = (priority: TaskPriority) => {
  switch(priority) {
    case 'Alta': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-800';
    case 'Media': return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:border-amber-800';
    case 'Baja': return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800';
    default: return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600';
  }
};

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
};

const getTaskOriginLabel = (task: Task) => {
  const text = `${task.title} ${task.description || ""}`.toLowerCase();

  if (text.includes("cotización")) return "Cotización";
  if (text.includes("tarea interna")) return "Interna";
  if (task.contactId) return "Contacto";
  if (task.accountId) return "Cuenta";
  return "General";
};

// --- Sub Components ---
const TaskCard: React.FC<{ 
  task: Task; 
  accountName: string;
  contactName?: string;
  activeLog?: TimeLog;
  totalTime: number;
  onToggleTimer: (id: string) => void;
  onReopenTask: (task: Task) => void;
}> = ({ task, accountName, contactName, activeLog, totalTime, onToggleTimer, onReopenTask }) => {
  const isFinished = task.status === "Finalizado";

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: isFinished
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const isRunning = !!activeLog;

  if (isDragging) {
    return (
      <div 
        ref={setNodeRef} 
        style={style} 
        className="opacity-50 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-xl border-2 border-blue-500 cursor-grabbing rotate-2 scale-105 transition-transform"
      >
        <h4 className="font-bold text-slate-900 dark:text-white">{task.title}</h4>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(!isFinished ? listeners : {})}
      {...(!isFinished ? attributes : {})}
      className={`bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md transition-all group relative ${isFinished ? 'opacity-70 bg-slate-50 dark:bg-slate-900/40 border-dashed border-slate-300 cursor-not-allowed select-none' : 'cursor-move hover:border-blue-300'}`}
    >
      <div className="flex justify-between items-start mb-3">
         <span className={`text-[10px] font-black px-2.5 py-1 rounded-md border uppercase tracking-widest ${getPriorityColor(task.priority)}`}>
           {task.priority}
         </span>
         {isFinished ? (
           <button 
             onPointerDown={(e) => {
               e.stopPropagation(); 
               onReopenTask(task);
             }}
             className="px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-slate-800 dark:hover:bg-slate-700 border border-blue-100 dark:border-slate-700 text-[9px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm transition-all"
             title="Reabrir Tarea"
           >
             <Lock size={10} className="text-blue-500 shrink-0" /> Reabrir
           </button>
         ) : (
           <button 
             onPointerDown={(e) => {
               e.stopPropagation(); 
               onToggleTimer(task.id);
             }}
             className={`p-1.5 rounded-full transition-colors shadow-sm ${isRunning ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}
             title={isRunning ? "Detener Timer" : "Iniciar Timer"}
           >
             {isRunning ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
           </button>
         )}
      </div>
      
      <h4 className="font-bold text-slate-900 dark:text-white mb-1.5 leading-snug flex items-center gap-1.5">
        {isFinished && <Lock size={13} className="text-slate-400 dark:text-slate-500 shrink-0" />}
        {task.title}
      </h4>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600">
          {getTaskOriginLabel(task)}
        </span>
      </div>

      {task.description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 line-clamp-2">
          {task.description}
        </p>
      )}

      {contactName && (
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-4">
          {contactName}
        </p>
      )}
      
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <div className="flex flex-col min-w-0">
          <span className="font-bold text-blue-600 dark:text-blue-400 truncate max-w-[140px] uppercase text-[10px] tracking-wider">
            {accountName}
          </span>
          <span className="text-[10px] text-slate-400 mt-1">
            Fin: {task.endDate}
          </span>
        </div>

        <div className="flex items-center space-x-3">
          {totalTime > 0 && (
            <div className="flex items-center font-bold text-slate-600 dark:text-slate-300">
              <Clock size={12} className="mr-1" />
              {formatDuration(totalTime)}
            </div>
          )}
        </div>
      </div>
      
      {isRunning && (
        <div className="absolute -top-1 -right-1">
           <span className="flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
        </div>
      )}
    </div>
  );
};

const KanbanColumn: React.FC<{ 
  id: string; 
  title: string; 
  tasks: Task[]; 
  accounts: AccountV2[];
  contacts: ContactV2[];
  logs: TimeLog[];
  onToggleTimer: (id: string) => void;
  onReopenTask: (task: Task) => void;
}> = ({ id, title, tasks, accounts, contacts, logs, onToggleTimer, onReopenTask }) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  const getAccountName = (accId?: string) => {
    const acc = accounts.find(a => a.id === accId);
    return acc ? (acc.nombreComercial || acc.razonSocial) : 'General';
  };

  // Antes esto leía y parseaba localStorage directamente, una vez por tarjeta
  // y por render. Además de ser caro, se saltaba listContacts(), que filtra los
  // registros corruptos (sin id o sin accountId), así que el tablero podía
  // mostrar nombres de contactos que el resto del CRM ya no reconoce.
  const getContactName = (contactId?: string) => {
    if (!contactId) return "";
    return contacts.find(c => c.id === contactId)?.fullName || "";
  };
  
  const getTaskTotalTime = (taskId: string) => {
    return logs
      .filter(l => l.taskId === taskId)
      .reduce((acc, curr) => acc + (curr.durationSeconds || 0), 0);
  };

  const getActiveLog = (taskId: string) => logs.find(l => l.taskId === taskId && !l.endTime);

  return (
    <div 
      ref={setNodeRef}
      className={`flex flex-col flex-shrink-0 w-80 rounded-2xl max-h-full transition-colors ${isOver ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-300' : 'bg-slate-100/50 dark:bg-slate-800/50'}`}
    >
      <div className="p-4 font-black text-slate-700 dark:text-slate-200 flex justify-between items-center sticky top-0 bg-transparent z-10">
        <span className="uppercase tracking-widest text-xs">{title}</span>
        <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs px-2.5 py-0.5 rounded-full">{tasks.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[150px]">
        {tasks.map(opp => (
          <TaskCard 
            key={opp.id} 
            task={opp} 
            accountName={getAccountName(opp.accountId)}
            contactName={getContactName(opp.contactId)}
            activeLog={getActiveLog(opp.id)}
            totalTime={getTaskTotalTime(opp.id)}
            onToggleTimer={onToggleTimer}
            onReopenTask={onReopenTask}
          />
        ))}
        {tasks.length === 0 && (
          <div className="h-24 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl flex items-center justify-center text-slate-400 font-bold text-xs uppercase tracking-widest">
            Soltar aquí
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main Page Component ---
export default function Projects() {
  const [view, setView] = useState<'kanban' | 'gantt'>('kanban');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const accountsList = useMemo(() => listAccounts(), []);
  const contactsList = useMemo(() => listContacts(), []);

  // Obtener cuentas activas y respetar permisos por usuario
  const selectableAccounts = useMemo(() => {
    const currentUser = getActiveUser();
    const raw = listAccountsByUser(currentUser || undefined);

    // Filtrar cuentas inactivas, archivadas o eliminadas
    const isAccountActive = (acc: any) => {
      if (!acc) return false;
      if (acc.activo === false || acc.isActivo === false) return false;
      if (acc.archived === true || acc.isArchived === true || acc.deleted === true || acc.isDeleted === true || acc.eliminado === true) return false;

      const status = String(acc.status || acc.estado || '').toLowerCase().trim();
      if (['inactivo', 'inactiva', 'archivado', 'archivada', 'eliminado', 'eliminada', 'inactive', 'archived', 'deleted'].includes(status)) {
        return false;
      }
      return true;
    };

    // Eliminar duplicados por ID
    const seenIds = new Set<string>();
    return raw.filter(acc => {
      if (!acc || !acc.id || seenIds.has(acc.id)) return false;
      if (!isAccountActive(acc)) return false;
      seenIds.add(acc.id);
      return true;
    });
  }, []);

  // Alerta si dos cuentas tienen el mismo nombre pero diferente ID
  const duplicateNames = useMemo(() => {
    const nameToIds: Record<string, string[]> = {};
    const originalNames: Record<string, string> = {};

    selectableAccounts.forEach(acc => {
      const rawName = acc.nombreComercial || acc.razonSocial || '';
      const cleanName = rawName.trim().toLowerCase();
      if (!cleanName) return;
      if (!nameToIds[cleanName]) {
        nameToIds[cleanName] = [];
        originalNames[cleanName] = rawName.trim();
      }
      if (!nameToIds[cleanName].includes(acc.id)) {
        nameToIds[cleanName].push(acc.id);
      }
    });

    return Object.keys(nameToIds)
      .filter(cleanName => nameToIds[cleanName].length > 1)
      .map(cleanName => originalNames[cleanName]);
  }, [selectableAccounts]);

  const [newTask, setNewTask] = useState<Partial<Task>>({
    priority: 'Media',
    status: 'Pendiente',
    estimatedTime: 60,
    contactId: ''
  });

  const [confirmReopenTaskObj, setConfirmReopenTaskObj] = useState<Task | null>(null);

  const filteredContacts = useMemo(() => {
    if (!newTask.accountId) return [];
    return contactsList.filter(c => c.accountId === newTask.accountId);
  }, [contactsList, newTask.accountId]);

  useEffect(() => {
    setTasks(getTasksByUser());
    setLogs(getTimeLogs());

    const interval = setInterval(() => {
      setLogs(getTimeLogs());
    }, 5000); 

    return () => clearInterval(interval);
  }, []);

  const handleToggleTimer = (taskId: string) => {
    const active = logs.find(l => l.taskId === taskId && !l.endTime);
    if (active) {
      stopTimeLog(active.id);
    } else {
      startTimeLog(taskId);
    }
    setLogs(getTimeLogs());
  };

  const handleDragStart = (e: DragStartEvent) => setActiveDragId(e.active.id as string);
  
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveDragId(null);
    if (over && active.id !== over.id) {
      // Bloquear si la tarea ya está finalizada
      const draggedTask = tasks.find(t => t.id === active.id);
      if (draggedTask?.status === "Finalizado") {
        return;
      }

      const newStatus = over.id as TaskStatus;
      setTasks(prev => prev.map(t => t.id === active.id ? { ...t, status: newStatus } : t));
      updateTaskStatus(active.id as string, newStatus);
    }
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTask.title && newTask.startDate && newTask.endDate) {
      
      const currentUser = getActiveUser();
      if (!currentUser) {
        alert("Debes iniciar sesión primero.");
        return;
      }
      
      const task: Task = {
        id: `tsk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        title: newTask.title,
        description: newTask.description || '',
        priority: newTask.priority as TaskPriority,
        status: 'Pendiente',
        accountId: newTask.accountId,
        contactId: newTask.contactId, 
        startDate: newTask.startDate,
        endDate: newTask.endDate,
        assignedTo: newTask.assignedTo || currentUser.id,
        estimatedTime: Number(newTask.estimatedTime),
        createdAt: new Date().toISOString(),
        createdBy: currentUser.id
      };

      addTask(task);

      if (newTask.accountId) {
        try {
          createActivity({
            accountId: newTask.accountId,
            type: "Nota",
            description: `Nueva tarea creada: ${newTask.title}`,
            followUpAt: newTask.endDate || undefined
          });
        } catch (err) {
          console.warn("No se pudo registrar actividad:", err);
        }
      }

      setTasks(getTasksByUser());
      setShowModal(false);
      setNewTask({ priority: 'Media', status: 'Pendiente', estimatedTime: 60, contactId: '' });
    }
  };

  const ganttData = useMemo(() => {
    if (tasks.length === 0) return null;
    
    const startDates = tasks.map(t => new Date(t.startDate).getTime());
    const endDates = tasks.map(t => new Date(t.endDate).getTime());
    const minDate = Math.min(...startDates);
    const maxDate = Math.max(...endDates);
    
    const start = new Date(minDate);
    start.setDate(start.getDate() - 2);
    const end = new Date(maxDate);
    end.setDate(end.getDate() + 5);

    const days: Date[] = [];
    let curr = new Date(start);
    while (curr <= end) {
      days.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }

    return { days, start };
  }, [tasks]);

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Gestión de Proyectos</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Planificación de tareas y control de tiempos.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 flex shadow-sm">
            <button onClick={() => setView('kanban')} className={`p-2 rounded-md transition-colors ${view === 'kanban' ? 'bg-blue-50 dark:bg-slate-700 text-blue-600' : 'text-slate-500 hover:text-slate-700'}`} title="Tablero Kanban"><Kanban size={18} /></button>
            <button onClick={() => setView('gantt')} className={`p-2 rounded-md transition-colors ${view === 'gantt' ? 'bg-blue-50 dark:bg-slate-700 text-blue-600' : 'text-slate-500 hover:text-slate-700'}`} title="Diagrama de Gantt"><CalendarRange size={18} /></button>
          </div>
          <button onClick={() => setShowModal(true)} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-md transition-all">
            <Plus size={18} className="mr-2" /> Nueva Tarea
          </button>
        </div>
      </div>

      {/* KANBAN VIEW */}
      {view === 'kanban' && (
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
            <div className="flex space-x-6 h-full min-w-max px-1">
              {['Pendiente', 'Por hacer', 'En progreso', 'Finalizado'].map(status => (
                <KanbanColumn 
                  key={status} id={status} title={status} 
                  tasks={tasks.filter(t => t.status === status as TaskStatus)} 
                  accounts={accountsList} contacts={contactsList} logs={logs} onToggleTimer={handleToggleTimer}
                  onReopenTask={setConfirmReopenTaskObj}
                />
              ))}
            </div>
          </div>
          <DragOverlay>
            {/* El overlay se maneja en el propio TaskCard al arrastrar */}
          </DragOverlay>
        </DndContext>
      )}

      {/* GANTT VIEW */}
      {view === 'gantt' && ganttData && (
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
          <div className="overflow-x-auto flex-1">
             <div className="min-w-max">
                <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
                  <div className="w-64 shrink-0 p-4 font-bold text-xs uppercase tracking-widest text-slate-500 border-r border-slate-200 dark:border-slate-700 sticky left-0 bg-slate-50 dark:bg-slate-800 z-20">Tarea</div>
                  {ganttData.days.map(day => (
                    <div key={day.toISOString()} className="w-12 shrink-0 p-2 text-center text-xs text-slate-500 border-r border-slate-100 dark:border-slate-700">
                      <div className="font-bold text-slate-700 dark:text-slate-300">{day.getDate()}</div>
                      <div className="text-[10px] uppercase">{day.toLocaleDateString('es-CO', { weekday: 'short' })}</div>
                    </div>
                  ))}
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {tasks.map(task => {
                    const startDate = new Date(task.startDate);
                    const endDate = new Date(task.endDate);
                    const dayWidth = 48; 
                    const offsetDays = Math.floor((startDate.getTime() - ganttData.start.getTime()) / (1000 * 60 * 60 * 24));
                    const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                    const left = offsetDays * dayWidth;
                    const width = durationDays * dayWidth;

                    return (
                      <div key={task.id} className="flex relative hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors">
                        <div className="w-64 shrink-0 p-3 border-r border-slate-200 dark:border-slate-700 sticky left-0 bg-white dark:bg-slate-800 z-10">
                           <div className="font-bold text-sm text-slate-800 dark:text-white truncate">{task.title}</div>
                           <div className="text-[10px] font-black uppercase text-blue-500 mt-0.5 truncate">
                             {(() => {
                               const acc = accountsList.find(a => a.id === task.accountId);
                               return acc ? (acc.nombreComercial || acc.razonSocial) : 'General';
                             })()}
                           </div>
                        </div>
                        <div className="flex-1 relative h-16">
                           <div className={`absolute top-4 h-8 rounded-md shadow-sm opacity-90 flex items-center px-3 text-xs font-bold text-white ${task.priority === 'Alta' ? 'bg-red-500' : task.priority === 'Media' ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ left: `${left}px`, width: `${width}px` }}>
                             {task.status}
                           </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Modal Nueva Tarea */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Nueva Tarea</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleCreateTask} className="p-6 space-y-4">
              {duplicateNames.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-xs font-bold flex items-start gap-2.5 shadow-sm">
                  <AlertTriangle size={16} className="shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <span className="block mb-1 text-[10px] uppercase tracking-wider text-amber-900">⚠️ Registro(s) duplicado(s) para limpieza:</span>
                    Se detectaron cuentas activas con el mismo nombre pero diferente ID de sistema:
                    <ul className="list-disc list-inside mt-1 font-bold text-amber-950">
                      {duplicateNames.map(name => <li key={name}>{name}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Título de la Tarea *</label>
                <input required className="w-full rounded-lg border border-slate-200 p-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm" placeholder="Ej: Implementar servidor" value={newTask.title || ''} onChange={e => setNewTask({...newTask, title: e.target.value})} />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Empresa Vinculada</label>
                <select
                  className="w-full rounded-lg border border-slate-200 p-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                  value={newTask.accountId || ''}
                  onChange={e => setNewTask({
                    ...newTask,
                    accountId: e.target.value,
                    contactId: ''
                  })}
                >
                  <option value="">(Ninguna / General)</option>
                  {selectableAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.nombreComercial || acc.razonSocial}
                    </option>
                  ))}
                </select>
                {selectableAccounts.length === 0 && (
                  <p className="text-[10px] text-red-500 mt-1">No hay cuentas activas o permitidas para este usuario.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contacto Vinculado</label>
                <select
                  className="w-full rounded-lg border border-slate-200 p-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                  value={newTask.contactId || ''}
                  onChange={e => setNewTask({ ...newTask, contactId: e.target.value })}
                  disabled={!newTask.accountId}
                >
                  <option value="">(Ninguno)</option>
                  {filteredContacts.map(contact => (
                    <option key={contact.id} value={contact.id}>
                      {contact.fullName}
                    </option>
                  ))}
                </select>
                {!newTask.accountId && (
                  <p className="text-[10px] text-slate-400 mt-1">Primero selecciona una empresa.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fecha Inicio *</label>
                  <input required type="date" className="w-full rounded-lg border border-slate-200 p-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm" value={newTask.startDate || ''} onChange={e => setNewTask({...newTask, startDate: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fecha Fin *</label>
                  <input required type="date" className="w-full rounded-lg border border-slate-200 p-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm" value={newTask.endDate || ''} onChange={e => setNewTask({...newTask, endDate: e.target.value})} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Prioridad</label>
                <select className="w-full rounded-lg border border-slate-200 p-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white" value={newTask.priority} onChange={e => setNewTask({...newTask, priority: e.target.value as TaskPriority})}>
                  <option value="Baja">Baja</option>
                  <option value="Media">Media</option>
                  <option value="Alta">Alta</option>
                </select>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 transition-colors">Cancelar</button>
                <button type="submit" className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-md transition-all">Crear Tarea</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Reabrir Tarea */}
      {confirmReopenTaskObj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-85/50">
              <h3 className="text-md font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="text-blue-500" size={18} /> ¿Reabrir Tarea?
              </h3>
              <button onClick={() => setConfirmReopenTaskObj(null)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
                ¿Estás seguro de que deseas reabrir la tarea <strong>{confirmReopenTaskObj.title}</strong>? Se moverá de nuevo a la columna <strong>"Por hacer"</strong> y conservará toda su información previa.
              </p>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setConfirmReopenTaskObj(null)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">Cancelar</button>
                <button 
                  type="button" 
                  onClick={() => {
                    if (confirmReopenTaskObj) {
                      reopenTask(confirmReopenTaskObj.id);
                      setTasks(getTasksByUser());
                      setConfirmReopenTaskObj(null);
                    }
                  }} 
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow-md transition-all"
                >
                  Reabrir Tarea
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}