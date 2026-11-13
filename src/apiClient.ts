import type { Config } from "./config.js";
import { MetExploreApiError, MetExploreAuthError, MetExploreQuotaError, toFriendlyAuthMessage } from "./errors.js";

export interface Network {
  id: number;
  name: string;
  organism_name?: string;
  ncbi_id?: number;
  strain?: string;
  tissue?: string;
  cell_type?: string;
  source?: string;
  version?: string;
  description?: string;
  db_identifier?: string;
  identifier_origin?: string;
  permission?: string;
  nb_pathways?: number;
  nb_reactions?: number;
  nb_metabolites?: number;
  nb_genes?: number;
  [key: string]: unknown;
}

export interface CrossRef {
  ext_db_name: string;
  ext_id: string;
  origin?: string;
}

export interface Metabolite {
  id: number;
  db_identifier: string;
  name: string;
  chemical_formula?: string;
  charge?: number;
  sbo?: string;
  cross_refs?: CrossRef[];
  compartment?: { id: number; name: string };
  [key: string]: unknown;
}

/** Pathway enrichment result for one pathway (right-tailed Fisher exact test). */
export interface EnrichmentEntry {
  label: string;
  nb_total_biodata: number;
  nb_mapped_biodata: number;
  pval: number;
  bonferroni_pval: number;
  bh_pval: number;
}

export interface MappingStatistics {
  nb_queries: number;
  nb_mapped_queries: number;
  /** Keyed by pathway identifier. Always present, computed for every mapping call. */
  enrichment: Record<string, EnrichmentEntry>;
  [key: string]: unknown;
}

export interface MappingResponse {
  map: Record<string, string[]>;
  entities: {
    metabolites?: Record<string, unknown>;
    reactions?: Record<string, unknown>;
    pathways?: Record<string, unknown>;
    genes?: Record<string, unknown>;
    [key: string]: unknown;
  };
  statistics: MappingStatistics;
}

export interface FiltersResponse {
  ids: number[];
  db_identifiers: string[];
  names: string[];
}

export interface Job {
  status: "waiting" | "running" | "finished" | "failed";
  message?: string;
  result?: { success?: boolean; id_network?: number; download?: string };
}

interface BaseEnvelope {
  message: string;
  success: boolean;
  status: number;
}

/**
 * Central HTTP client for the MetExplore API: builds authentication headers,
 * enforces the per-session request quota, and translates API errors into
 * actionable messages.
 */
export class MetExploreApiClient {
  private requestCount = 0;
  private userToken?: string;

