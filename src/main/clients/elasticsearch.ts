import { BaseClusterClient } from './base'
import type { ClusterHttp } from './http'

/**
 * Elasticsearch flavor. Shares the common REST surface implemented in
 * BaseClusterClient; override hooks here when Elasticsearch-specific
 * endpoints or version quirks need handling.
 */
export class ElasticsearchClient extends BaseClusterClient {
  constructor(http: ClusterHttp) {
    super(http, 'elasticsearch')
  }
}
