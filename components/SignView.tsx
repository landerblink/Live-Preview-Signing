'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { sb } from '@/lib/supabase'
import InkBoard from '@/components/InkBoard'

type Doc = { name: string; document: string }

export default function SignView({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState('')
  const [doc, setDoc] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      sb.from('projects').select('name,document').eq('id', projectId).single(),
      sb.rpc('role_of', { pid: projectId }),
    ]).then(([p, r]) => {
      if (cancelled) return
      const d = p.data as Doc | null
      if (d) { setTitle(d.name); setDoc(d.document) }
      setCanEdit(r.data === 'owner' || r.data === 'editor')
    })
    return () => { cancelled = true }
  }, [projectId])

  const save = async () => {
    const { error } = await sb.from('projects').update({ document: draft }).eq('id', projectId)
    if (error) setMsg(error.message)
    else { setDoc(draft); setEditing(false); setMsg('') }
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2 text-sm">
        <Link href="/" className="text-neutral-400 hover:text-white">←</Link>
        <span className="font-medium">{title || 'Document'}</span>
        <div className="ml-auto flex items-center gap-4 text-xs">
          {canEdit && !editing && <button onClick={() => { setDraft(doc); setEditing(true) }} className="text-neutral-300">Edit text</button>}
          <Link href={`/p/${projectId}/pen`} className="text-indigo-400">Signing pad →</Link>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 bg-white text-neutral-900 md:grid-cols-2">
        <section className="overflow-y-auto p-6 md:p-10">
          {editing ? (
            <div className="space-y-3">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={24} className="w-full rounded border border-neutral-300 p-3 text-sm" placeholder="Paste or type the commitment text…" />
              <div className="flex items-center gap-2 text-sm">
                <button onClick={() => void save()} className="rounded bg-indigo-600 px-3 py-1.5 text-white">Save</button>
                <button onClick={() => setEditing(false)} className="rounded bg-neutral-200 px-3 py-1.5">Cancel</button>
                {msg && <span className="text-xs text-red-500">{msg}</span>}
              </div>
            </div>
          ) : doc ? (
            <article className="whitespace-pre-wrap text-sm leading-snug">{doc}</article>
          ) : (
            <p className="text-neutral-400">No document text yet.{canEdit ? ' Click “Edit text” to add it.' : ''}</p>
          )}
        </section>
        <section className="flex min-h-[50vh] flex-col border-t border-neutral-300 md:border-l md:border-t-0">
          <InkBoard projectId={projectId} writable={false} minimal />
        </section>
      </div>
    </div>
  )
}
