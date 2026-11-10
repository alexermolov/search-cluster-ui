import { useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { ConnectionForm } from './components/ConnectionForm'
import { KafkaWorkspace } from './components/KafkaWorkspace'
import { RedisWorkspace } from './components/RedisWorkspace'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { useHotkeys } from './hotkeys'
import { useApp } from './store'

export function App() {
  const init = useApp((s) => s.init)
  const editor = useApp((s) => s.editor)
  const [mode, setMode] = useState<'picker' | 'search' | 'kafka' | 'redis'>('picker')

  useHotkeys()

  useEffect(() => {
    void init()
  }, [init])

  if (mode === 'picker') {
    return (
      <main className="product-picker">
        <div className="product-picker-content">
          <div className="product-picker-brand">
            <span className="logo">◈</span>
            <span>Search Cluster UI</span>
          </div>
          <p className="product-picker-eyebrow">WELCOME</p>
          <h1>Choose a product</h1>
          <p className="product-picker-description">
            Select the environment you want to work with.
          </p>
          <div className="product-cards">
            <button className="product-card" onClick={() => setMode('search')}>
              <span className="product-card-icon elastic-icon" aria-hidden="true">
                ◉
              </span>
              <span className="product-card-title">Elasticsearch</span>
              <span className="product-card-description">
                Manage Elasticsearch and OpenSearch clusters, indices, and queries.
              </span>
              <span className="product-card-action">Open cluster browser <span aria-hidden="true">→</span></span>
            </button>
            <button className="product-card" onClick={() => setMode('kafka')}>
              <span className="product-card-icon kafka-icon" aria-hidden="true">
                ▤
              </span>
              <span className="product-card-title">Apache Kafka</span>
              <span className="product-card-description">
                Browse topics, inspect messages, and find consumer subscriptions.
              </span>
              <span className="product-card-action">Open Kafka browser <span aria-hidden="true">→</span></span>
            </button>
            <button className="product-card" onClick={() => setMode('redis')}>
              <span className="product-card-icon redis-icon" aria-hidden="true">
                ◉
              </span>
              <span className="product-card-title">Redis</span>
              <span className="product-card-description">
                Browse and edit keys, inspect server info, and run Redis commands.
              </span>
              <span className="product-card-action">Open Redis browser <span aria-hidden="true">→</span></span>
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (mode === 'kafka') return <KafkaWorkspace onClose={() => setMode('picker')} />
  if (mode === 'redis') return <RedisWorkspace onClose={() => setMode('picker')} />

  return (
    <div className="app">
      <Sidebar onBack={() => setMode('picker')} />
      <Workspace />
      {editor && (
        <ConnectionForm key={editor.connection?.id ?? 'new'} connection={editor.connection} />
      )}
      <CommandPalette />
    </div>
  )
}
