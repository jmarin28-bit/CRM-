// pages/Pipeline.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  useDroppable,
} from '@dnd-kit/core';
import { 
  SortableContext, 
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  Plus, 
  Search, 
  Calendar, 
  DollarSign, 
  Building2,
  Trash2,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
  User as UserIcon,
  Filter as FilterIcon,
  MoreVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  OpportunityV2, 
  OpportunityStage, 
  AccountV2, 
  ContactV2, 
  CRMUser,
  CurrencyOption,
  PipelineStage
} from '../types';
import { addDaysLocal } from '../services/dates';
import {
  listOpportunitiesByUser,
  updateOpportunityStage,
  deleteOpportunity,
  listAccountsByUser,
  listContactsByUser,
  getStages,
  listUsers,
  updateOpportunity,
  createOpportunity,
  listQuotesByUser
} from '../services/storage';

import {
  getDirectorDashboard,
  getOpportunityHealthMetrics,
  isOpenStage,
  toCOP,
  BUSINESS_RULES
} from '../services/analytics';

// --- Components ---

interface OpportunityCardProps {
  opportunity: OpportunityV2;
  account?: AccountV2;
  contact?: ContactV2;
  onClick: (opp: OpportunityV2) => void;
  onDelete: (id: string) => void;
}

const OpportunityCard: React.FC<OpportunityCardProps> = ({ 
  opportunity, 
  account, 
  contact, 
  onClick,
  onDelete 
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: opportunity.id,
    disabled: opportunity.etapa === "Ganado" || opportunity.etapa === "Perdido"
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const formatCurrency = (val: number, currency: string) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0
    }).format(val);
  };

  const accountName = account?.nombreComercial || account?.razonSocial || "Empresa no encontrada";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-500 transition-all cursor-grab active:cursor-grabbing group mb-3`}
      {...attributes}
      {...listeners}
      onClickCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button')?.className.includes('hover:text-red-500')) {
          return;
        }
        // Prevent click if dragging
        if (transform && (Math.abs(transform.x) > 5 || Math.abs(transform.y) > 5)) {
          e.stopPropagation();
          return;
        }
        onClick(opportunity);
      }}
    >
      <div className="flex justify-between items-start mb-2">
        <h4 className="font-semibold text-slate-800 dark:text-slate-100 text-sm line-clamp-2 leading-snug">
          {opportunity.titulo}
        </h4>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onDelete(opportunity.id);
          }}
          className="text-slate-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="space-y-2 mt-3">
        <div className="flex items-center text-xs text-slate-500 dark:text-slate-400">
          <Building2 size={12} className="mr-2 shrink-0" />
          <span className="truncate">{accountName}</span>
        </div>
        <div className="flex items-center text-sm font-bold text-slate-700 dark:text-slate-200">
          <DollarSign size={14} className="mr-1 text-emerald-500" />
          {formatCurrency(opportunity.valor, opportunity.moneda)}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center text-[10px] uppercase font-bold tracking-wider">
        <div className="flex items-center text-slate-400">
          <Clock size={10} className="mr-1" />
          {new Date(opportunity.fechaEstimadaCierre).toLocaleDateString()}
        </div>
        <div className={`px-2 py-0.5 rounded-full ${opportunity.probabilidad >= 70 ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
          {opportunity.probabilidad}%
        </div>
      </div>
    </div>
  );
};

interface ColumnProps {
  stage: PipelineStage;
  opportunities: OpportunityV2[];
  accounts: AccountV2[];
  contacts: ContactV2[];
  quotes: any[];
  onCardClick: (opp: OpportunityV2) => void;
  onDeleteCard: (id: string) => void;
  stageMetrics?: { totalValueCOP: number }; // Calculado sobre las tarjetas visibles
}

