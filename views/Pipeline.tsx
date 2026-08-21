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
  MoreVertical,
  Activity as ActivityIcon,
  Bell,
  AlertTriangle,
  FileText,
  Eye,
  Pencil,
  Printer,
  Copy,
  Percent,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  History,
  Gauge
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  OpportunityV2,
  OpportunityStage,
  AccountV2,
  ContactV2,
  CRMUser,
  CurrencyOption,
  PipelineStage,
  ActivityV2,
  QuoteV2
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
  listQuotesByUser,
  listActivitiesByUser,
  createActivity,
  completeFollowUpActivity,
  getTRM
} from '../services/storage';

import {
  getDirectorDashboard,
  getOpportunityHealthMetrics,
  isOpenStage,
  toCOP,
  BUSINESS_RULES
} from '../services/analytics';

// El contexto comercial de cada oportunidad (empresa, contacto, cotización,
// última gestión, próxima acción, alertas) se calcula una sola vez en un módulo
// puro y de ahí lo consumen la tarjeta y el panel. Así el tablero y el panel no
// pueden contradecirse, y cuando lleguen las fases de salud, análisis IA y
// Director Comercial reutilizan exactamente el mismo cálculo.
import {
  buildOpportunityContextMap,
  quoteStatusLabel,
  quoteStatusBadge,
  type OpportunityContext
} from '../services/opportunityContext';
import { requestQuoteAction } from '../services/quoteNavigation';

// La salud comercial la calcula buildOpportunityContext en la misma pasada, así
// que acá solo se importa cómo pintarla. El umbral de la tarjeta y las clases de
// color viven en el módulo para que la tarjeta y el panel no puedan discrepar.
import {
  CARD_SCORE_THRESHOLD,
  HEALTH_BAND_CLASS,
  HEALTH_BAR_CLASS,
  healthSentence
} from '../services/opportunityHealth';

// La bitácora se dibuja con el mismo componente que usa el historial de
// contactos, y las reglas del formulario (fechas, validaciones) viven en un
// módulo puro que se prueba en Node.
import ActivityTimeline from '../components/ActivityTimeline';
import {
  ACTIVITY_TYPES,
  FOLLOW_UP_PRESETS,
  FOLLOW_UP_TYPE,
  presetDatetimeValue,
  validateActivityDraft,
  type ActivityDraft
} from '../services/activityDraft';

// --- Components ---

// Formato de moneda compartido por la tarjeta y el panel: el mismo valor no
// puede verse distinto en dos lugares de la misma pantalla.
const formatMoney = (val: number, currency: string) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: currency || 'COP',
    maximumFractionDigits: currency === 'USD' ? 2 : 0
  }).format(Number.isFinite(val) ? val : 0);

const formatCOP = (val: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number.isFinite(val) ? val : 0);

/** Iniciales del asesor: cabe en la tarjeta donde el nombre completo no cabría. */
const initialsOf = (name: string): string => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

interface OpportunityCardProps {
  /**
   * Contexto ya calculado. La tarjeta no vuelve a cruzar datos: solo dibuja.
   * Cualquier regla de negocio (qué es "actividad reciente", qué cuenta como
   * alerta) vive en opportunityContext.ts, no acá.
   */
  ctx: OpportunityContext;
  /** Color de la columna, para el punto de etapa. */
  stageColor?: string;
  onClick: (opp: OpportunityV2) => void;
  onDelete: (id: string) => void;
}

