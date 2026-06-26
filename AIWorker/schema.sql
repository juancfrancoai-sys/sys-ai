-- Schema para AIWorker
-- Ejecutar en Neon SQL Editor

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  first_contact_at TIMESTAMPTZ DEFAULT NOW(),
  last_contact_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  summary TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  sender TEXT CHECK (sender IN ('client', 'ai')),
  type TEXT DEFAULT 'text' CHECK (type IN ('text', 'image', 'audio', 'document')),
  content TEXT,
  media_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_settings (
  id SERIAL PRIMARY KEY,
  personality_prompt TEXT DEFAULT 'Sos un asistente amable y profesional.',
  welcome_message TEXT DEFAULT '¡Hola! ¿En qué te puedo ayudar hoy?',
  business_description TEXT DEFAULT 'Negocio general',
  goals TEXT,
  restrictions TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar configuración por defecto
INSERT INTO ai_settings (personality_prompt, business_description)
VALUES (
  'Sos un asistente amable, profesional y conciso. Respondés como si fuera una conversación natural de WhatsApp, sin ser demasiado formal.',
  'Asistente de WhatsApp'
) ON CONFLICT DO NOTHING;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
