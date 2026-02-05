'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { useQuizJob } from "@/components/QuizJobProvider";
import { QuizWithHistory } from '@/lib/quiz'

export interface QuizListProps {
  onSelectQuiz: (id: number, attemptId?: number) => void
}

interface GenerateResponseItem { status: string; }
interface GenerateResponse extends Record<string, GenerateResponseItem> {};

export default function QuizList({ onSelectQuiz }: QuizListProps) {
  const [quizzes, setQuizzes] = useState<QuizWithHistory[]>([])
  const [wordLists, setWordLists] = useState<{id: number, name: string}[]>([])
  const [selectedLists, setSelectedLists] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [resumableQuizzes, setResumableQuizzes] = useState<Record<number, boolean>>({})

  const dropdownRef = useRef<HTMLDivElement>(null)
  const { trackJob } = useQuizJob();

  // 1. Fetch Data
  const fetchData = async () => {
    // Fetch Word Lists (Recent first)
    const { data: lists } = await supabase
      .from('word_lists')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
    if (lists) setWordLists(lists)

    // Fetch Quizzes
    const { data: qData, error } = await supabase
      .from('quizzes')
      .select('*, quiz_attempts(id, score, created_at)')
      .order('created_at', { ascending: false })

    if (error) console.error('Error fetching quizzes:', error)
    if (qData) setQuizzes(qData as any)
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [trackJob])

  // 2. Check LocalStorage for resumable quizzes
  useEffect(() => {
    const progressMap: Record<number, boolean> = {}
    quizzes.forEach(q => {
      if (localStorage.getItem(`quiz_progress_${q.id}`)) {
        progressMap[q.id] = true
      }
    })
    setResumableQuizzes(progressMap)
  }, [quizzes])

  // 3. Dropdown outside-click logic
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowMore(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const toggleList = (id: number) => {
    setSelectedLists(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleGenerateQuiz = async () => {
    setGenerating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { new_quiz: { word_list_ids: selectedLists } }
      }) as { data?: GenerateResponse; error?: string | null };

      if (error || !data) throw new Error(error || 'Failed to generate quiz')

      for (const [thread_id, thread] of Object.entries(data)) {
        if (thread.status !== 'completed' && thread_id) trackJob(thread_id);
      }

      await fetchData()
      setSelectedLists([])
      setShowMore(false)
    } catch (e: any) {
      console.error('Generation failed:', e)
    } finally {
      setGenerating(false)
    }
  }

  // Logic for Hybrid UI
  const quickAccessCount = 2
  const quickAccess = wordLists.slice(0, quickAccessCount)
  const remainingLists = wordLists.slice(quickAccessCount)
  const hiddenSelectedCount = selectedLists.filter(id =>
    !quickAccess.find(q => q.id === id)
  ).length

  if (loading) return <div className="p-6">Loading quizzes...</div>

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-6 mb-8">
        <h2 className="text-2xl font-bold">Quizzes</h2>

        {/* Improved Generator Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-2">New Quiz from:</span>
          </div>
            {/* Quick Access Pills */}
            {quickAccess.map(list => (
              <button
                key={list.id}
                onClick={() => toggleList(list.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                  selectedLists.includes(list.id)
                    ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {list.name}
              </button>
            ))}

            {/* "More" Dropdown Button */}
            {remainingLists.length > 0 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowMore(!showMore)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                    hiddenSelectedCount > 0
                      ? 'bg-blue-100 border-blue-200 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {hiddenSelectedCount > 0 ? `+${hiddenSelectedCount} more` : 'More...'}
                  <svg className={`w-4 h-4 transition-transform ${showMore ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </button>

                {showMore && (
                  <div className="absolute left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 p-2 max-h-64 overflow-y-auto">
                    {remainingLists.map(list => (
                      <label key={list.id} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-50 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={selectedLists.includes(list.id)}
                          onChange={() => toggleList(list.id)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 group-hover:text-blue-700">{list.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

          <button
            onClick={handleGenerateQuiz}
            disabled={generating || selectedLists.length === 0}
            className={`px-6 py-2 rounded-lg font-bold transition-all text-white shadow-md
              ${generating || selectedLists.length === 0
                ? 'bg-gray-300 cursor-not-allowed shadow-none'
                : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
          >
            {generating ? 'AI Generating...' : 'Generate Quiz'}
          </button>
        </div>
      </div>

      {/* Quiz Grid */}
      <div className="grid gap-4">
        {quizzes.map((quiz) => {
          const attempts = quiz.quiz_attempts?.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          ) || []

          return (
            <div key={quiz.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <div className="flex flex-col md:flex-row justify-between md:items-start gap-4">
                <div className="flex-1">
                  <h3 className="font-bold text-xl text-gray-900 mb-1">
                    {quiz.context?.title ?? 'Untitled Quiz'}
                  </h3>

                  <div className="flex gap-2 text-sm text-gray-500 mb-3">
                    <span>{new Date(quiz.created_at).toLocaleDateString()}</span>
                    <span>•</span>
                    <span className="capitalize">{quiz.context?.type || 'Article'}</span>
                  </div>

                  {/* Status Badges */}
                  {quiz.status !== 'ready' && (
                    <span className={`inline-block px-2 py-0.5 text-xs font-bold rounded mb-4 uppercase ${
                      quiz.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {quiz.status}
                    </span>
                  )}

                  {/* History / Attempts */}
                  {attempts.length > 0 && (
                    <div className="mt-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Previous Attempts</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {attempts.map(attempt => (
                          <button
                            key={attempt.id}
                            onClick={() => onSelectQuiz(quiz.id, attempt.id)}
                            className={`text-xs px-2 py-1 rounded border transition-colors font-medium
                              ${attempt.score >= 80
                                ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                                : 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100'
                              }`}
                          >
                            {Math.round(attempt.score)}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {quiz.status === 'ready' && (
                  <button
                    onClick={() => onSelectQuiz(quiz.id)}
                    className={`whitespace-nowrap px-4 py-2 rounded-lg font-semibold border transition-all
                      ${resumableQuizzes[quiz.id]
                        ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  >
                    {resumableQuizzes[quiz.id] ? 'Resume Quiz' : 'Start New'}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {quizzes.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            No quizzes found. Select a word list above to generate your first one!
          </div>
        )}
      </div>
    </div>
  )
}
