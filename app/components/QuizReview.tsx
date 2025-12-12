'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/utils/supabase'
import { Database } from '@/lib/schema'

type Question = Database['public']['Tables']['quiz_questions']['Row'] & {
  quiz_attempts: Database['public']['Tables']['quiz_attempts']['Row'][]
}

export default function QuizReview({ quizId, sessionId, onBack }: { quizId: number, sessionId: number, onBack: () => void }) {
  const [questions,SF] = useState<Question[]>([])
  const [loading,SL] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      const { data } = await supabase
        .from('quiz_questions')
        .select('*, quiz_attempts(*)')
        .eq('quiz_attempts.session_id', sessionId)
        .eq('quiz_id', quizId)
        .order('question_order')
      
      // Filter out attempts that don't match session (Supabase select join caveat if not using inner join properly or just filtering in app)
      // Actually, standard left join might return null attempts if no match, or all attempts. 
      // RLS policies might restrict. Let's simplify by post-filtering.
      if (data) {
        const filtered = data.map(q => ({
          ...q,
          quiz_attempts: q.quiz_attempts.filter(a => a.session_id === sessionId)
        }))
        SF(filtered as Question[])
      }
      SL(false)
    }
    fetchData()
  }, [quizId, sessionId])

  if (loading) return <div>Loading review...</div>

  const correctCount = questions.filter(q => q.quiz_attempts?.[0]?.is_correct).length
  const score = Math.round((correctCount / questions.length) * 100) || 0

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={onBack} className="mb-6 text-gray-500 hover:text-black flex items-center gap-1 font-medium transition-colors">← Back to Quizzes</button>
      
      <div className="bg-white p-8 rounded-lg shadow-md border border-gray-100 mb-8 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Quiz Results</h1>
        <div className="text-2xl text-gray-700 font-medium">Score: <span className={`${score >= 80 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-600'} font-bold`}>{score}%</span></div>
      </div>

      <div className="space-y-4">
        {questions.map((q, idx) => {
          const attempt = q.quiz_attempts?.[0]
          const isCorrect = attempt?.is_correct
          
          // Reconstruct sentence with markup
          const parts = q.question.split('___')
          
          return (
            <div key={q.id} className={`p-5 rounded-lg border ${isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'} shadow-sm`}>
              <div className="mb-2 text-lg leading-relaxed">
                <span className="font-bold text-gray-400 mr-3 select-none">{idx + 1}.</span>
                <span>{parts[0]}</span>
                {isCorrect ? (
                  <span className="font-bold text-green-700 mx-1">{q.word}</span>
                ) : (
                  <span className="mx-1">
                    <span className="line-through text-red-500 decoration-2 decoration-red-500 mr-2">{attempt?.attempt || '(empty)'}</span>
                    <span className="font-bold text-green-700 bg-green-100 px-1 rounded">{q.word}</span>
                  </span>
                )}
                <span>{parts[1] || ''}</span>
              </div>
              
              {q.english && (
                <div className="text-gray-600 italic ml-6">
                  {q.english}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
