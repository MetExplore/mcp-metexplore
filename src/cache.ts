import type { MetExploreApiClient, Metabolite, Network } from "./apiClient.js";

/**
 * In-memory (process-lifetime) cache to avoid re-spending the API request
 * quota every time the same data is looked up again during a session.
 */
export class MetExploreCache {
  private networks?: Network[];
  private metabolitesByNetwork = new Map<number, Metabolite[]>();
  private networkDetails = new Map<number, Network>();

  constructor(private readonly client: MetExploreApiClient) {}

  async getNetworks(): Promise<Network[]> {
    if (!this.networks) {
      this.networks = await this.client.getNetworks();
    }
    return this.networks;
  }

  /** Details of one network (GET /networks/{id}), e.g. its stats_refs_metabolites. */
  async getNetworkDetails(idNetwork: number): Promise<Network> {
    let network = this.networkDetails.get(idNetwork);
    if (!network) {
      network = await this.client.getNetwork(idNetwork);
      this.networkDetails.set(idNetwork, network);
    }
    return network;
  }

  async getMetabolites(idNetwork: number): Promise<Metabolite[]> {
    let list = this.metabolitesByNetwork.get(idNetwork);
    if (!list) {
      list = await this.client.getMetabolitesForNetwork(idNetwork);
      this.metabolitesByNetwork.set(idNetwork, list);
    }
    return list;
  }

  /** Metabolite of the given network by its db_identifier, if already cached. */
  async findMetaboliteByDbIdentifier(idNetwork: number, dbIdentifier: string): Promise<Metabolite | undefined> {
    const list = await this.getMetabolites(idNetwork);
    return list.find((m) => m.db_identifier === dbIdentifier);
  }
}
