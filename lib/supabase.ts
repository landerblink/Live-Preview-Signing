import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
}
export const sb = createClient(url, key)

export type Align = 'left' | 'center' | 'right'
type Base = { bg: string }

export type PropsMap = {
  heading: Base & { text: string; size: number; color: string; align: Align }
  paragraph: Base & { text: string; color: string; align: Align }
  image: Base & { src: string; alt: string }
  button: Base & { label: string; href: string; color: string; align: Align }
}
export type BlockType = keyof PropsMap

export type BlockOf<T extends BlockType> = {
  id: string
  project_id: string
  position: number
  type: T
  props: PropsMap[T]
}
// Discriminated union: narrowing on `type` narrows `props`
export type Block = { [T in BlockType]: BlockOf<T> }[BlockType]

export type ThemeSettings = { font: string; accent: string; bg: string; text: string }
export type Project = {
  id: string
  owner_id: string
  name: string
  theme: ThemeSettings
  created_at: string
}
export type Role = 'owner' | 'editor' | 'viewer'

export const DEFAULTS: { [T in BlockType]: PropsMap[T] } = {
  heading: { text: 'New heading', size: 40, color: '#111827', align: 'left', bg: '#ffffff' },
  paragraph: { text: 'Write something here.', color: '#374151', align: 'left', bg: '#ffffff' },
  image: { src: 'https://picsum.photos/1200/500', alt: 'Image', bg: '#ffffff' },
  button: { label: 'Click me', href: '#', color: '#6366f1', align: 'left', bg: '#ffffff' },
}

// Flat DB row shape for inserts (no union, so Supabase infers it cleanly)
export type BlockRow = {
  id: string
  project_id: string
  position: number
  type: BlockType
  props: Record<string, string | number>
}

export const BLOCK_TYPES = Object.keys(DEFAULTS) as BlockType[]
export const isBlockType = (v: string): v is BlockType => v in DEFAULTS