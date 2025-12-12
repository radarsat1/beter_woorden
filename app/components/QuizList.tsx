'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Database } from '@/lib/schema'

type Quiz = Database['public']['Tables']['quizzes']['Row']

interface QuizListProps {
  onSelectQuiz: (id: number, sessionId?: number) => void
}

export default function QuizList({ onSelectQuiz }: QuizListProps) {
  const [quizzes, setQuizzes] = useState<(Quiz & { 
    quiz_sessions: { id: number, score: number | null, created_at: string }[] 
  })[]>([])
  const [wordLists, setWordLists] = useState<{id: number, name: string}[]>([])
  const [selectedLists, setSelectedLists] = useState<number[]>([])
  const [loading,SF] = useState(true)
  const [generating, setGenerating] = useState(false)

  const fetchQuizzes = async () => {
    const { data } = await supabase
      .from('quizzes')
      .select('*, quiz_sessions(id, score, created_at)')
      .order('created_at', { ascending: false })
    if (data) setQuizzes(data as any)
    SF(false)

    // Fetch lists for generator
    const { data: lists } = await supabase.from('word_lists').select('id, name')
    if (lists) setWordLists(lists)
  }

  const toggleList = (id: number) => {
    if (selectedLists.includes(id)) setSelectedLists(selectedLists.filter(x => x !== id))
    else setSelectedLists([...selectedLists, id])
  }

  useEffect(() => {
    fetchQuizzes()
  }, [])

  const generateQuizStub = async () => {
    setGenerating(true)
    // Stub: In a real app this would call an API or use selected lists
    const user = (await supabase.auth.getUser()).data.user
    if (!user) return

    // 1. Create Quiz
    const { data: quiz, error: qError } = await supabase
      .from('quizzes')
      .insert({
        user_id: user.id,
        article_title: 'Random Dutch Exercise ' + new Date().toLocaleTimeString(),
        article_url: 'http://example.com',
        status: 'in_progress'
      })
      .select()
      .single()

    if (qError || !quiz) {
      console.error(qError)
      setGenerating(false)
      return
    }
    
    // Link word lists
    if (selectedLists.length > 0) {
      await supabase.from('quiz_word_lists').insert(
        selectedLists.map(lid => ({ quiz_id: quiz.id, word_list_id: lid }))
      )
    }


    // 2. Create Stub Questions
    const stubQuestions = [
      {
        quiz_id: quiz.id,
        question: 'De ___ zit op de mat.',
        word: 'kat',
        english: 'The cat sits on the mat.',
        question_order: 1
      },
      {
        quiz_id: quiz.id,
        question: 'Ik heb een ___ fiets.',
        word: 'nieuwe',
        english: 'I have a new bicycle.',
        question_order: 2
      },
      {
        quiz_id: quiz.id,
        question: 'Hij ___ naar school.',
        word: 'loopt',
        english: 'He walks to school.',
        question_order: 3
      }
    ]

    await supabase.from('quiz_questions').insert(stubQuestions)

    await fetchQuizzes()
    setGenerating(false)
  }

  if (loading) return <div>Loading quizzes...</div>

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Quizzes</h2>
        <div className="flex gap-4 items-center">
          <div className="flex gap-2">
            {wordLists.map(l => (
              <label key={l.id} className="flex items-center space-x-1 text-sm bg-gray-100 px-2 py-1 rounded cursor-pointer select-none hover:bg-gray-200">
                <input 
                  type="checkbox" 
                  checked={selectedLists.includes(l.id)} 
                  onChange={() => toggleList(l.id)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span>{l.name}</span>
              </label>
            ))}
          </div>
          <button 
            onClick={generateQuizStub}
            disabled={generating}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 shadow font-medium transition-colors"
          >
            {generating ? 'Generating...' : 'Generate New Quiz'}
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {quizzes.map((quiz) => {
          const sessions = quiz.quiz_sessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          return (
          <div 
            key={quiz.id}
            className="bg-white p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-200"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-xl text-gray-900 mb-1">{quiz.article_title || 'Untitled Quiz'}</h3>
                <p className="text-sm text-gray-500">{new Date(quiz.created_at).toLocaleDateString()}</p>
                
                {sessions.length > 0 && (
                  <div className="mt-4">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">History</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {sessions.map(s => (
                        <button
                          key={s.id}
                          onClick={() => onSelectQuiz(quiz.id, s.id)}
                          className={`text-xs px-2 py-1 rounded border ${s.score !== null ? 'bg-green-50 border-green-200 text-green-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100'}`}
                        >
                          {s.score !== null ? `${Math.round(s.score)}%` : 'In Progress'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => onSelectQuiz(quiz.id)} className="text-sm border border-gray-300 px-3 py-1 rounded hover:bg-gray-50 text-gray-700">
                Start New
              </button>
            </div>
          </div>
        )})}
      </div>
    </div>
  )
}
