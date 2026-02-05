'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '@/utils/supabase'
import { useQuizJob } from "@/components/QuizJobProvider";

export interface QuizListProps {
  onSelectQuiz: (id: number, attemptId?: number) => void
}

const PAGE_SIZE = 20;

export default function QuizList({ onSelectQuiz }: QuizListProps) {
  const [quizzes, setQuizzes] = useState<any[]>([])
  const [wordLists, setWordLists] = useState<{id: number, name: string}[]>([])
  const [selectedLists, setSelectedLists] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [resumableQuizzes, setResumableQuizzes] = useState<Record<number, boolean>>({})

  // Pagination State
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const { trackJob } = useQuizJob();

  // 1. Fetch available word lists (Generator dropdown) - Only once
  useEffect(() => {
    const fetchWordLists = async () => {
      const { data } = await supabase
        .from('word_lists')
        .select('id, name')
        .order('created_at', { ascending: false })
      if (data) setWordLists(data)
    }
    fetchWordLists()
  }, [])

  // 2. Fetch quizzes (Paginated & Efficient)
  const fetchQuizzes = useCallback(async () => {
    setLoading(true)
    const { data, error, count } = await supabase
      .from('quizzes')
      .select(`
        id,
        created_at,
        context,
        status,
        quiz_attempts(id, score, created_at),
        quiz_word_lists(word_lists(name))
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) console.error('Error fetching quizzes:', error)
    if (data) setQuizzes(data)
    if (count !== null) setTotalCount(count)
    setLoading(false)
  }, [page])

  useEffect(() => {
    fetchQuizzes()
  }, [fetchQuizzes, trackJob])

  // 3. Resumable Check
  useEffect(() => {
    const progressMap: Record<number, boolean> = {}
    quizzes.forEach(q => {
      if (localStorage.getItem(`quiz_progress_${q.id}`)) progressMap[q.id] = true
    })
    setResumableQuizzes(progressMap)
  }, [quizzes])

  // Generator Logic
  const handleGenerateQuiz = async () => {
    setGenerating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { new_quiz: { word_list_ids: selectedLists } }
      })
      if (error || !data) throw new Error(error || 'Failed to generate quiz')
      for (const [thread_id, thread] of Object.entries(data as any)) {
        if ((thread as any).status !== 'completed' && thread_id) trackJob(thread_id);
      }
      setPage(0)
      fetchQuizzes()
      setSelectedLists([])
      setShowMore(false)
    } catch (e) { console.error(e) } finally { setGenerating(false) }
  }

  const toggleList = (id: number) => setSelectedLists(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const quickAccess = wordLists.slice(0, 2)
  const remainingLists = wordLists.slice(2)
  const hiddenSelectedCount = selectedLists.filter(id => !quickAccess.find(q => q.id === id)).length

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-6 mb-8">
        <h2 className="text-2xl font-bold">Quizzes</h2>

        {/* Generator Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 flex-1">
             <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-2">New Quiz from:</span>
             {quickAccess.map(list => (
              <button key={list.id} onClick={() => toggleList(list.id)} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${selectedLists.includes(list.id) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}>{list.name}</button>
            ))}
            {remainingLists.length > 0 && (
              <div className="relative" ref={dropdownRef}>
                <button onClick={() => setShowMore(!showMore)} className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${hiddenSelectedCount > 0 ? 'bg-blue-100 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  {hiddenSelectedCount > 0 ? `+${hiddenSelectedCount} more` : 'More...'}
                </button>
                {showMore && (
                  <div className="absolute left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-50 p-2 max-h-64 overflow-y-auto">
                    {remainingLists.map(list => (
                      <label key={list.id} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-50 cursor-pointer group">
                        <input type="checkbox" checked={selectedLists.includes(list.id)} onChange={() => toggleList(list.id)} className="h-4 w-4 rounded border-gray-300 text-blue-600" />
                        <span className="text-sm text-gray-700 group-hover:text-blue-700">{list.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={handleGenerateQuiz} disabled={generating || selectedLists.length === 0} className={`px-6 py-2 rounded-lg font-bold text-white transition-all ${generating || selectedLists.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {generating ? 'Generating...' : 'Generate Quiz'}
          </button>
        </div>
      </div>

      {/* Top Pagination Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
        <div className="text-sm text-gray-500 font-medium">
          {loading ? 'Updating list...' : `Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount} quizzes`}
        </div>
        {totalCount > PAGE_SIZE && (
          <div className="flex gap-2">
            <button
              disabled={page === 0 || loading}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 text-sm font-semibold bg-white border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50 transition-colors shadow-sm"
            >
              Previous
            </button>
            <button
              disabled={(page + 1) * PAGE_SIZE >= totalCount || loading}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 text-sm font-semibold bg-white border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50 transition-colors shadow-sm"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Quiz Grid */}
      <div className="grid gap-4">
        {quizzes.map((quiz) => {
          const attempts = quiz.quiz_attempts?.sort((a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          ) || []
          const sourceLists = quiz.quiz_word_lists?.map((ql: any) => ql.word_lists?.name).filter(Boolean) || []

          return (
            <div key={quiz.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              {/*
                 FIX: Changed from flex to grid.
                 md:grid-cols-[1fr_160px] ensures the text gets all available space
                 while the button is pinned to a 160px wide column on the right.
              */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] items-start gap-4">

                {/* Left Column: Text Content (min-w-0 prevents text from pushing the grid) */}
                <div className="min-w-0">
                  <h3 className="font-bold text-xl text-gray-900 mb-1 truncate md:whitespace-normal">
                    {quiz.context?.title ?? 'Untitled Quiz'}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-gray-500 mb-3">
                    <span className="shrink-0">{new Date(quiz.created_at).toLocaleDateString()}</span>
                    <span>•</span>
                    <span className="capitalize shrink-0">{quiz.context?.type || 'Article'}</span>

                    {sourceLists.length > 0 && (
                      <div className="flex flex-wrap gap-1 border-l pl-3 border-gray-200">
                        {sourceLists.map((name: string, i: number) => (
                          <span key={i} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Status & History */}
                  {quiz.status !== 'ready' && (
                    <span className={`inline-block px-2 py-0.5 text-xs font-bold rounded mb-4 uppercase ${quiz.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {quiz.status}
                    </span>
                  )}

                  {attempts.length > 0 && (
                    <div className="mt-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter block mb-1">Previous Attempts</span>
                      <div className="flex flex-wrap gap-2">
                        {attempts.map((attempt: any) => (
                          <button key={attempt.id} onClick={() => onSelectQuiz(quiz.id, attempt.id)} className={`text-xs px-2 py-1 rounded border transition-colors font-medium ${attempt.score >= 80 ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' : 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100'}`}>
                            {Math.round(attempt.score)}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column: Fixed-width Action Button container */}
                <div className="flex md:justify-end">
                  {quiz.status === 'ready' && (
                    <button
                      onClick={() => onSelectQuiz(quiz.id)}
                      className={`w-full md:w-auto min-w-[140px] whitespace-nowrap px-4 py-2 rounded-lg font-semibold border transition-all ${
                        resumableQuizzes[quiz.id]
                        ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {resumableQuizzes[quiz.id] ? 'Resume Quiz' : 'Start New'}
                    </button>
                  )}
                </div>

              </div>
            </div>
          )
        })}
      </div>

      {quizzes.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
          No quizzes found. Select a word list above to generate one!
        </div>
      )}
    </div>
  )
}
