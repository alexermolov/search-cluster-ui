import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ElectronApi } from '../shared/ipc'

/**
 * The only bridge between the renderer and the main process.
 * No arbitrary invoke: every channel is listed here explicitly.
 */
const api: ElectronApi = {
  cancelRequest: (requestId) => {
    // Fire-and-forget: cancellation must never block the renderer.
    void ipcRenderer.invoke(IPC.RequestCancel, requestId)
  },
  listConnections: () => ipcRenderer.invoke(IPC.ConnectionsList),
  saveConnection: (input) => ipcRenderer.invoke(IPC.ConnectionsSave, input),
  deleteConnection: (id) => ipcRenderer.invoke(IPC.ConnectionsDelete, id),
  testConnection: (input) => ipcRenderer.invoke(IPC.ConnectionsTest, input),
  fetchOverview: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterOverview, connectionId, requestId),
  fetchIndices: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterIndices, connectionId, requestId),
  fetchIndexDetail: (connectionId, indexName, requestId) =>
    ipcRenderer.invoke(IPC.ClusterIndexDetail, connectionId, indexName, requestId),
  search: (connectionId, input, requestId) =>
    ipcRenderer.invoke(IPC.ClusterSearch, connectionId, input, requestId),
  explain: (connectionId, input, requestId) =>
    ipcRenderer.invoke(IPC.ClusterExplain, connectionId, input, requestId),
  deleteIndex: (connectionId, indexName) =>
    ipcRenderer.invoke(IPC.ClusterIndexDelete, connectionId, indexName),
  clearIndex: (connectionId, indexName) =>
    ipcRenderer.invoke(IPC.ClusterIndexClear, connectionId, indexName),
  deleteDocument: (connectionId, indexName, docId) =>
    ipcRenderer.invoke(IPC.ClusterDocumentDelete, connectionId, indexName, docId),
  getDocument: (connectionId, indexName, docId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterDocumentGet, connectionId, indexName, docId, requestId),
  saveDocument: (connectionId, indexName, docId, source) =>
    ipcRenderer.invoke(IPC.ClusterDocumentSave, connectionId, indexName, docId, source),
  createDocument: (connectionId, indexName, source) =>
    ipcRenderer.invoke(IPC.ClusterDocumentCreate, connectionId, indexName, source),
  bulk: (connectionId, input) => ipcRenderer.invoke(IPC.ClusterBulk, connectionId, input),
  exportSearch: (connectionId, input, format, options, requestId) =>
    ipcRenderer.invoke(IPC.ClusterExport, connectionId, input, format, options, requestId),
  openIndex: (connectionId, indexName) =>
    ipcRenderer.invoke(IPC.ClusterIndexOpen, connectionId, indexName),
  closeIndex: (connectionId, indexName) =>
    ipcRenderer.invoke(IPC.ClusterIndexClose, connectionId, indexName),
  addAlias: (connectionId, indexName, alias) =>
    ipcRenderer.invoke(IPC.ClusterAliasAdd, connectionId, indexName, alias),
  removeAlias: (connectionId, indexName, alias) =>
    ipcRenderer.invoke(IPC.ClusterAliasRemove, connectionId, indexName, alias),
  reindex: (connectionId, source, dest, body) =>
    ipcRenderer.invoke(IPC.ClusterReindex, connectionId, source, dest, body),
  fetchShards: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterShards, connectionId, requestId),
  fetchSnapshots: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterSnapshots, connectionId, requestId),
  fetchRepositories: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterRepositories, connectionId, requestId),
  createSnapshot: (connectionId, input) =>
    ipcRenderer.invoke(IPC.ClusterSnapshotCreate, connectionId, input),
  deleteSnapshot: (connectionId, repository, snapshot) =>
    ipcRenderer.invoke(IPC.ClusterSnapshotDelete, connectionId, repository, snapshot),
  restoreSnapshot: (connectionId, input) =>
    ipcRenderer.invoke(IPC.ClusterSnapshotRestore, connectionId, input),
  allocationExplain: (connectionId, input, requestId) =>
    ipcRenderer.invoke(IPC.ClusterAllocationExplain, connectionId, input, requestId),
  reroute: (connectionId, input) => ipcRenderer.invoke(IPC.ClusterReroute, connectionId, input),
  fetchClusterSettings: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterSettingsGet, connectionId, requestId),
  updateClusterSettings: (connectionId, input) =>
    ipcRenderer.invoke(IPC.ClusterSettingsUpdate, connectionId, input),
  indexTemplates: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterIndexTemplates, connectionId, requestId),
  componentTemplates: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterComponentTemplates, connectionId, requestId),
  saveIndexTemplate: (connectionId, name, body) =>
    ipcRenderer.invoke(IPC.ClusterIndexTemplateSave, connectionId, name, body),
  deleteIndexTemplate: (connectionId, name) =>
    ipcRenderer.invoke(IPC.ClusterIndexTemplateDelete, connectionId, name),
  saveComponentTemplate: (connectionId, name, body) =>
    ipcRenderer.invoke(IPC.ClusterComponentTemplateSave, connectionId, name, body),
  deleteComponentTemplate: (connectionId, name) =>
    ipcRenderer.invoke(IPC.ClusterComponentTemplateDelete, connectionId, name),
  simulateIndexTemplate: (connectionId, templateName, indexName, requestId) =>
    ipcRenderer.invoke(IPC.ClusterSimulateIndexTemplate, connectionId, templateName, indexName ?? null, requestId),
  createIndexFromTemplate: (connectionId, indexName, body) =>
    ipcRenderer.invoke(IPC.ClusterCreateIndexFromTemplate, connectionId, indexName, body),
  ilmPolicies: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterIlmPolicies, connectionId, requestId),
  ilmExplain: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterIlmExplain, connectionId, requestId),
  dataStreams: (connectionId, requestId) =>
    ipcRenderer.invoke(IPC.ClusterDataStreams, connectionId, requestId),
  msearch: (connectionId, input, requestId) =>
    ipcRenderer.invoke(IPC.ClusterMsearch, connectionId, input, requestId),
}

contextBridge.exposeInMainWorld('api', api)
