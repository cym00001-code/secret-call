import { createHmac } from "node:crypto";

interface RiskState {
  joins: number[];
  sends: number[];
  wakeups: Map<string, number>;
}

export interface RiskDecision {
  allowed: boolean;
  reason?: "join-rate" | "send-rate" | "wakeups";
}

const riskWindows = new Map<string, RiskState>();

const prune = (items: number[], cutoff: number) => {
  while (items.length > 0 && items[0] !== undefined && items[0] < cutoff) {
    items.shift();
  }
};

const stateFor = (ipRiskHash: string): RiskState => {
  const existing = riskWindows.get(ipRiskHash);
  if (existing) return existing;

  const created: RiskState = {
    joins: [],
    sends: [],
    wakeups: new Map()
  };
  riskWindows.set(ipRiskHash, created);
  return created;
};

export const createIpRiskHash = (serverSecret: string, ip: string): string => {
  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", serverSecret).update(`${ip}|${day}`).digest("hex");
};

export const checkJoin = (
  ipRiskHash: string,
  roomIdHash: string,
  now = Date.now()
): RiskDecision => {
  const state = stateFor(ipRiskHash);
  prune(state.joins, now - 60_000);

  for (const [room, seenAt] of state.wakeups.entries()) {
    if (seenAt < now - 10_000) state.wakeups.delete(room);
  }

  if (state.joins.length >= 20) {
    return { allowed: false, reason: "join-rate" };
  }

  state.wakeups.set(roomIdHash, now);
  if (state.wakeups.size > 5) {
    return { allowed: false, reason: "wakeups" };
  }

  state.joins.push(now);
  return { allowed: true };
};

export const checkSend = (ipRiskHash: string, now = Date.now()): RiskDecision => {
  const state = stateFor(ipRiskHash);
  prune(state.sends, now - 60_000);

  if (state.sends.length >= 60) {
    return { allowed: false, reason: "send-rate" };
  }

  state.sends.push(now);
  return { allowed: true };
};
