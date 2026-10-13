-- V5.20 Cloud First for Portfolio Tracker
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'Primary',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO users (id, label) VALUES ('primary', 'Primary');

-- Lossless canonical cloud copy of the app state. V5.20 treats this as the primary synced state.
CREATE TABLE IF NOT EXISTS portfolio_state (
  user_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  device_id TEXT,
  local_updated_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One pre-overwrite backup per calendar day. This keeps migration reversible without exploding storage.
CREATE TABLE IF NOT EXISTS portfolio_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  backup_date TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, backup_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_portfolio_backups_user_date ON portfolio_backups(user_id, backup_date DESC);

-- Normalized query tables maintained from the canonical cloud state. localStorage remains an offline cache.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  balance REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  category TEXT,
  note TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  account_id TEXT,
  from_account_id TEXT,
  to_account_id TEXT,
  affects_balance INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS investment_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cash_cad REAL NOT NULL DEFAULT 0,
  net_deposits_cad REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS investment_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  shares REAL NOT NULL,
  cost_per_share REAL NOT NULL,
  opening_position INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_investment_lots_account_ticker ON investment_lots(user_id, account_id, ticker, trade_date);

CREATE TABLE IF NOT EXISTS net_worth_daily (
  user_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  net_worth REAL NOT NULL,
  net_asset_base REAL,
  investment_growth REAL,
  debts REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, snapshot_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
