-- Align fixed-width CHAR columns with VARCHAR so Hibernate schema validation matches.
ALTER TABLE user_profiles ALTER COLUMN country TYPE VARCHAR(2);
ALTER TABLE refresh_tokens ALTER COLUMN token_hash TYPE VARCHAR(64);
ALTER TABLE email_verification_tokens ALTER COLUMN token_hash TYPE VARCHAR(64);
ALTER TABLE password_reset_tokens ALTER COLUMN token_hash TYPE VARCHAR(64);

INSERT INTO conversation_topics (slug, name, description, prompts, sort_order) VALUES
('daily-life', 'Daily life', 'Routines, home, food and everyday situations.', ARRAY[
  'Describe a typical day in your life.',
  'What is your favourite meal to cook or eat, and why?',
  'How has your daily routine changed in the last few years?',
  'What is one small habit that makes your day better?'], 1),
('education', 'Education', 'Studying, learning and school experiences.', ARRAY[
  'What was your favourite subject at school and why?',
  'How do you prefer to learn something new?',
  'What would you change about the education system in your country?',
  'Is there a skill you wish you had learned earlier?'], 2),
('technology', 'Technology', 'Devices, software and how technology shapes life.', ARRAY[
  'Which app or tool could you not live without?',
  'How has technology changed the way you work or study?',
  'What technology do you think will matter most in ten years?',
  'Do you think people spend too much time on their phones?'], 3),
('career', 'Career', 'Work, goals and professional life.', ARRAY[
  'What do you do, and what do you enjoy most about it?',
  'Where would you like your career to be in five years?',
  'Describe a challenge at work and how you handled it.',
  'What makes a good colleague or manager?'], 4),
('travel', 'Travel', 'Places, cultures and journeys.', ARRAY[
  'What is the most memorable place you have visited?',
  'If you could live in another country, where would it be?',
  'Do you prefer planned trips or spontaneous ones?',
  'What is something about your country visitors should know?'], 5),
('hobbies', 'Hobbies', 'Free time, sport, music and creative interests.', ARRAY[
  'What do you do to relax at the weekend?',
  'Is there a hobby you would like to start?',
  'What kind of music or films do you enjoy?',
  'Tell me about something you have made or built.'], 6),
('current-affairs', 'Current affairs', 'News, society and ideas (keep it respectful).', ARRAY[
  'What is a news story you have followed recently?',
  'How do you usually keep up with the news?',
  'What is one local issue you care about?',
  'How can people disagree respectfully?'], 7),
('personal-experiences', 'Personal experiences', 'Stories from your own life.', ARRAY[
  'Tell me about a time you tried something new.',
  'What is the best advice you have ever received?',
  'Describe a moment that made you proud.',
  'Tell me about a person who has influenced you.'], 8),
('interview-practice', 'Interview practice', 'Practise answering common interview questions.', ARRAY[
  'Tell me about yourself.',
  'What are your greatest strengths?',
  'Describe a time you worked in a team.',
  'Why are you interested in this role?'], 9),
('general', 'General discussion', 'No fixed subject. Talk about anything.', ARRAY[
  'What is something interesting you learned recently?',
  'What are you looking forward to this month?',
  'If you could have dinner with anyone, who would it be?',
  'What makes you laugh?'], 10);