  constructor(private readonly config: Config) {
    this.userToken = config.userToken;
    if (!config.tlsRejectUnauthorized) {
      console.error(
        "[mcp-metexplore] WARNING: TLS certificate verification is disabled " +
          "(METEXPLORE_TLS_REJECT_UNAUTHORIZED=false). Only use this against a trusted MetExplore " +
          "server known to serve an incomplete certificate chain.",
      );
      // Node has no reliable way to scope this to a single fetch() call (the process's undici
      // dispatcher isn't necessarily the same version as the one built into Node). Node re-reads
      // NODE_TLS_REJECT_UNAUTHORIZED on every TLS connection, so setting it here is enough — at the
      // cost of disabling verification for the whole process, which only ever talks to the
      // configured MetExplore API anyway.
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
  }

  get requestsUsed(): number {
    return this.requestCount;
  }

  get requestsRemaining(): number {
    return Math.max(0, this.config.maxRequestsPerSession - this.requestCount);
  }

  private async ensureUserToken(): Promise<void> {
    if (this.userToken) return;
    if (!this.config.userLogin || !this.config.userPassword) {
      throw new MetExploreAuthError(
        "No user token available and no login credentials configured " +
          "(METEXPLORE_USER_LOGIN/METEXPLORE_USER_PASSWORD).",
      );
    }
    const response = await this.request<BaseEnvelope & { user?: { token?: string } }>(
      "POST",
      "/users/login",
      { login: this.config.userLogin, password: this.config.userPassword },
      { skipUserAuth: true },
    );
    if (!response.success || !response.user?.token) {
      throw new MetExploreAuthError(
        `Login to MetExplore with METEXPLORE_USER_LOGIN/METEXPLORE_USER_PASSWORD failed: ${response.message}`,
      );
    }
    this.userToken = response.user.token;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    opts: { skipUserAuth?: boolean } = {},
  ): Promise<T> {
    if (this.requestCount >= this.config.maxRequestsPerSession) {
      throw new MetExploreQuotaError(
        `Reached the ${this.config.maxRequestsPerSession}-request API quota for this session. ` +
          "Restart the MCP server to get a fresh quota.",
      );
    }

    const headers: Record<string, string> = { "x-app-key": this.config.appKey };
    if (!opts.skipUserAuth && this.userToken) {
      headers["Authorization"] = `Bearer ${this.userToken}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    this.requestCount += 1;
    let res: Response;
    try {
      res = await fetch(`${this.config.apiUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const cause = (err as Error & { cause?: unknown }).cause;
      const causeMessage = cause instanceof Error ? ` (${cause.message})` : "";
      throw new MetExploreApiError(
        `Could not reach the MetExplore API at ${this.config.apiUrl}: ${(err as Error).message}${causeMessage}`,
        0,
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      if (!res.ok) {
        throw new MetExploreApiError(`MetExplore API error (HTTP ${res.status})`, res.status);
      }
      return (await res.text()) as unknown as T;
    }

    const json = (await res.json()) as BaseEnvelope & Record<string, unknown>;
    if (!res.ok || json.success === false) {
      const status = res.status;
      const friendly = toFriendlyAuthMessage(status, json.message ?? "");
      if (friendly) throw new MetExploreAuthError(friendly);
      if (status === 429) {
        throw new MetExploreApiError("The MetExplore API replied 429 (too many requests). Try again later.", 429);
      }
      throw new MetExploreApiError(json.message ?? `MetExplore API error (HTTP ${status})`, status);
    }
    return json as unknown as T;
  }

  async getNetworks(): Promise<Network[]> {
    await this.ensureUserToken();
    const res = await this.request<BaseEnvelope & { networks: Network[] }>("GET", "/networks");
    return res.networks ?? [];
  }

  async getMetabolitesForNetwork(idNetwork: number): Promise<Metabolite[]> {
    await this.ensureUserToken();
    const res = await this.request<BaseEnvelope & { metabolites: Metabolite[] }>(
      "GET",
      `/metabolites?id_network=${idNetwork}`,
    );
    return res.metabolites ?? [];
  }

  async mapMetaboliteIds(idNetwork: number, ids: string[]): Promise<MappingResponse> {
    await this.ensureUserToken();
    const res = await this.request<BaseEnvelope & MappingResponse>("POST", "/mapping/metabolites/ids", {
      id_network: idNetwork,
      type: "metabolites",
      entries: { ids },
    });
    return res;
  }

  async filterReactionsByMetabolites(metaboliteIds: number[]): Promise<FiltersResponse> {
    await this.ensureUserToken();
    const res = await this.request<BaseEnvelope & FiltersResponse>("POST", "/filters", {
      filtertype: "Metabolite2Reaction",
      ids: metaboliteIds,
    });
    return res;
  }

  async startSbmlExport(idNetwork: number): Promise<string> {
    await this.ensureUserToken();
    const res = await this.request<BaseEnvelope & { result: string }>(
      "GET",
      `/export/sbml?id_network=${idNetwork}`,
    );
    return res.result;
  }

  async getJob(jobId: string): Promise<Job> {
    await this.ensureUserToken();
    const res = await this.request<BaseEnvelope & { job: Job }>("GET", `/jobs?id=${jobId}`);
    return res.job;
  }

  async downloadJobFile(jobId: string): Promise<string> {
    await this.ensureUserToken();
    return this.request<string>("GET", `/jobs?id=${jobId}&file=true`);
  }
}