const Column: React.FC<ColumnProps> = ({
  stage,
  opportunities,
  accounts,
  contacts,
  quotes,
  onCardClick,
  onDeleteCard,
  stageMetrics
}) => {
  const { setNodeRef } = useDroppable({
    id: stage.id,
  });
  // El monto se muestra formateado como COP, así que hay que sumarlo en COP.
  // El fallback antes hacía `acc + curr.valor` a secas: una oportunidad en USD
  // se sumaba como si fueran pesos (1.000 USD contaban como $1.000 COP).
  const totalValueCOP =
    stageMetrics?.totalValueCOP ??
    opportunities.reduce((acc, curr) => acc + toCOP(curr.valor, curr.moneda), 0);

  return (
    <div 
      ref={setNodeRef}
      className="flex flex-col w-72 min-w-[288px] h-full bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden"
    >
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-800/50">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${stage.color.replace('bg-', 'bg-')}`}></span>
            <h3 className="font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider text-xs">
              {stage.name}
            </h3>
          </div>
          <span className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[10px] px-2 py-0.5 rounded-full font-bold">
            {opportunities.length}
          </span>
        </div>
        <div className="text-xs font-medium text-slate-400 mt-1">
          {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalValueCOP)}
        </div>
      </div>

      <div className="flex-1 p-3 overflow-y-auto no-scrollbar">
        <SortableContext 
          id={stage.id} 
          items={opportunities.map(o => o.id)} 
          strategy={verticalListSortingStrategy}
        >
          {opportunities.map(opp => {
            const assocQuote = quotes.find(q => q.id === opp.quoteId) || quotes.find(q => q.opportunityId === opp.id);
            const resolvedAccount = accounts.find(a => a.id === opp.accountId) || 
                                    (assocQuote ? accounts.find(a => a.id === assocQuote.accountId) : undefined);
            const resolvedContact = contacts.find(c => c.id === opp.contactId) || 
                                    (assocQuote ? contacts.find(c => c.id === assocQuote.contactId) : undefined);
            return (
              <OpportunityCard 
                key={opp.id} 
                opportunity={opp} 
                account={resolvedAccount}
                contact={resolvedContact}
                onClick={onCardClick}
                onDelete={onDeleteCard}
              />
            );
          })}
        </SortableContext>
      </div>
    </div>
  );
};

// --- Main Page ---

