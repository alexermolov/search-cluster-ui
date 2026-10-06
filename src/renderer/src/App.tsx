import { useEffect } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { ConnectionForm } from './components/ConnectionForm'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { useHotkeys } from './hotkeys'
import { useApp } from './store'

export function App() {
  const init = useApp((s) => s.init)
  const editor = useApp((s) => s.editor)

  useHotkeys()

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="app">
      <Sidebar />
      <Workspace />
      {editor && (
        <ConnectionForm key={editor.connection?.id ?? 'new'} connection={editor.connection} />
      )}
      <CommandPalette />
    </div>
  )
}
