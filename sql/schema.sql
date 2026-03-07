CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE app_role AS ENUM ('lecturer','student');
CREATE TYPE enrollment_status AS ENUM ('pending','approved');

CREATE TABLE IF NOT EXISTS courses (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    lecturer TEXT NOT NULL,
    schedule TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email CITEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role app_role NOT NULL,
    headline TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_courses (
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    PRIMARY KEY (user_id, course_code)
);

CREATE TABLE IF NOT EXISTS course_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    status enrollment_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollment_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_name TEXT NOT NULL,
    course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    submitted_on DATE NOT NULL DEFAULT current_date
);

CREATE TABLE IF NOT EXISTS exam_briefs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    course_code TEXT NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    exam_window TEXT NOT NULL,
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    launched BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mock_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id TEXT NOT NULL REFERENCES exam_briefs(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    correct_index INT NOT NULL,
    tip TEXT
);

CREATE TABLE IF NOT EXISTS mock_question_options (
    question_id UUID NOT NULL REFERENCES mock_questions(id) ON DELETE CASCADE,
    option_index INT NOT NULL,
    option_text TEXT NOT NULL,
    PRIMARY KEY (question_id, option_index)
);

CREATE TABLE IF NOT EXISTS exam_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id TEXT NOT NULL REFERENCES exam_briefs(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES mock_questions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    selected_index INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (question_id, user_id)
);

CREATE TABLE IF NOT EXISTS feedback_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    score INT NOT NULL,
    sent BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_enrollments_user ON course_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_code);
CREATE INDEX IF NOT EXISTS idx_exam_responses_exam_user ON exam_responses(exam_id, user_id);