const Pipeline: React.FC<{ activeUser: CRMUser }> = ({ activeUser }) => {
  const [opportunities, setOpportunities] = useState<OpportunityV2[]>([]);
  const [accounts, setAccounts] = useState<AccountV2[]>([]);
  const [contacts, setContacts] = useState<ContactV2[]>([]);
  const [users, setUsers] = useState<CRMUser[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

  const [selectedOpp, setSelectedOpp] = useState<OpportunityV2 | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLostModalOpen, setIsLostModalOpen] = useState(false);
  const [isWonModalOpen, setIsWonModalOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Alta de oportunidad desde el propio embudo. El botón "NUEVO" existía pero
  // su onClick estaba vacío (`// handle create new`): se veía habilitado, se
  // podía hacer clic y no pasaba absolutamente nada.
  const emptyNewOpp = {
    titulo: "",
    accountId: "",
    contactId: "",
    valor: "",
    moneda: "COP" as CurrencyOption,
    etapa: "Contactado" as OpportunityStage,
    fechaEstimadaCierre: addDaysLocal(30),
    ownerId: "",
  };
  const [isNewOppOpen, setIsNewOppOpen] = useState(false);
  const [newOpp, setNewOpp] = useState(emptyNewOpp);
  const [newOppError, setNewOppError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const [quotes, setQuotes] = useState<any[]>([]);

  useEffect(() => {
    const data = listOpportunitiesByUser(activeUser);
    setOpportunities(data || []);
    setAccounts(listAccountsByUser(activeUser) || []);
    setContacts(listContactsByUser(activeUser) || []);
    setUsers(listUsers() || []);
    setStages(getStages() || []);
    setQuotes(listQuotesByUser(activeUser) || []);
    setLoading(false);
  }, [refresh, activeUser]);


  const filteredOpportunities = useMemo(() => {
    return opportunities.filter(opp => {
      const matchSearch = opp.titulo.toLowerCase().includes(searchTerm.toLowerCase());
      const matchOwner = ownerFilter === "all" || opp.ownerId === ownerFilter;
      
      // Won logic: Only show last 7 days in board
      if (opp.etapa === "Ganado") {
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        return matchSearch && matchOwner && new Date(opp.updatedAt) >= lastWeek;
      }

      return matchSearch && matchOwner;
    });
  }, [opportunities, searchTerm, ownerFilter]);

  // Métricas por etapa calculadas sobre lo que el tablero REALMENTE muestra.
  //
  // Antes venían de getOpportunitiesByStage(), que lee todas las oportunidades
  // del usuario sin aplicar los filtros de la vista. Resultado: al filtrar por
  // asesor o buscar por texto, el contador de tarjetas bajaba pero el dinero se
  // quedaba igual. La columna "Ganado" era el caso más visible: solo muestra los
  // últimos 7 días, pero el monto sumaba el histórico completo.
  //
  // La conversión de moneda sigue centralizada en analytics (toCOP/TRM_DEFAULT),
  // que es lo que hay que respetar; lo que cambia es el conjunto de datos.
  const stageMetricsMap = useMemo(() => {
    const map = new Map<string, { totalValueCOP: number }>();
    filteredOpportunities.forEach((opp) => {
      const prev = map.get(opp.etapa)?.totalValueCOP ?? 0;
      map.set(opp.etapa, { totalValueCOP: prev + toCOP(opp.valor, opp.moneda) });
    });
    return map;
  }, [filteredOpportunities]);

  // "Valor Pipeline" = negocio todavía en juego. Ganado y Perdido ya están
  // cerrados, así que inflaban el número con plata que no se puede ganar (o que
  // ya se ganó y se contabiliza aparte en "Ganados Históricos").
  const pipelineValueCOP = useMemo(() => {
    return Array.from(stageMetricsMap.entries())
      .filter(([stage]) => isOpenStage(stage))
      .reduce((sum, [, metric]) => sum + metric.totalValueCOP, 0);
  }, [stageMetricsMap]);

  const wonCounter = useMemo(() => {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    return opportunities.filter(o => o.etapa === "Ganado" && new Date(o.updatedAt) < lastWeek).length;
  }, [opportunities]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) {
      setActiveId(null);
      return;
    }

    const overId = over.id as string;
    const activeId = active.id as string;

    let destinationStageName: string | null = null;

    // Caso A: Se soltó sobre una columna (su id es el id del stage)
    const droppedOnStage = stages.find(s => s.id === overId);
    if (droppedOnStage) {
      destinationStageName = droppedOnStage.name;
    } else {
      // Caso B: Se soltó sobre otra tarjeta (overId es el id de la oportunidad)
      // En lugar de usar la etapa de esa tarjeta, buscar en cuál columna/etapa debería estar
      const targetOpp = opportunities.find(o => o.id === overId);
      if (targetOpp) {
        // CORRECCIÓN: Usar la etapa de filtrado actual (cuál columna está mostrando esta tarjeta)
        // No usar targetOpp.etapa porque podría estar desincronizada
        // En su lugar, buscar el stage cuya columna contiene esta tarjeta
        const containingStage = stages.find(s => {
          const stageOpps = filteredOpportunities.filter(o => o.etapa === s.name);
          return stageOpps.some(o => o.id === overId);
        });
        if (containingStage) {
          destinationStageName = containingStage.name;
        } else {
          // Fallback: usar la etapa de la oportunidad si no la encontramos en las columnas visibles
          destinationStageName = targetOpp.etapa;
        }
      }
    }

    if (destinationStageName) {
      const opp = opportunities.find(o => o.id === activeId);
      if (opp && opp.etapa !== destinationStageName) {
        if (destinationStageName === "Perdido") {
          setSelectedOpp(opp);
          setIsLostModalOpen(true);
        } else if (destinationStageName === "Ganado") {
          setSelectedOpp(opp);
          setIsWonModalOpen(true);
        } else {
          updateOpportunityStage(activeId, destinationStageName as OpportunityStage);
          setRefresh(prev => prev + 1);
        }
      }
    }

    setActiveId(null);
  };

  const handleSaveWon = () => {
    if (!selectedOpp) return;
    updateOpportunityStage(selectedOpp.id, "Ganado");
    setIsWonModalOpen(false);
    setSelectedOpp(null);
    setIsDrawerOpen(false);
    setRefresh(prev => prev + 1);
  };

  const handleStageChangeDirectly = (newStage: OpportunityStage) => {
    if (!selectedOpp) return;
    if (selectedOpp.etapa === newStage) return;

    if (newStage === "Perdido") {
      setIsLostModalOpen(true);
    } else if (newStage === "Ganado") {
      setIsWonModalOpen(true);
    } else {
      updateOpportunityStage(selectedOpp.id, newStage);
      setRefresh(prev => prev + 1);
      setSelectedOpp(prev => prev ? { ...prev, etapa: newStage } : null);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    // Optional: add visual feedback during drag over
  };

  const handleDeleteOpp = (id: string) => {
    console.log("handleDeleteOpp llamado con ID:", id);
    setDeleteConfirmId(id);
  };

  const confirmDelete = () => {
    console.log("confirmDelete ejecutado para ID:", deleteConfirmId);
    if (!deleteConfirmId) return;
    const success = deleteOpportunity(deleteConfirmId);
    console.log("Resultado de deleteOpportunity:", success);
    
    // Fuerza la recarga y cierra el drawer si corresponde
    if (selectedOpp?.id === deleteConfirmId) {
      console.log("Cerrando drawer de la oportunidad eliminada.");
      setSelectedOpp(null);
      setIsDrawerOpen(false);
    }
    setRefresh(prev => prev + 1);
    setDeleteConfirmId(null);
  };

  const handleSaveLost = () => {
    if (!selectedOpp) return;
    const updated = {
      ...selectedOpp,
      etapa: "Perdido" as OpportunityStage,
      perdidoMotivo: lostReason,
      perdidoNotas: lostNotes,
      updatedAt: new Date().toISOString()
    };
    updateOpportunity(updated);
    setIsLostModalOpen(false);
    setLostReason("");
    setLostNotes("");
    setSelectedOpp(null);
    setRefresh(prev => prev + 1);
  };

  const activeOpportunity = useMemo(() =>
    opportunities.find(o => o.id === activeId),
    [opportunities, activeId]
  );

  // Solo los contactos de la cuenta elegida: ofrecer todos permitiría guardar
  // una oportunidad cuyo contacto pertenece a otra empresa.
  const newOppContacts = useMemo(
    () => contacts.filter(c => c.accountId === newOpp.accountId),
    [contacts, newOpp.accountId]
  );

  const openNewOpp = () => {
    setNewOpp({ ...emptyNewOpp, ownerId: activeUser?.id || "" });
    setNewOppError("");
    setIsNewOppOpen(true);
  };

  const handleCreateOpportunity = () => {
    if (!newOpp.titulo.trim()) return setNewOppError("El título es obligatorio.");
    if (!newOpp.accountId) return setNewOppError("Seleccioná la empresa.");

    // El valor se valida en vez de dejar que un texto vacío o con letras entre
    // como NaN: una oportunidad con valor NaN envenena el total del embudo,
    // que pasa a mostrarse entero como NaN.
    const valor = parseFloat(newOpp.valor);
    if (!Number.isFinite(valor) || valor < 0) {
      return setNewOppError("El valor debe ser un número mayor o igual a cero.");
    }

    try {
      createOpportunity({
        titulo: newOpp.titulo.trim(),
        accountId: newOpp.accountId,
        contactId: newOpp.contactId,
        valor,
        moneda: newOpp.moneda,
        etapa: newOpp.etapa,
        fechaEstimadaCierre: newOpp.fechaEstimadaCierre,
        ownerId: newOpp.ownerId || undefined,
      });
      setIsNewOppOpen(false);
      setRefresh(prev => prev + 1);
    } catch (err: any) {
      setNewOppError(err?.message || "No se pudo crear la oportunidad.");
    }
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center h-screen bg-white dark:bg-slate-900">
      <div className="text-slate-400 animate-pulse font-medium">Cargando pipeline...</div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-6">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-tighter">
                Pipeline <span className="text-blue-600">Ventas</span>
              </h1>
              <p className="text-sm text-slate-500 font-medium">Gestión visual del embudo comercial</p>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Buscar negociaciones..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-64"
                />
              </div>
              
              <div className="flex items-center bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-3">
                <FilterIcon size={14} className="text-slate-400 mr-2" />
                <select 
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  className="bg-transparent py-2 text-sm text-slate-600 dark:text-slate-300 focus:outline-none min-w-[120px]"
                >
                  <option value="all">Todos los dueños</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={openNewOpp}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all active:scale-95"
              >
                <Plus size={18} />
                NUEVO
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between overflow-x-auto no-scrollbar py-2">
            <div className="flex items-center gap-6">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Negociaciones</span>
                <span className="text-xl font-bold text-slate-800 dark:text-white">
                  {filteredOpportunities.length}
                </span>
              </div>
              <div className="w-[1px] h-8 bg-slate-200 dark:bg-slate-800"></div>
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor Pipeline</span>
                <span className="text-xl font-bold text-emerald-500">
                  {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(pipelineValueCOP)}
                </span>
              </div>
              {wonCounter > 0 && (
                <>
                  <div className="w-[1px] h-8 bg-slate-200 dark:bg-slate-800"></div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ganados Históricos</span>
                    <span className="text-lg font-bold text-slate-700 dark:text-slate-300">+{wonCounter}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Pipeline Board */}
      <main className="flex-1 overflow-x-auto p-6 flex gap-6 items-start">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {stages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              opportunities={filteredOpportunities.filter(o => o.etapa === stage.name)}
              accounts={accounts}
              contacts={contacts}
              quotes={quotes}
              onCardClick={(opp) => {
                setSelectedOpp(opp);
                setIsDrawerOpen(true);
              }}
              onDeleteCard={handleDeleteOpp}
              stageMetrics={stageMetricsMap.get(stage.name)}
            />
          ))}

          <DragOverlay>
            {activeId && activeOpportunity ? (
              <div className="rotate-2 scale-105 opacity-90 shadow-2xl">
                {(() => {
                  const assocQuote = quotes.find(q => q.id === activeOpportunity.quoteId) || quotes.find(q => q.opportunityId === activeOpportunity.id);
                  const resolvedAccount = accounts.find(a => a.id === activeOpportunity.accountId) || 
                                          (assocQuote ? accounts.find(a => a.id === assocQuote.accountId) : undefined);
                  const resolvedContact = contacts.find(c => c.id === activeOpportunity.contactId) || 
                                          (assocQuote ? contacts.find(c => c.id === assocQuote.contactId) : undefined);
                  return (
                    <OpportunityCard 
                      opportunity={activeOpportunity}
                      account={resolvedAccount}
                      contact={resolvedContact}
                      onClick={() => {}}
                      onDelete={() => {}}
                    />
                  );
                })()}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      {/* Drawers and Modals */}
      <AnimatePresence>
        {isDrawerOpen && selectedOpp && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed top-0 right-0 h-full w-[450px] bg-white dark:bg-slate-900 shadow-2xl z-50 p-8 overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-8">
                <select
                  value={selectedOpp.etapa}
                  onChange={(e) => handleStageChangeDirectly(e.target.value as OpportunityStage)}
                  disabled={selectedOpp.etapa === "Ganado" || selectedOpp.etapa === "Perdido"}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider border outline-none focus:ring-2 focus:ring-blue-500/20 bg-white dark:bg-slate-800 disabled:opacity-80 disabled:cursor-not-allowed ${
                    stages.find(s => s.name === selectedOpp.etapa)?.color || 'bg-slate-100'
                  }`}
                >
                  {stages.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
                <button 
                  onClick={() => setIsDrawerOpen(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                >
                  <X />
                </button>
              </div>

              <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-6 leading-tight">
                {selectedOpp.titulo}
              </h2>

              <div className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Cliente</label>
                  <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                    <Building2 className="text-blue-500" />
                    <div>
                      {(() => {
                        const assocQuote = quotes.find(q => q.id === selectedOpp.quoteId) || quotes.find(q => q.opportunityId === selectedOpp.id);
                        const resolvedAccount = accounts.find(a => a.id === selectedOpp.accountId) || 
                                                (assocQuote ? accounts.find(a => a.id === assocQuote.accountId) : undefined);
                        return (
                          <>
                            <div className="font-bold text-slate-700 dark:text-slate-200">
                              {resolvedAccount ? (resolvedAccount.nombreComercial || resolvedAccount.razonSocial) : "Empresa no encontrada"}
                            </div>
                            {resolvedAccount?.razonSocial && resolvedAccount.nombreComercial && resolvedAccount.razonSocial !== resolvedAccount.nombreComercial && (
                              <div className="text-xs text-slate-500">
                                {resolvedAccount.razonSocial}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Valor</label>
                    <div className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                       <span className="text-emerald-500">$</span>
                       {new Intl.NumberFormat('es-CO').format(selectedOpp.valor)}
                       <span className="text-sm font-normal text-slate-400">{selectedOpp.moneda}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Probabilidad</label>
                    <div className="text-xl font-black text-slate-800 dark:text-white">
                      {selectedOpp.probabilidad}%
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Cierre Estimado</label>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-medium">
                    <Calendar size={18} />
                    {new Date(selectedOpp.fechaEstimadaCierre).toLocaleDateString(undefined, { 
                      year: 'numeric', month: 'long', day: 'numeric' 
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-2">Propietario</label>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-medium">
                    <UserIcon size={18} />
                    {users.find(u => u.id === selectedOpp.ownerId)?.name || 'Sin asignar'}
                  </div>
                </div>

                                {(() => {
                  const associatedQuote = quotes.find(q => q.id === selectedOpp.quoteId) || quotes.find(q => q.opportunityId === selectedOpp.id);
                  if (!associatedQuote) return null;

                  const quoteAccount = accounts.find(a => a.id === associatedQuote.accountId);
                  const quoteContact = contacts.find(c => c.id === associatedQuote.contactId);

                  return (
                    <div className="mt-4 p-4 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl">
                      <h4 className="text-xs font-black uppercase text-blue-700 dark:text-blue-400 tracking-wider mb-3">Cotización Asociada</h4>
                      <div className="space-y-2 text-slate-700 dark:text-slate-300 text-sm">
                        <div>
                          <span className="font-semibold text-slate-500">Número de cotización: </span>
                          <span className="font-bold text-slate-900 dark:text-white">{associatedQuote.quoteNumber}</span>
                        </div>
                        {quoteAccount && (
                          <div>
                            <span className="font-semibold text-slate-500">Empresa: </span>
                            <span className="font-bold text-slate-900 dark:text-white">{quoteAccount.nombreComercial || quoteAccount.razonSocial}</span>
                          </div>
                        )}
                        {quoteContact && (
                          <div>
                            <span className="font-semibold text-slate-500">Contacto: </span>
                            <span className="font-bold text-slate-900 dark:text-white">{quoteContact.fullName}</span>
                          </div>
                        )}
                        <div>
                          <span className="font-semibold text-slate-500">Estado: </span>
                          <span className="capitalize font-bold text-slate-900 dark:text-white">{associatedQuote.status.replaceAll('_', ' ')}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Moneda: </span>
                          <span className="font-bold text-slate-900 dark:text-white">{associatedQuote.currency}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Valor Total Cotizado: </span>
                          <span className="font-bold text-emerald-600">
                            {new Intl.NumberFormat('es-CO', { style: 'currency', currency: associatedQuote.currency, maximumFractionDigits: associatedQuote.currency === 'USD' ? 2 : 0 }).format(associatedQuote.total)}
                          </span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Cantidad de ítems: </span>
                          <span className="font-bold">{associatedQuote.items?.length || 0}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500">Fecha de Creación: </span>
                          <span>{associatedQuote.createdAt ? new Date(associatedQuote.createdAt).toLocaleDateString('es-CO') : associatedQuote.issueDate}</span>
                        </div>
                        {associatedQuote.sentAt && (
                          <div>
                            <span className="font-semibold text-slate-500">Fecha de Envío: </span>
                            <span>{new Date(associatedQuote.sentAt).toLocaleDateString('es-CO')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="mt-12 pt-8 border-t border-slate-100 dark:border-slate-800 flex gap-4">
                <button 
                  onClick={() => {
                    handleDeleteOpp(selectedOpp.id);
                  }}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm text-red-500 border border-red-500/20 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  ELIMINAR
                </button>
                <button 
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm bg-blue-600 text-white shadow-lg shadow-blue-600/25 hover:bg-blue-700 transition-colors"
                >
                  CERRAR
                </button>
              </div>
            </motion.div>
          </>
        )}

        {isLostModalOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
              onClick={() => setIsLostModalOpen(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl relative z-10"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center text-rose-500">
                      <AlertCircle />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tighter">Oportunidad Perdida</h3>
                      <p className="text-xs text-slate-500">Entender el porqué nos ayudará a mejorar</p>
                    </div>
                  </div>
                  <button onClick={() => setIsLostModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold p-2"><X /></button>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-3">Motivo de la pérdida</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['Precio alto', 'Competencia', 'Sin presupuesto', 'Sin respuesta', 'Proyecto cancelado', 'Otro'].map(reason => (
                        <button
                          key={reason}
                          onClick={() => setLostReason(reason)}
                          className={`py-3 px-4 rounded-xl text-sm font-bold text-left transition-all border ${
                            lostReason === reason 
                              ? 'bg-rose-500 border-rose-600 text-white shadow-lg shadow-rose-500/30' 
                              : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-3">Detalles adicionales</label>
                    <textarea 
                      value={lostNotes}
                      onChange={(e) => setLostNotes(e.target.value)}
                      placeholder="Escribe aquí lo sucedido..."
                      className="w-full h-32 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>
                </div>

                <div className="mt-8 flex gap-3">
                  <button 
                    onClick={() => setIsLostModalOpen(false)}
                    className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    CANCELAR
                  </button>
                  <button 
                    disabled={!lostReason}
                    onClick={handleSaveLost}
                    className="flex-[2] py-4 px-6 rounded-2xl font-bold text-sm bg-rose-500 text-white shadow-lg shadow-rose-500/25 hover:bg-rose-600 transition-colors disabled:opacity-50"
                  >
                    GUARDAR COMO PERDIDO
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isWonModalOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
              onClick={() => setIsWonModalOpen(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-800 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl relative z-10 p-8 border border-slate-100 dark:border-slate-700"
            >
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-500 mx-auto mb-6">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tighter mb-2">¿Marcar como Ganado?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                  ¿Estás seguro de que deseas marcar la negociación <strong>{selectedOpp?.titulo}</strong> como ganada? Esta acción registrará el cierre exitoso del trato.
                </p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setIsWonModalOpen(false)}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  CANCELAR
                </button>
                <button 
                  onClick={handleSaveWon}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-600 transition-colors"
                >
                  SÍ, GANADO
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isNewOppOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
              onClick={() => setIsNewOppOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl relative z-10 border border-slate-100 dark:border-slate-700"
            >
              <div className="flex items-center justify-between px-8 pt-8 pb-4">
                <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tighter">Nueva Negociación</h3>
                <button onClick={() => setIsNewOppOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold p-2"><X size={20} /></button>
              </div>

              <div className="px-8 pb-8 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Título *</label>
                  <input
                    autoFocus
                    value={newOpp.titulo}
                    onChange={(e) => setNewOpp({ ...newOpp, titulo: e.target.value })}
                    placeholder="Ej: Suministro de reactivos 2026"
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-xl p-3 text-sm bg-slate-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Empresa *</label>
                    <select
                      value={newOpp.accountId}
                      onChange={(e) => setNewOpp({ ...newOpp, accountId: e.target.value, contactId: "" })}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl p-3 text-sm bg-slate-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                    >
                      <option value="">Seleccionar…</option>
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>{a.nombreComercial || a.razonSocial}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contacto</label>
                    <select
                      value={newOpp.contactId}
                      disabled={!newOpp.accountId}
                      onChange={(e) => setNewOpp({ ...newOpp, contactId: e.target.value })}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl p-3 text-sm bg-slate-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold disabled:opacity-50"
                    >
                      <option value="">{newOpp.accountId ? "Sin contacto" : "Elegí una empresa"}</option>
                      {newOppContacts.map(c => (
                        <option key={c.id} value={c.id}>{c.fullName}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 flex flex-col gap-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Valor *</label>
                    <input
                      type="number"
                      min="0"
                      value={newOpp.valor}
                      onChange={(e) => setNewOpp({ ...newOpp, valor: e.target.value })}
                      placeholder="0"
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl p-3 text-sm bg-slate-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Moneda</label>
                    <select
                      value={newOpp.moneda}
                      onChange={(e) => setNewOpp({ ...newOpp, moneda: e.target.value as CurrencyOption })}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl p-3 text-sm bg-slate-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                    >
                      <option value="COP">COP</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Etapa</label>
                    <select
                      value={newOpp.etapa}
                      onChange={(e) => setNewOpp({ ...newOpp, etapa: e.target.value as OpportunityStage })}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl p-3 text-sm bg-slate-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                    >
                      {stages.filter(s => isOpenStage(s.name)).map(s => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cierre estimado</label>
                    <input
                      type="date"
                      value={newOpp.fechaEstimadaCierre}
                      onChange={(e) => setNewOpp({ ...newOpp, fechaEstimadaCierre: e.target.value })}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl p-3 text-sm bg-slate-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                    />
                  </div>
                </div>

                {activeUser?.role === 'director' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Asesor responsable</label>
                    <select
                      value={newOpp.ownerId}
                      onChange={(e) => setNewOpp({ ...newOpp, ownerId: e.target.value })}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl p-3 text-sm bg-slate-50 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 font-bold"
                    >
                      <option value="">Dueño de la empresa</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {newOppError && (
                  <p className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-900/30 rounded-xl px-4 py-3">{newOppError}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setIsNewOppOpen(false)}
                    className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={handleCreateOpportunity}
                    className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm bg-blue-600 text-white shadow-lg shadow-blue-500/25 hover:bg-blue-700 transition-colors"
                  >
                    CREAR
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {deleteConfirmId && (
          <div className="fixed inset-0 flex items-center justify-center z-[110] p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
              onClick={() => setDeleteConfirmId(null)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-800 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl relative z-10 p-8 border border-slate-100 dark:border-slate-700"
            >
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center text-red-500 mx-auto mb-6">
                  <Trash2 size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tighter mb-2">¿Eliminar Oportunidad?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                  Esta acción eliminará de forma permanente la oportunidad del embudo. Si está asociada a una cotización, la cotización no se borrará, pero perderá su enlace.
                </p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setDeleteConfirmId(null)}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  CANCELAR
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 py-4 px-6 rounded-2xl font-bold text-sm bg-red-500 text-white shadow-lg shadow-red-500/25 hover:bg-red-600 transition-colors"
                >
                  ELIMINAR
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Pipeline;