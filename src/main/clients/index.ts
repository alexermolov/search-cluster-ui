import type { ConnectionConfig } from '../../shared/types'
import { BaseClusterClient, type ClusterClient } from './base'
import { ElasticsearchClient } from './elasticsearch'
import { ClusterHttp } from './http'
import { OpenSearchClient } from './opensearch'

export type { ClusterClient } from './base'
export { ApiError } from './http'

/**
 * Factory: builds the right client for a connection flavor.
 * New flavors plug in here (add a union member to ClusterFlavor + a case).
 */
export function createClient(cfg: ConnectionConfig): ClusterClient {
  const http = new ClusterHttp(cfg)
  switch (cfg.flavor) {
    case 'opensearch':
      return new OpenSearchClient(http)
    case 'elasticsearch':
      return new ElasticsearchClient(http)
    default: {
      // Exhaustiveness guard: a new flavor must be handled above.
      const never: never = cfg.flavor
      throw new Error(`Unsupported cluster flavor: ${String(never)}`)
    }
  }
}

// Re-export the base class so flavor packages can extend it without
// reaching into internal paths.
export { BaseClusterClient }