const OpportunityCard: React.FC<OpportunityCardProps> = ({
  ctx,
  stageColor,
  onClick,
  onDelete
}) => {
  const opportunity = ctx.opportunity;

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

  // La fecha de cierre solo se pinta de rojo/ámbar cuando el negocio sigue
  // abierto: en una oportunidad ya ganada, "venció hace 20 días" no es un
  // problema, es simplemente historia.
  const closeTone = !ctx.isOpen
    ? 'text-slate-400'
    : ctx.daysToClose < 0
      ? 'text-rose-500'
      : ctx.daysToClose <= 7
        ? 'text-amber-500'
        : 'text-slate-400';

  // Los tres indicadores del enunciado. Cada uno lleva `title` con el porqué,
  // así el detalle está disponible sin ocupar espacio en la tarjeta.
  const alertTone = ctx.hasRisk ? 'text-rose-500' : 'text-amber-500';
  const followUpTone =
    ctx.nextAction?.state === 'vencido'
      ? 'text-rose-500'
      : ctx.nextAction?.state === 'hoy'
        ? 'text-amber-500'
        : 'text-blue-500';

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
      <div className="flex justify-between items-start gap-2 mb-2">
        <div className="flex items-start gap-2 min-w-0">
          {/* Punto de etapa: repite el color de la columna sin gastar una línea
              de texto. Al arrastrar, la tarjeta sale de su columna y este punto
              es lo único que sigue diciendo de dónde viene. */}
          <span
            className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${stageColor || 'bg-slate-300'}`}
            title={`Etapa: ${opportunity.etapa}`}
          />
          <h4 className="font-semibold text-slate-800 dark:text-slate-100 text-sm line-clamp-2 leading-snug">
            {opportunity.titulo}
          </h4>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Los iconos de lucide no aceptan `title`, así que el tooltip va en
              un <span> envolvente. De paso agranda el área sobre la que hay que
              parar el cursor, que con 13px sería incómoda. */}
          {ctx.hasRecentActivity && (
            <span
              className="flex items-center"
              title={
                ctx.daysSinceLastActivity === 0
                  ? 'Gestión registrada hoy'
                  : `Última gestión hace ${ctx.daysSinceLastActivity} días`
              }
            >
              <ActivityIcon size={13} className="text-emerald-500" />
            </span>
          )}
          {ctx.hasPendingFollowUp && ctx.nextAction && (
            <span
              className="flex items-center"
              title={`Seguimiento: ${ctx.nextAction.label} · ${ctx.nextAction.type}`}
            >
              <Bell size={13} className={followUpTone} />
            </span>
          )}
          {ctx.alerts.length > 0 && (
            <span
              className="flex items-center"
              title={ctx.alerts.map(a => a.label).join('\n')}
            >
              <AlertTriangle size={13} className={alertTone} />
            </span>
          )}
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
      </div>

      <div className="space-y-1.5 mt-3">
        <div className="flex items-center text-xs text-slate-500 dark:text-slate-400">
          <Building2 size={12} className="mr-2 shrink-0" />
          <span className="truncate" title={ctx.accountName}>
            {ctx.accountName || 'Sin empresa'}
          </span>
        </div>
        {ctx.contactName && (
          <div className="flex items-center text-xs text-slate-400 dark:text-slate-500">
            <UserIcon size={12} className="mr-2 shrink-0" />
            <span className="truncate" title={ctx.contactName}>{ctx.contactName}</span>
          </div>
        )}
        <div className="flex items-center text-sm font-bold text-slate-700 dark:text-slate-200 pt-0.5">
          <DollarSign size={14} className="mr-1 text-emerald-500 shrink-0" />
          {formatMoney(opportunity.valor, opportunity.moneda)}
          <span className="ml-1 text-[10px] font-bold text-slate-400">{opportunity.moneda}</span>

          {/* Salud comercial, SOLO cuando está por debajo del umbral.
              Una tarjeta sana no dice nada: si las treinta gritan un número,
              ninguna se lee, y la marca dejaría de significar "mirá esta".
              El umbral y el color salen del módulo de salud, no de acá, para
              que la tarjeta y el panel no puedan pintar distinto el mismo dato.
              El detalle de por qué el puntaje es ese está en el panel. */}
          {ctx.health.isScored && ctx.health.score < CARD_SCORE_THRESHOLD && (
            <span
              className={`ml-auto shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-black ${HEALTH_BAND_CLASS[ctx.health.band]}`}
              title={`${healthSentence(ctx.health)} · ${ctx.health.bandLabel}`}
            >
              {ctx.health.score}/100
            </span>
          )}
        </div>
      </div>

      {ctx.quote && (
        <div className="mt-2.5">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${quoteStatusBadge(ctx.quote.status)}`}
            title={`Cotización ${ctx.quote.quoteNumber} · ${ctx.quoteStatusText}`}
          >
            <FileText size={9} />
            {ctx.quoteStatusText}
          </span>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center text-[10px] uppercase font-bold tracking-wider">
        <div className={`flex items-center ${closeTone}`}>
          <Clock size={10} className="mr-1" />
          {new Date(opportunity.fechaEstimadaCierre).toLocaleDateString('es-CO')}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 text-[9px] flex items-center justify-center"
            title={`Propietario: ${ctx.ownerName}`}
          >
            {initialsOf(ctx.ownerName)}
          </span>
          <span className={`px-2 py-0.5 rounded-full ${opportunity.probabilidad >= 70 ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
            {opportunity.probabilidad}%
          </span>
        </div>
      </div>
    </div>
  );
};

interface ColumnProps {
  stage: PipelineStage;
  opportunities: OpportunityV2[];
  /**
   * Contextos ya calculados, indexados por id de oportunidad. La columna ya no
   * resuelve empresa/contacto/cotización por su cuenta: esa búsqueda estaba
   * repetida cuatro veces en este archivo y cada copia podía envejecer aparte.
   */
  contextMap: Map<string, OpportunityContext>;
  onCardClick: (opp: OpportunityV2) => void;
  onDeleteCard: (id: string) => void;
  stageMetrics?: { totalValueCOP: number }; // Calculado sobre las tarjetas visibles
}

const Column: React.FC<ColumnProps> = ({
  stage,
  opportunities,
  contextMap,
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
            // El mapa se arma con TODAS las oportunidades cargadas y las de la
            // columna son un subconjunto, así que la entrada siempre existe.
            // El guard es una red por si eso cambia: mejor una tarjeta menos
            // que la pantalla entera en blanco.
            const ctx = contextMap.get(opp.id);
            if (!ctx) return null;
            return (
              <OpportunityCard
                key={opp.id}
                ctx={ctx}
                stageColor={stage.color}
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

  // Registro de gestiones desde el panel (Fase C).
  //
  // `requireFollowUp` distingue los dos botones: "Registrar gestión" guarda algo
  // que YA pasó y la fecha es opcional; "+ Crear seguimiento" agenda algo futuro
  // y sin fecha no tiene sentido. Es el mismo formulario porque en la práctica
  // el asesor escribe lo que pasó y de una vez agenda el siguiente paso; obligar
  // a llenar dos formularios haría que no agende nada.
  const emptyDraft: ActivityDraft = { type: "Llamada", description: "", followUpLocal: "" };
  const [activityDraft, setActivityDraft] = useState<ActivityDraft>(emptyDraft);
  const [isActivityFormOpen, setIsActivityFormOpen] = useState(false);
  const [requireFollowUp, setRequireFollowUp] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [showAllActivities, setShowAllActivities] = useState(false);

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

  const [quotes, setQuotes] = useState<QuoteV2[]>([]);
  // La bitácora existente. NO se crea un historial paralelo: el embudo lee las
  // mismas actividades que Contactos y AXIS.
  const [activities, setActivities] = useState<ActivityV2[]>([]);
  const [trm, setTrm] = useState<number>(0);

  useEffect(() => {
    const data = listOpportunitiesByUser(activeUser);
    setOpportunities(data || []);
    setAccounts(listAccountsByUser(activeUser) || []);
    setContacts(listContactsByUser(activeUser) || []);
    setUsers(listUsers() || []);
    setStages(getStages() || []);
    setQuotes(listQuotesByUser(activeUser) || []);
    setActivities(listActivitiesByUser(activeUser) || []);
    setTrm(getTRM());
    setLoading(false);
  }, [refresh, activeUser]);

  // Un solo cruce de datos para todo el tablero. Se calcula sobre TODAS las
  // oportunidades (no sobre las filtradas) para que el panel siga funcionando
  // aunque el asesor cambie el filtro con el panel abierto.
  const contextMap = useMemo(
    () =>
      buildOpportunityContextMap(opportunities, {
        accounts,
        contacts,
        quotes,
        activities,
        users: users.map(u => ({ id: u.id, name: u.name })),
        trm
      }),
    [opportunities, accounts, contacts, quotes, activities, users, trm]
  );


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

  // El panel lee del mismo mapa que las tarjetas. Si leyera por su cuenta,
  // podría mostrar una cotización distinta de la que anuncia la tarjeta.
  const selectedCtx = useMemo(
    () => (selectedOpp ? contextMap.get(selectedOpp.id) : undefined),
    [selectedOpp, contextMap]
  );

  // Las acciones sobre la cotización viven en la vista de Cotizaciones (imprimir
  // arma el HTML completo, duplicar usa duplicateQuote). Replicarlas acá sería
  // una segunda copia que se desincroniza; en vez de eso se deja la orden y se
  // navega, que es el mismo patrón que ya usa AXIS.
  const handleQuoteAction = (
    quoteId: string,
    mode: "ver" | "editar" | "imprimir" | "duplicar"
  ) => {
    requestQuoteAction(quoteId, mode);
    window.dispatchEvent(new CustomEvent("axis:navigate", { detail: { page: "quotes" } }));
    setIsDrawerOpen(false);
  };

  // ── Bitácora desde el panel (Fase C) ──────────────────────────────────────

  /**
   * Abre el panel dejando el formulario en blanco.
   *
   * El borrador se resetea aquí y no al cerrar: si el asesor cierra sin querer,
   * al volver a abrir la MISMA oportunidad recupera lo que escribió. Lo que no
   * puede pasar es que ese texto viaje a otro negocio.
   */
  const openOpportunityPanel = (opp: OpportunityV2) => {
    // La comparación va fuera del updater de setSelectedOpp: un updater debe ser
    // una función pura y React puede llamarlo dos veces en StrictMode. Con los
    // setState adentro, el reseteo se ejecutaría de forma impredecible.
    if (selectedOpp?.id !== opp.id) {
      setActivityDraft(emptyDraft);
      setIsActivityFormOpen(false);
      setRequireFollowUp(false);
      setActivityError("");
      setShowAllActivities(false);
    }
    setSelectedOpp(opp);
    setIsDrawerOpen(true);
  };

  const openActivityForm = (asFollowUp: boolean) => {
    setRequireFollowUp(asFollowUp);
    setActivityError("");
    setActivityDraft(prev => ({
      ...prev,
      // "+ Crear seguimiento" propone mañana a las 9:00 en vez de dejar el campo
      // vacío. Con el campo vacío hay que abrir el selector de fecha para hacer
      // lo más común, y ese roce es justo lo que hace que nadie agende nada.
      followUpLocal: asFollowUp && !prev.followUpLocal ? presetDatetimeValue("manana") : prev.followUpLocal,
      type: asFollowUp ? FOLLOW_UP_TYPE : (prev.type === FOLLOW_UP_TYPE ? "Llamada" : prev.type),
    }));
    setIsActivityFormOpen(true);
  };

  /**
   * Guarda la gestión en la MISMA bitácora que leen Contactos, AXIS y el
   * Dashboard (crm_activities_v2 vía createActivity). No hay un historial
   * paralelo del embudo.
   *
   * La novedad es `opportunityId`: hasta ahora una actividad solo sabía de qué
   * empresa y contacto era, así que el embudo tenía que adivinar a qué negocio
   * pertenecía. Lo que se registre desde acá queda atado sin ambigüedad, y una
   * empresa con dos negocios abiertos deja de mezclar historiales.
   */
  const handleSaveActivity = () => {
    if (!selectedOpp) return;

    const result = validateActivityDraft(activityDraft, { requireFollowUp });
    if (!result.ok) {
      setActivityError(result.error);
      return;
    }

    // createActivity rechaza actividades sin cuenta (quedarían huérfanas). El
    // contexto resuelve la empresa incluso cuando la oportunidad tiene el campo
    // vacío pero su cotización sí la conoce; si ni así aparece, se avisa en vez
    // de dejar que reviente.
    const accountId = selectedCtx?.account?.id || selectedOpp.accountId;
    if (!accountId) {
      setActivityError("Esta oportunidad no tiene empresa asociada, así que la gestión quedaría huérfana.");
      return;
    }

    try {
      createActivity({
        accountId,
        contactId: selectedCtx?.contact?.id || selectedOpp.contactId,
        opportunityId: selectedOpp.id,
        type: result.type,
        description: result.description,
        followUpAt: result.followUpAt,
      });
    } catch (err: any) {
      setActivityError(err?.message || "No se pudo registrar la gestión.");
      return;
    }

    setActivityDraft(emptyDraft);
    setIsActivityFormOpen(false);
    setRequireFollowUp(false);
    setActivityError("");
    setRefresh(prev => prev + 1);
  };

  /**
   * Cierra el seguimiento pendiente.
   *
   * Se usa completeFollowUpActivity, que marca la actividad existente como
   * completada en lugar de crear una nueva. Así el historial no se duplica y la
   * alerta de "seguimiento vencido" desaparece sola, porque sale del mismo dato.
   */
  const handleCompleteNextAction = (activityId: string) => {
    completeFollowUpActivity(activityId);
    setRefresh(prev => prev + 1);
  };

  /**
   * El formulario es uno solo, dibujado desde una función.
   *
   * Se muestra debajo de PRÓXIMA ACCIÓN o debajo de ACTIVIDAD según qué botón
   * lo abrió, pero nunca los dos a la vez. Escribirlo dos veces en el JSX
   * significaría que un cambio de validación o de estilo hay que hacerlo por
   * duplicado, y tarde o temprano uno de los dos se queda atrás.
   */
  const renderActivityForm = () => (
    <div className="mt-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      {!requireFollowUp && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ACTIVITY_TYPES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setActivityDraft(d => ({ ...d, type: t }))}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                activityDraft.type === t
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <textarea
        value={activityDraft.description}
        onChange={(e) => setActivityDraft(d => ({ ...d, description: e.target.value }))}
        rows={3}
        placeholder={requireFollowUp
          ? 'Qué hay que hacer. Ej: llamar para confirmar si revisaron la cotización.'
          : 'Qué pasó. Ej: se envió la cotización y quedaron de responder el lunes.'}
        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20 resize-y"
      />

      <div className="mt-3">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1.5">
          {requireFollowUp ? 'Fecha del seguimiento' : 'Agendar seguimiento (opcional)'}
        </span>
        <input
          type="datetime-local"
          value={activityDraft.followUpLocal}
          onChange={(e) => setActivityDraft(d => ({ ...d, followUpLocal: e.target.value }))}
          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {FOLLOW_UP_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setActivityDraft(d => ({ ...d, followUpLocal: presetDatetimeValue(p.key) }))}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
              {p.label}
            </button>
          ))}
          {activityDraft.followUpLocal && !requireFollowUp && (
            <button
              type="button"
              onClick={() => setActivityDraft(d => ({ ...d, followUpLocal: '' }))}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-400 hover:text-rose-500 transition-colors"
            >
              Quitar fecha
            </button>
          )}
        </div>
      </div>

      {activityError && (
        <div className="mt-3 flex items-start gap-2 text-xs font-semibold text-rose-600">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{activityError}</span>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={handleSaveActivity}
          className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          {requireFollowUp ? 'Agendar' : 'Guardar gestión'}
        </button>
        <button
          type="button"
          onClick={() => { setIsActivityFormOpen(false); setActivityError(''); }}
          className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
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
              contextMap={contextMap}
              onCardClick={openOpportunityPanel}
              onDeleteCard={handleDeleteOpp}
              stageMetrics={stageMetricsMap.get(stage.name)}
            />
          ))}

          <DragOverlay>
            {activeId && activeOpportunity ? (
              <div className="rotate-2 scale-105 opacity-90 shadow-2xl">
                {(() => {
                  const ctx = contextMap.get(activeOpportunity.id);
                  if (!ctx) return null;
                  return (
                    <OpportunityCard
                      ctx={ctx}
                      stageColor={stages.find(s => s.name === activeOpportunity.etapa)?.color}
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

              {/* ── ENCABEZADO ─────────────────────────────────────────────
                  Quién es el negocio: nombre, empresa, contacto y propietario.
                  La etapa vive en el selector de arriba, que además permite
                  cambiarla, así que no se repite acá como texto muerto. */}
              <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-4 leading-tight">
                {selectedOpp.titulo}
              </h2>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 space-y-3">
                <div className="flex items-start gap-3">
                  <Building2 size={18} className="text-blue-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-bold text-slate-700 dark:text-slate-200 break-words">
                      {selectedCtx?.accountName || "Empresa no encontrada"}
                    </div>
                    {selectedCtx?.account?.razonSocial &&
                      selectedCtx.account.nombreComercial &&
                      selectedCtx.account.razonSocial !== selectedCtx.account.nombreComercial && (
                        <div className="text-xs text-slate-500 break-words">
                          {selectedCtx.account.razonSocial}
                        </div>
                      )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <UserIcon size={18} className="text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 break-words">
                      {selectedCtx?.contactName || "Sin contacto asignado"}
                    </div>
                    {selectedCtx?.contact?.role && (
                      <div className="text-xs text-slate-500">{selectedCtx.contact.role}</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1 border-t border-slate-200/70 dark:border-slate-700">
                  <span className="w-[18px] text-center text-[10px] font-black text-slate-400 shrink-0">
                    {initialsOf(selectedCtx?.ownerName || "")}
                  </span>
                  <div className="text-xs text-slate-500">
                    Propietario:{" "}
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      {selectedCtx?.ownerName || "Sin asignar"}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── SALUD COMERCIAL ─────────────────────────────────────────
                  Va arriba del todo a propósito: es el diagnóstico, y lo que
                  sigue (próxima acción) es qué hacer con él.

                  OJO CON EL TEXTO (Etapa 14): dice "Salud comercial: 82/100",
                  nunca "Probabilidad de ganar: 82%". No es lo mismo. Una
                  probabilidad promete un pronóstico que estos datos no pueden
                  sostener; esto mide qué tan bien atendida está la negociación.
                  La frase la arma healthSentence() para que no se reescriba
                  suelta en ningún lado.

                  Las oportunidades cerradas no se puntúan: mostrarle 45/100 a
                  alguien que ya facturó es ruido. Por eso el isScored.

                  El desglose de por qué el puntaje es ese llega en su etapa;
                  acá todavía solo se muestra el número y la banda. */}
              {selectedCtx?.health?.isScored && (
                <div className="mt-6">
                  <div
                    className={`p-4 rounded-2xl border ${HEALTH_BAND_CLASS[selectedCtx.health.band]}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Gauge size={18} className="shrink-0" />
                        <span className="text-sm font-bold truncate">
                          {healthSentence(selectedCtx.health)}
                        </span>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider shrink-0">
                        {selectedCtx.health.bandLabel}
                      </span>
                    </div>

                    {/* La barra repite el dato del texto en forma visual. Es
                        redundante a propósito: el número se compara mal de un
                        vistazo entre tarjetas, la barra no. */}
                    <div className="mt-3 h-2 w-full rounded-full bg-white/60 dark:bg-slate-900/40 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${HEALTH_BAR_CLASS[selectedCtx.health.band]}`}
                        style={{ width: `${selectedCtx.health.score}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── INFORMACIÓN ECONÓMICA ───────────────────────────────────
                  El valor ponderado se muestra siempre en COP porque es lo que
                  se puede sumar con el resto del embudo; el valor de arriba
                  queda en la moneda en que se negoció. */}
              <div className="mt-6">
                <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-3">
                  Información económica
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">Valor</span>
                    <div className="text-xl font-black text-slate-800 dark:text-white flex items-baseline gap-1.5 flex-wrap">
                      {formatMoney(selectedOpp.valor, selectedOpp.moneda)}
                      <span className="text-xs font-bold text-slate-400">{selectedOpp.moneda}</span>
                    </div>
                    {selectedOpp.moneda !== "COP" && selectedCtx && (
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        ≈ {formatCOP(selectedCtx.valorCOP)} a TRM {new Intl.NumberFormat('es-CO').format(trm)}
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">Probabilidad</span>
                    <div className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-1">
                      <Percent size={15} className="text-blue-500" />
                      {selectedOpp.probabilidad}%
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">Valor ponderado</span>
                    <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCOP(selectedCtx?.valorPonderadoCOP ?? 0)}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">valor × probabilidad</div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">Cierre estimado</span>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                      <Calendar size={15} className="shrink-0" />
                      {new Date(selectedOpp.fechaEstimadaCierre).toLocaleDateString('es-CO', {
                        year: 'numeric', month: 'short', day: 'numeric'
                      })}
                    </div>
                    {selectedCtx?.isOpen && (
                      <div
                        className={`text-[11px] mt-0.5 font-semibold ${
                          selectedCtx.daysToClose < 0
                            ? 'text-rose-500'
                            : selectedCtx.daysToClose <= 7
                              ? 'text-amber-500'
                              : 'text-slate-400'
                        }`}
                      >
                        {selectedCtx.daysToClose < 0
                          ? `Venció hace ${Math.abs(selectedCtx.daysToClose)} días`
                          : selectedCtx.daysToClose === 0
                            ? 'Vence hoy'
                            : `Faltan ${selectedCtx.daysToClose} días`}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── RELACIÓN CON LA COTIZACIÓN ────────────────────────────── */}
              <div className="mt-6">
                <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-3">
                  Cotización asociada
                </label>

                {!selectedCtx?.quote ? (
                  <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-400 flex items-center gap-2">
                    <FileText size={16} className="shrink-0" />
                    Esta oportunidad todavía no tiene cotización asociada.
                  </div>
                ) : (
                  <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <span className="text-sm font-black text-slate-900 dark:text-white">
                        {selectedCtx.quote.quoteNumber}
                      </span>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${quoteStatusBadge(selectedCtx.quote.status)}`}
                      >
                        {selectedCtx.quoteStatusText}
                      </span>
                    </div>

                    <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                      <div>
                        <span className="font-semibold text-slate-500">Empresa: </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {selectedCtx.accountName || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Contacto: </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {selectedCtx.contactName || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Valor total cotizado: </span>
                        <span className="font-bold text-emerald-600">
                          {formatMoney(selectedCtx.quote.total, selectedCtx.quote.currency)}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Moneda: </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {selectedCtx.quote.currency}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Cantidad de ítems: </span>
                        <span className="font-bold">{selectedCtx.quote.items?.length || 0}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Fecha de creación: </span>
                        <span>
                          {selectedCtx.quote.createdAt
                            ? new Date(selectedCtx.quote.createdAt).toLocaleDateString('es-CO')
                            : selectedCtx.quote.issueDate}
                        </span>
                      </div>
                      {selectedCtx.quote.sentAt && (
                        <div>
                          <span className="font-semibold text-slate-500">Fecha de envío: </span>
                          <span>{new Date(selectedCtx.quote.sentAt).toLocaleDateString('es-CO')}</span>
                          {typeof selectedCtx.daysSinceQuoteSent === 'number' && (
                            <span className="text-slate-400">
                              {" "}· hace {selectedCtx.daysSinceQuoteSent} días
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-blue-100 dark:border-blue-900/30 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleQuoteAction(selectedCtx.quote!.id, "ver")}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 transition-colors"
                      >
                        <Eye size={14} /> Ver
                      </button>
                      <button
                        onClick={() => handleQuoteAction(selectedCtx.quote!.id, "editar")}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 transition-colors"
                      >
                        <Pencil size={14} /> Editar
                      </button>
                      <button
                        onClick={() => handleQuoteAction(selectedCtx.quote!.id, "imprimir")}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 transition-colors"
                      >
                        <Printer size={14} /> Imprimir
                      </button>
                      <button
                        onClick={() => handleQuoteAction(selectedCtx.quote!.id, "duplicar")}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 transition-colors"
                      >
                        <Copy size={14} /> Duplicar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── PRÓXIMA ACCIÓN ─────────────────────────────────────────
                  Va ANTES del historial a propósito. La bitácora puede tener
                  treinta gestiones; lo único que el asesor tiene que decidir al
                  abrir el panel es qué hace ahora. Si eso queda debajo de una
                  lista larga, deja de leerse.

                  El dato sale de opportunityContext.nextActionOf(), que elige el
                  seguimiento pendiente de fecha MÁS ANTIGUA: si hay uno vencido
                  y otro para mañana, lo urgente es el vencido. */}
              <div className="mt-6">
                <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest block mb-3">
                  Próxima acción
                </label>

                {!selectedCtx?.nextAction ? (
                  <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-400 flex items-center gap-2">
                    <Bell size={16} className="shrink-0" />
                    No hay una próxima acción programada.
                  </div>
                ) : (
                  <div
                    className={`p-4 rounded-2xl border ${
                      selectedCtx.nextAction.state === 'vencido'
                        ? 'bg-rose-50/70 dark:bg-rose-900/10 border-rose-200 dark:border-rose-900/40'
                        : selectedCtx.nextAction.state === 'hoy'
                          ? 'bg-amber-50/70 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/40'
                          : 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        {selectedCtx.nextAction.type}
                      </span>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          selectedCtx.nextAction.state === 'vencido'
                            ? 'bg-rose-100 text-rose-700'
                            : selectedCtx.nextAction.state === 'hoy'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {selectedCtx.nextAction.label}
                      </span>
                    </div>

                    <p className="text-sm text-slate-700 dark:text-slate-300 break-words whitespace-pre-line">
                      {selectedCtx.nextAction.description || 'Sin descripción.'}
                    </p>

                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <Clock size={12} className="shrink-0" />
                      {new Date(selectedCtx.nextAction.at).toLocaleString('es-CO', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCompleteNextAction(selectedCtx.nextAction!.activityId)}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
                    >
                      <Check size={14} /> Marcar como realizada
                    </button>
                  </div>
                )}

                {!(isActivityFormOpen && requireFollowUp) && (
                  <button
                    type="button"
                    onClick={() => openActivityForm(true)}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
                  >
                    <CalendarPlus size={14} /> Crear seguimiento
                  </button>
                )}

                {isActivityFormOpen && requireFollowUp && renderActivityForm()}
              </div>

              {/* ── ACTIVIDAD ──────────────────────────────────────────────
                  Es la MISMA bitácora de Contactos y AXIS (crm_activities_v2),
                  filtrada por oportunidad. No hay un historial propio del
                  embudo: lo que se registre acá aparece en las otras pantallas
                  y al revés.

                  Se muestran las 5 más recientes. Una oportunidad vieja puede
                  tener decenas y el panel se volvería una lista infinita en la
                  que lo importante (cotización, próxima acción) queda arriba y
                  perdido. */}
              <div className="mt-6">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest">
                    Actividad
                  </label>
                  {selectedCtx && selectedCtx.activities.length > 0 && (
                    <span className="text-[10px] font-semibold text-slate-400">
                      {selectedCtx.activities.length}{' '}
                      {selectedCtx.activities.length === 1 ? 'gestión' : 'gestiones'}
                      {typeof selectedCtx.daysSinceLastActivity === 'number' && (
                        <>
                          {' · '}
                          {selectedCtx.daysSinceLastActivity === 0
                            ? 'última hoy'
                            : selectedCtx.daysSinceLastActivity === 1
                              ? 'última ayer'
                              : `última hace ${selectedCtx.daysSinceLastActivity} días`}
                        </>
                      )}
                    </span>
                  )}
                </div>

                <ActivityTimeline
                  activities={selectedCtx?.activities || []}
                  limit={showAllActivities ? undefined : 5}
                  emptyLabel="Todavía no hay gestiones registradas en esta oportunidad."
                />

                {selectedCtx && selectedCtx.activities.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllActivities(v => !v)}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold text-slate-500 hover:text-blue-600 transition-colors"
                  >
                    {showAllActivities ? (
                      <><ChevronUp size={13} /> Ver menos</>
                    ) : (
                      <><ChevronDown size={13} /> Ver las {selectedCtx.activities.length} gestiones</>
                    )}
                  </button>
                )}

                {!(isActivityFormOpen && !requireFollowUp) && (
                  <button
                    type="button"
                    onClick={() => openActivityForm(false)}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
                  >
                    <History size={14} /> Registrar gestión
                  </button>
                )}

                {isActivityFormOpen && !requireFollowUp && renderActivityForm()}
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