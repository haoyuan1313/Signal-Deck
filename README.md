# SignalDeck 🚀

SignalDeck is a high-performance web dashboard for monitoring Smart Money Concepts (SMC) crypto trading bots. It provides real-time visibility into strategy execution, trade history, and bot diagnostics.

## Features

- **Executive Dashboard**: KPI cards for Win Rate, Total R, Active Positions, and Area Charts for Equity Growth.
- **Real-time Engine**: Powered by Supabase Realtime for instant trade/signal updates and CCXT for live price polling from Bybit.
- **Signal Diagnostics**: Deep-dive into WHY signals were rejected (no sweep, MTF mismatch, etc.) with analytical pie charts.
- **Remote Config**: Pause the bot or change trading pairs directly from the web UI.
- **Mobile Optimized**: Responsive design tailored for monitoring on the go.

## Tech Stack

- **Frontend**: Vite + React + TypeScript + Tailwind CSS
- **State**: Zustand + Supabase Realtime
- **Charts**: Recharts
- **Database/Backend**: Supabase (Postgres)
- **Integration**: Python bridge for existing bot logic

## Setup & Deployment

### 1. Supabase Setup
- Create a new project at [Supabase](https://supabase.com).
- Run the SQL contained in `supabase.sql` in the Supabase SQL Editor.
- Enable Google Auth or use the provided RLS policies for simple access.

### 2. Environment Variables
Copy `.env.example` to `.env` and fill in:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 3. Deploy
- **Frontend**: Connect this repo to Vercel/Netlify.
- **Bot**: Point your Python bot at your Supabase instance using the helper in `/python-bot/`.

### 4. Running Locally
```bash
npm install
npm run dev
```

## Python Bot Integration
Check the `/python-bot/` folder for the `supabase_client.py` utility. It replaces your `trades.json` workflow with a robust database connection.
