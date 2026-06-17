// Management API type definitions

export interface ApiKeyEntry {
  id: string;
  name: string;
  key: string; // encrypted: "enc:aes256gcm:..." or plaintext (legacy)
  upstreamId: string;
  isDefault: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyInput {
  name: string;
  key: string; // plaintext
  upstreamId?: string;
  notes?: string;
}

export interface MaskedApiKey extends Omit<ApiKeyEntry, "key"> {
  key: string; // "sk-...xxxx"
}

export interface UpstreamEntry {
  id: string;
  name: string;
  url: string;
  keyId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpstreamInput {
  name: string;
  url: string;
  keyId?: string;
}

export interface RuntimeConfigData {
  activeKeyId: string;
  activeUpstreamId: string;
  loadBalancing: "active" | "round-robin";
  adminPasswordHash: string;
}

export interface LogEntry {
  id: string;
  ts: string;
  model: string;
  stream: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "success" | "error";
  statusCode: number;
  upstreamId: string;
  keyId: string;
  error: string;
  retries: number;
}

export interface LogQuery {
  model?: string;
  status?: "success" | "error";
  since?: string;
  until?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  entries: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface StatsResult {
  totalRequests: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  byModel: { model: string; count: number; tokens: number }[];
  byStatus: { status: string; count: number }[];
}
