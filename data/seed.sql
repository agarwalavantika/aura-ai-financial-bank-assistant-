CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  locale TEXT DEFAULT 'en-IN'
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('checking','savings')),
  currency TEXT DEFAULT 'INR',
  balance NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  dsl TEXT NOT NULL,
  compiled JSONB,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT now()
);

INSERT INTO users (id,email,display_name) VALUES
('00000000-0000-0000-0000-000000000001','asha@example.com','Asha')
ON CONFLICT DO NOTHING;

INSERT INTO accounts (user_id,type,balance) VALUES
('00000000-0000-0000-0000-000000000001','checking',15200),
('00000000-0000-0000-0000-000000000001','savings',5200)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  merchant TEXT
);

-- sample data
INSERT INTO transactions(user_id,category,amount,merchant,posted_at)
VALUES
('u1','Dining', 18,'Cafe Rio', now()-interval '2 day'),
('u1','Dining', 42,'Pizza Hub', now()-interval '1 day'),
('u1','Subscriptions',14.99,'StreamPlus', now()-interval '35 day'),
('u1','Subscriptions',14.99,'StreamPlus', now()-interval '5 day'),
('u1','Groceries', 120,'FreshMart', now()-interval '1 day');
