export type AgentMemoryAgent = "director" | "axis";

export type AgentMemoryType =
  | "recommendation_created"
  | "recommendation_accepted"
  | "action_executed"
  | "action_cancelled"
  | "quote_pending_review"
  | "follow_up_postponed"
  | "risk_detected"
  | "note";

export type AgentMemoryStatus = "open" | "done" | "cancelled";

export type AgentMemoryItem = {
  id: string;
  agent: AgentMemoryAgent;
  type: AgentMemoryType;
  status: AgentMemoryStatus;
  title: string;
  detail?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  quoteId?: string;
  activityId?: string;
  createdAt: string;
  dueAt?: string;
  resolvedAt?: string;
};

const AGENT_MEMORY_KEY = "ioncore_agent_memory_v1";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readMemory(): AgentMemoryItem[] {
  try {
    const raw = localStorage.getItem(AGENT_MEMORY_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item) => item && item.id);
  } catch {
    return [];
  }
}

function writeMemory(items: AgentMemoryItem[]) {
  localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(items));
}

export function listAgentMemory(): AgentMemoryItem[] {
  return readMemory().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function listOpenAgentMemory(): AgentMemoryItem[] {
  return listAgentMemory().filter((item) => item.status === "open");
}

export function addAgentMemory(
  input: Omit<AgentMemoryItem, "id" | "createdAt" | "status"> & {
    status?: AgentMemoryStatus;
  }
): AgentMemoryItem {
  const memory = readMemory();

  const item: AgentMemoryItem = {
    id: uid("mem"),
    createdAt: new Date().toISOString(),
    status: input.status || "open",
    ...input,
  };

  writeMemory([item, ...memory]);

  return item;
}

export function resolveAgentMemory(memoryId: string) {
  const memory = readMemory();

  const updatedMemory = memory.map((item) => {
    if (item.id !== memoryId) return item;

    return {
      ...item,
      status: "done" as AgentMemoryStatus,
      resolvedAt: new Date().toISOString(),
    };
  });

  writeMemory(updatedMemory);
}

export function cancelAgentMemory(memoryId: string) {
  const memory = readMemory();

  const updatedMemory = memory.map((item) => {
    if (item.id !== memoryId) return item;

    return {
      ...item,
      status: "cancelled" as AgentMemoryStatus,
      resolvedAt: new Date().toISOString(),
    };
  });

  writeMemory(updatedMemory);
}

export function findOpenMemoryByActivity(activityId?: string) {
  if (!activityId) return undefined;

  return listOpenAgentMemory().find((item) => item.activityId === activityId);
}

export function findOpenMemoryByQuote(quoteId?: string) {
  if (!quoteId) return undefined;

  return listOpenAgentMemory().find((item) => item.quoteId === quoteId);
}

export function clearAgentMemory() {
  localStorage.removeItem(AGENT_MEMORY_KEY);
}