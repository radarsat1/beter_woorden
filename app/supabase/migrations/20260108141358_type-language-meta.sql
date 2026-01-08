-- Migration script to add fields "language" and "type" to "quizzes"

ALTER TABLE quizzes
ADD COLUMN language VARCHAR(255) NOT NULL DEFAULT 'Dutch',
ADD COLUMN type VARCHAR(255) NOT NULL DEFAULT 'masked-word';

-- Update existing records to set defaults
UPDATE quizzes
SET language = 'dutch',
    type = 'masked-word';
