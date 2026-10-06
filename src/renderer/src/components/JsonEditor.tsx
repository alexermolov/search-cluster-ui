import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { Compartment, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { autocompletion } from '@codemirror/autocomplete'
import type { CompletionSource } from '@codemirror/autocomplete'
import { useApp } from '../store'

interface Props {
  value: string
  onChange: (v: string) => void
  onRun?: () => void
  placeholder?: string
  minHeight?: string
  /** Optional completion source (e.g. index field autocompletion). */
  completions?: CompletionSource
}

/**
 * Thin React wrapper around CodeMirror 6 with JSON syntax highlighting.
 * Ctrl/Cmd+Enter triggers onRun.
 */
export function JsonEditor({
  value,
  onChange,
  onRun,
  placeholder,
  minHeight = '160px',
  completions
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const lastValueRef = useRef(value)
  const theme = useApp((s) => s.theme)
  const themeCompartment = useRef(new Compartment())

  // Keep latest callbacks in refs so the editor is not rebuilt on every change.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const completionsRef = useRef(completions)
  completionsRef.current = completions

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Delegate to the latest completions prop without rebuilding the editor.
    const delegate: CompletionSource = (context) => completionsRef.current?.(context) ?? null

    const view = new EditorView({
      doc: value,
      parent: host,
      extensions: [
        basicSetup,
        json(),
        themeCompartment.current.of(theme === 'dark' ? oneDark : []),
        EditorView.lineWrapping,
        placeholder !== undefined ? cmPlaceholder(placeholder) : [],
        autocompletion({ override: [delegate] }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            lastValueRef.current = text
            onChangeRef.current(text)
          }
        }),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onRunRef.current?.()
                return true
              }
            }
          ])
        )
      ]
    })

    viewRef.current = view
    lastValueRef.current = value

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Editor is created once; value sync is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switch the CodeMirror theme without rebuilding the editor.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(theme === 'dark' ? oneDark : []),
    })
  }, [theme])

  // Sync external value changes into the editor without feedback loops.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value !== lastValueRef.current) {
      lastValueRef.current = value
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  return <div className="cm-editor-wrap" style={{ minHeight }} ref={hostRef} />
}
