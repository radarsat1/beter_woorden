'use client'

import { supabase } from "@/utils/supabase"

interface SidebarProps {
  currentView: string
  onChangeView: (view: string) => void
}

export default function Sidebar({ currentView, onChangeView }: SidebarProps) {
  return (
    <div className="w-64 bg-slate-900 text-slate-300 h-screen flex flex-col p-6 flex-shrink-0 border-r border-slate-800">
      <div className="flex items-center gap-3 mb-10 text-white">
        <h2 className="text-lg font-bold tracking-tight rounded-xl border p-3">Daily Dutch</h2>
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
  )
}
