'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { useAuth } from './AuthProvider'
import { Database } from '@/lib/schema'

type WordEntry = Database['public']['Tables']['word_list_entries']['Row']
type WordList = Database['public']['Tables']['word_lists']['Row']

export default function WordListEditor() {
  const { user } = useAuth()
  const [lists, setLists] = useState<WordList[]>([])
  const [entries, setEntries] = useState<WordEntry[]>([])
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [newListName, setNewListName] = useState('')
  const [newWord, setNewWord] = useState('')

  const fetchEntries = async (listId?: number) => {
    const { data: lData } = await supabase.from('word_lists').select('*').order('name')
    if (lData) setLists(lData)

    if (listId || selectedListId) {
      const { data: wData } = await supabase.from('word_list_entries')
        .select('*')
        .eq('word_list_id', listId || selectedListId!)
      if (wData) setEntries(wData)
    }
  }

  useEffect(() => {
    fetchEntries()
  }, [])

  useEffect(() => {
    if (selectedListId) fetchEntries(selectedListId)
  }, [selectedListId])

  const createList = async () => {
    if (!user || !newListName.trim()) return
    const { data } = await supabase.from('word_lists').insert({
      user_id: user.id,
      name: newListName.trim()
    }).select().single()

    if (data) {
      setLists([...lists, data])
      setNewListName('')
      setSelectedListId(data.id)
    }
  }

  const addWord = async () => {
    if (!user || !newWord.trim() || !selectedListId) return
    const { data, error } = await supabase.from('word_list_entries').insert({
      user_id: user.id,
      word_list_id: selectedListId,
      word: newWord.trim()
    }).select().single()

    if (data) {
      setEntries([...entries, data])
      setNewWord('')
    }
  }

  const removeWord = async (w_id) => {
    if (!user || !selectedListId) return;
    const { data, error } = await supabase.from('word_list_entries').delete().eq('id', w_id);

    fetchEntries(selectedListId)
  }
  
  const activeList = lists.find(l => l.id === selectedListId)

  return (
    <div className="flex h-full">
      {/* List Selector */}
      <div className="w-72 border-r bg-white p-6 overflow-y-auto flex flex-col">
        <h2 className="font-bold text-gray-700 uppercase tracking-wider text-xs mb-4">Your Word Lists</h2>
        <div className="space-y-1 flex-1">
          {lists.map(list => (
            <div 
              key={list.id}
              onClick={() => setSelectedListId(list.id)}
              className={`px-3 py-2 rounded-md cursor-pointer text-sm font-medium transition-colors ${selectedListId === list.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {list.name}
            </div>
          ))}
        </div>
        
        <div className="mt-8 border-t pt-4">
          <form onSubmit={(e) => { e.preventDefault(); createList() }}>
            <input 
              className="w-full px-3 py-2 border border-gray-300 rounded mb-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="New List Name..."
              value={newListName}
              onChange={e => setNewListName(e.target.value)}
            />
            <button className="w-full bg-gray-900 text-white text-xs font-bold py-2 rounded hover:bg-black transition-colors">Create List</button>
          </form>
        </div>
      </div>

      {/* Words Editor */}
      <div className="flex-1 p-8 overflow-y-auto bg-gray-50">
        {activeList ? (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold mb-8 text-gray-900">{activeList.name}</h2>
            
            <form onSubmit={e => { e.preventDefault(); addWord() }} className="flex gap-3 mb-8">
              <input 
                className="flex-1 p-3 border border-gray-300 rounded shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                placeholder="Add a new word..." 
                value={newWord}
                onChange={e => setNewWord(e.target.value)}
              />
              <button className="bg-blue-600 text-white px-6 py-3 rounded font-medium hover:bg-blue-700 shadow-sm transition-colors">Add Word</button>
            </form>

            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {entries.map(w => (
                  <li key={w.id} className="px-6 py-4 hover:bg-gray-50 transition-colors text-gray-700">{w.word}
                        <span class="text-gray-400 hover:text-black text-lg float-right cursor-pointer" onClick={e => { e.preventDefault(); removeWord(w.id) }}>☒</span>
                  </li>
                ))}
                {entries.length === 0 && <li className="px-6 py-8 text-center text-gray-400 italic">No words in this list yet.</li>}
              </ul>
            </div>
          </div>
        ) : (
          <div className="text-gray-400 flex items-center justify-center h-full">Select a list from the sidebar to edit</div>
        )}
      </div>
    </div>
  )
}
