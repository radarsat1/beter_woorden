'use client'

import { supabase } from "@/utils/supabase"

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  currentView: string
  onChangeView: (view: string) => void
}

export default function Sidebar({ isOpen, onClose, currentView, onChangeView }: SidebarProps) {
  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 h-screen flex flex-col p-6 flex-shrink-0 border-r border-slate-800 transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between gap-3 mb-10 text-white cursor-pointer"
          onClick={() => onChangeView('intro')}
        >
          <h2 className="text-lg font-bold tracking-tight rounded-xl border p-3">Beter Woorden</h2>
          <button onClick={onClose} className="md:hidden p-2 hover:bg-slate-800 rounded-lg">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

     <nav className="flex-1 space-y-1">
        <button
          onClick={() => onChangeView('wordlists')}
          className={`w-full text-left px-4 py-3 rounded-lg transition-colors font-medium ${currentView === 'wordlists' ? 'bg-slate-800 text-white shadow-inner' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          Word Lists
        </button>
        <button
          onClick={() => onChangeView('quizzes')}
          className={`w-full text-left px-4 py-3 rounded-lg transition-colors font-medium ${currentView.startsWith('quiz') ? 'bg-slate-800 text-white shadow-inner' : 'hover:bg-slate-800 hover:text-white'}`}
        >
          Quizzes
        </button>
      </nav>

      <button onClick={() => supabase.auth.signOut()} className="mt-auto flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        Sign Out
      </button>
    </div>
    </>
  )
}
