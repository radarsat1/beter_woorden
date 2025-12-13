'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { Database } from '@/lib/schema'
import { useAuth } from './AuthProvider'

type Question = Database['public']['Tables']['quiz_questions']['Row']
type Attempt = Database['public']['Tables']['quiz_attempts']['Row']

interface QuizRunnerProps {
  quizId: number
  onFinish: (sessionId: number) => void
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]/g, '')

export default function QuizRunner({ quizId, onFinish }: QuizRunnerProps) {
  const { user } = useAuth()
  const [questions, setQuestions] = useState<Question[]>([])
  const [attempts, setAttempts] = useState<Record<number, Partial<Attempt>>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [furthestIndex, setFurthestIndex] = useState(0)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sessionId, setSessionId] = useState<number | null>(null)
  
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const loadQuiz = async () => {
      // Load questions
      const { data: qData } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('quiz_id', quizId)
        .order('question_order')
      
      if (!qData) return

      // Create new session or fetch unfinished one? 
      // For simplicity in this iteration, we always start a new session when entering "Runner" 
      // unless we pass a sessionId to resume. Since the interface splits "Start New" and "History",
      // we will assume "Start New" for now.

      const { data: session } = await supabase
        .from('quiz_sessions')
        .insert({
          quiz_id: quizId,
          user_id: user!.id,
          score: null // in progress
        })
        .select('*')
        .single()
      
      if (!session) return 

      setQuestions(qData)
      setSessionId(session.id)
      setLoading(false)
    }

    if (user) loadQuiz()
  }, [quizId, user])

  // Cleanup attempts map type
  const getAttempt = (qId: number) => attempts[qId]

  const isReplay = currentIndex < furthestIndex

  useEffect(() => {
    if (!loading && inputRef.current) {
      inputRef.current.focus()
    }
  }, [currentIndex, loading])

  // Setup word bank
  const allWords = questions.map(q => q.word).sort()
  const usedWords = Object.values(attempts).map(a => normalize(a?.attempt || ''))
  
  // We need to count frequency to handle duplicates correctly in the word bank crossing out
  const usedCounts: Record<string, number> = {}
  usedWords.forEach(w => usedCounts[w] = (usedCounts[w] || 0) + 1)

  const saveAttempt = async (val: string) => {
    if (!user || !sessionId || currentIndex >= questions.length) return

    const currentQ = questions[currentIndex]
    const isCorrect = normalize(val) === normalize(currentQ.word)
    
    // Optimistic update
    const newAttempt = {
      id: -1, // temp
      question_id: currentQ.id,
      session_id: sessionId,
      user_id: user.id,
      attempt: val,
      is_correct: isCorrect,
      created_at: newDv()
    }
    
    setAttempts(prev => ({ ...prev, [currentQ.id]: newAttempt }))

    // Persist
    const { error } = await supabase.from('quiz_attempts').upsert({
      question_id: currentQ.id,
      session_id: sessionId,
      user_id: user.id,
      attempt: val,
      is_correct: isCorrect
    }, { onConflict: 'question_id,session_id' })

    if (error) console.error(error)
  }

  const handleNext = async () => {
    if (input.trim()) {
      await saveAttempt(input.trim())
    }
    setInput('')

    if (isReplay) {
      // Jump back to furthest
      setCurrentIndex(furthestIndex)
    } else {
      // Advance
      const next = currentIndex + 1
      setCurrentIndex(curr => curr + 1)
      setFurthestIndex(next)
    }
  }

  const handleFinish = async () => {
    // Calc score
    const correct = Object.values(attempts).filter(a => a.is_correct).length
    const score = (correct / questions.length) * 100
    
    if (sessionId) {
      await supabase.from('quiz_sessions').update({ score }).eq('id', sessionId)
    }
    
    // Maybe update quiz status if needed, but quiz is reusable now.
    // await supabase.from('quizzes').update({ status: 'finished' }).eq('id', quizId)
    if (sessionId) onFinish(sessionId)
  }

  const jumpTo = (idx: number) => {
    // Only allow jumping to previous or the immediate next
    if (idx <= Object.keys(attempts).length) {
      setCurrentIndex(idx)
      // Pre-fill input if there is an existing attempt
      const qId = questions[idx]?.id
      if (getAttempt(qId)) {
        setInput(getAttempt(qId)?.attempt || '')
      } else {
        setInput('')
      }
    }
  }

  if (loading) return <div>Loading quiz...</div>

  if (currentIndex >= questions.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <h2 className="text-2xl font-bold mb-4">Quiz Completed!</h2>
        <p className="mb-6">You have answered all questions.</p>
        <div className="flex gap-4">
          <button onClick={() => jumpTo(questions.length - 1)} className="px-4 py-2 border border-black rounded hover:bg-gray-50">Review Answers</button>
          <button onClick={handleFinish} className="bg-black text-white px-6 py-2 rounded font-bold hover:bg-gray-800 shadow-lg">Finish & See Results</button>
        </div>
        <div className="mt-8 text-sm text-gray-500">
          Total answered: {Object.keys(attempts).length} / {questions.length}
        </div>
      </div>
    )
  }

  const currentQ = questions[currentIndex]

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-4">
      {/* Word Bank */}
      <div className="bg-gray-100 p-4 rounded mb-6">
        <h3 className="text-xs font-bold uppercase text-gray-500 mb-3 tracking-wide">Word Bank</h3>
        <div className="flex flex-wrap gap-2">
          {allWords.map((w, i) => {
            const norm = normalize(w)
            const isUsed = (usedCounts[norm] || 0) > 0
            if (isUsed) usedCounts[norm]--
            
            return isUsed ? (
              <span key={i} className="px-2 py-1 rounded bg-gray-200 text-gray-400 border border-transparent line-through decoration-gray-400">{w}</span>
            ) : (
              <span key={i} className="px-2 py-1 rounded bg-white text-blue-700 border border-blue-200 shadow-sm">{w}</span>
            )
          })}
        </div>
      </div>

      {/* History / Progress */}
      <div className="flex-1 overflow-y-auto mb-6 space-y-2">
        {questions.map((q, idx) => {
          if (idx >= currentIndex) return null
          const att = getAttempt(q.id)
          return (
            <div 
              key={q.id} 
              onClick={() => jumpTo(idx)}
              className="p-3 rounded-lg hover:bg-gray-100 cursor-pointer border border-transparent hover:border-gray-300 transition-colors flex items-center justify-between group"
            >
              <div className="text-gray-800">
                <span className="text-gray-400 font-mono text-sm mr-3">{idx + 1}.</span>
                {q.question.replace('___', '___')} <span className="text-blue-600 font-bold ml-2">{att?.attempt}</span>
              </div>
              <div className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 uppercase tracking-wider font-bold">
                Edit
              </div>
            </div>
          )
        })}
      </div>

      {/* Active Question Card */}
      <div className="bg-white p-8 rounded-xl shadow-xl border border-gray-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-purple-600"></div>
        <div className="mb-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Question {currentIndex + 1} / {questions.length} {isReplay && <span className="text-yellow-600 ml-2">Reviewing</span>}</div>
        <div className="text-3xl mb-8 leading-snug font-light text-gray-800">
          {currentQ.question.split('___').map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 && (
                <span className="inline-block border-b-2 border-blue-500 w-32 mx-2 text-center text-blue-600 font-bold animate-pulse">
                  {input || '?'}
                </span>
              )}
            </span>
          ))}
        </div>
        
        <form onSubmit={(e) => { e.preventDefault(); handleNext(); }} className="flex gap-4">
          <input
            ref={inputRef}
            className="flex-1 p-4 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none text-xl transition-all shadow-inner"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button type="submit" className="bg-blue-600 text-white px-8 py-4 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">Submit</button>
        </form>
      </div>
    </div>
  )
}

function newDv() { return new Date().toISOString() }
