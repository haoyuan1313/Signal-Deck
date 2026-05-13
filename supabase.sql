-- Supabase Schema for Trading Bot

-- 1. Create User API Keys table first (Primary dependency)
CREATE TABLE IF NOT EXISTS public.user_api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'My Account'::text,
  bybit_api_key_enc text NOT NULL,
  bybit_api_secret_enc text NOT NULL,
  bybit_api_key_hint text NOT NULL,
  bybit_testnet boolean DEFAULT true,
  account_type text DEFAULT 'swap'::text,
  is_active boolean DEFAULT true,
  last_verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_api_keys_pkey PRIMARY KEY (id)
);

-- 2. Create dependant tables
CREATE TABLE IF NOT EXISTS public.bot_execution_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message text NOT NULL,
  type text DEFAULT 'info'::text CHECK (type = ANY (ARRAY['info'::text, 'loop'::text, 'check'::text, 'reject'::text, 'accept'::text])),
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid,
  CONSTRAINT bot_execution_logs_pkey PRIMARY KEY (id),
  CONSTRAINT bot_execution_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_api_keys(user_id)
);

CREATE TABLE IF NOT EXISTS public.bot_heartbeat (
  id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  last_ping timestamp with time zone DEFAULT now(),
  user_id uuid,
  CONSTRAINT bot_heartbeat_pkey PRIMARY KEY (id),
  CONSTRAINT bot_heartbeat_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_api_keys(user_id)
);

CREATE TABLE IF NOT EXISTS public.bot_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbols text[] DEFAULT '{}'::text[],
  timeframe text DEFAULT '5m'::text,
  htf_timeframe text DEFAULT '1h'::text,
  htf2_timeframe text DEFAULT '4h'::text,
  rr numeric DEFAULT 2.0,
  allowed_directions text[] DEFAULT '{long,short}'::text[],
  paused boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  bars integer DEFAULT 500,
  paper_trading boolean DEFAULT true,
  risk_percent double precision DEFAULT 1.5,
  max_concurrent_trades integer DEFAULT 2,
  max_daily_loss_r numeric DEFAULT '-3.0'::numeric,
  allowed_sessions text[] DEFAULT '{london,ny_am,ny_pm}'::text[],
  atr_period integer DEFAULT 14,
  require_4h_align boolean DEFAULT true,
  user_id uuid UNIQUE,
  CONSTRAINT bot_settings_pkey PRIMARY KEY (id),
  CONSTRAINT bot_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_api_keys(user_id)
);

CREATE TABLE IF NOT EXISTS public.system_users (
  user_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  session_token text,
  session_expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT system_users_pkey PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS public.telegram_config (
  id text NOT NULL DEFAULT 'singleton'::text,
  bot_token_enc text,
  chat_id text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT telegram_config_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.managed_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  min_risk_r numeric DEFAULT 0.5,
  max_risk_r numeric DEFAULT 5.0,
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT managed_assets_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.openclaw_autopilot (
  id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  enabled boolean DEFAULT false,
  interval_hours integer DEFAULT 24,
  candidate_pool_size integer DEFAULT 20,
  backtest_bars integer DEFAULT 5000,
  last_run_at timestamp with time zone,
  last_run_status text,
  last_run_message text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT openclaw_autopilot_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.openclaw_recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'manual'::text,
  ranked_symbols jsonb NOT NULL,
  proposed_top_3 text[] NOT NULL,
  current_symbols text[],
  status text NOT NULL DEFAULT 'pending'::text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone,
  CONSTRAINT openclaw_recommendations_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.signals_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  direction text NOT NULL,
  reason text NOT NULL,
  price numeric NOT NULL,
  htf_trend text,
  htf2_regime text,
  created_at timestamp with time zone DEFAULT now(),
  user_id uuid,
  CONSTRAINT signals_log_pkey PRIMARY KEY (id),
  CONSTRAINT signals_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_api_keys(user_id)
);

CREATE TABLE IF NOT EXISTS public.trades (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  direction text NOT NULL,
  entry numeric NOT NULL,
  sl_init numeric NOT NULL,
  sl numeric NOT NULL,
  tp numeric NOT NULL,
  rr numeric NOT NULL,
  risk numeric NOT NULL,
  bars_held integer DEFAULT 0,
  be_armed boolean DEFAULT false,
  status text DEFAULT 'open'::text,
  outcome integer CHECK (outcome = ANY (ARRAY[1, 0, -1])),
  r numeric,
  exit_price numeric,
  opened_at timestamp with time zone DEFAULT now(),
  closed_at timestamp with time zone,
  user_id uuid,
  exchange_type text DEFAULT 'linear'::text,
  is_paper boolean DEFAULT true,
  order_id text,
  amount double precision,
  CONSTRAINT trades_pkey PRIMARY KEY (id),
  CONSTRAINT trades_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_api_keys(user_id)
);
