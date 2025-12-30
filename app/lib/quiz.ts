
import { Database } from '@/lib/schema'

// Define the shape of the JSON content
export interface QuestionItem {
  question: string;
  answer: string; // The correct word
  english?: string;
}

export function isQuestionItem(item: any): item is QuestionItem {
  return (
    item !== null &&
    typeof item === 'object' &&
    typeof item.question === 'string' &&
    typeof item.answer === 'string' &&
    (typeof item.english === 'string' || !item.english)
  );
}

export function isQuestionArray(data: any): data is QuestionItem[] {
  return Array.isArray(data) && data.every(isQuestionItem);
}

// Update Type Definition based on Hybrid Schema
export type QuizRow = Database['public']['Tables']['quizzes']['Row'] & {
  context: {
    title?: string;
    type?: string;
    url?: string;
  };
};

export type QuizAttempt = Database['public']['Tables']['quiz_attempts']['Row']

// Composite type for the view
export type QuizWithHistory = QuizRow & {
  quiz_attempts: Pick<QuizAttempt, 'id' | 'score' | 'created_at'>[]
}
