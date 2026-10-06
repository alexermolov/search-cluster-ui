import { BaseClusterClient } from './base'
import type { ClusterHttp } from './http'
import type { IlmIndexStatus, IlmPolicyInfo } from '../../shared/types'

/**
 * OpenSearch flavor. Shares the common REST surface implemented in
 * BaseClusterClient; override hooks here for OpenSearch-specific behavior
 * (security plugin endpoints, AWS-hosted quirks, ...).
 */
export class OpenSearchClient extends BaseClusterClient {
  constructor(http: ClusterHttp) {
    super(http, 'opensearch')
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */

  /** ISM policies instead of Elasticsearch ILM (GET /_plugins/_ism/policies). */
  override async ilmPolicies(signal?: AbortSignal): Promise<IlmPolicyInfo[]> {
    const res = await this.http.request<any>(
      'GET',
      '/_plugins/_ism/policies?size=1000',
      undefined,
      signal,
    )
    const items: any[] = Array.isArray(res?.policies) ? res.policies : []
    const mapped: IlmPolicyInfo[] = items.map((p: any) => ({
        name: String(p?._id ?? ''),
        // ISM states are the analogue of ILM phases.
        phases: (Array.isArray(p?.policy?.states) ? p.policy.states : []).map((st: any) =>
          String(st?.name ?? ''),
        ),
        body: (p ?? {}) as Record<string, unknown>,
      }))
    return mapped.filter((p) => p.name !== '').sort((a, b) => a.name.localeCompare(b.name))
  }

  /** ISM explain instead of Elasticsearch ILM explain (GET /_plugins/_ism/explain/*). */
  override async ilmExplain(signal?: AbortSignal): Promise<IlmIndexStatus[]> {
    const res = await this.http.request<Record<string, any>>(
      'GET',
      '/_plugins/_ism/explain/*',
      undefined,
      signal,
    )
    const explain: Record<string, any> = res ?? {}
    return Object.entries(explain)
      .filter(([, v]: [string, any]) => v?.policy_id != null)
      .map(([index, v]: [string, any]) => ({
        index,
        policy: v?.policy_id != null ? String(v.policy_id) : null,
        phase: v?.state != null ? String(v.state) : null,
        action: v?.action != null ? String(v.action) : null,
        step: v?.step != null ? String(v.step) : null,
        age: null,
        failedStep: v?.failed_step != null ? String(v.failed_step) : null,
      }))
      .sort((a, b) => a.index.localeCompare(b.index))
  }
}
