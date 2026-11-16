CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(20) NULL,
  password_hash VARCHAR(255) NULL,
  coins INT UNSIGNED NOT NULL,
  highscore INT UNSIGNED NOT NULL DEFAULT 0,
  best_distance INT UNSIGNED NOT NULL DEFAULT 0,
  total_runs INT UNSIGNED NOT NULL DEFAULT 0,
  play_flight_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  play_slot_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_run_at DATETIME(3) NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_username (username),
  KEY ix_users_guest_seen (username, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users ADD COLUMN IF NOT EXISTS play_flight_ms BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER total_runs;
ALTER TABLE users ADD COLUMN IF NOT EXISTS play_slot_ms BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER play_flight_ms;
ALTER TABLE users DROP COLUMN IF EXISTS pity;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  refreshed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory (
  user_id INT UNSIGNED NOT NULL,
  item_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  acquired_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, item_id),
  CONSTRAINT fk_inventory_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loadout (
  user_id INT UNSIGNED NOT NULL,
  category VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  item_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (user_id, category),
  CONSTRAINT fk_loadout_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  distance INT UNSIGNED NOT NULL,
  score INT UNSIGNED NOT NULL,
  coins INT UNSIGNED NOT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  max_multiplier TINYINT UNSIGNED NOT NULL,
  tunnels SMALLINT UNSIGNED NOT NULL,
  cause VARCHAR(40) NOT NULL DEFAULT '',
  coins_by_type JSON NOT NULL,
  doubled TINYINT(1) NOT NULL DEFAULT 0,
  doubled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_runs_public (public_id),
  KEY ix_runs_user_created (user_id, created_at),
  KEY ix_runs_user_doubled (user_id, doubled_at),
  CONSTRAINT fk_runs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS spins (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  outcome VARCHAR(16) CHARACTER SET ascii NOT NULL,
  reels JSON NOT NULL,
  item_id VARCHAR(40) CHARACTER SET ascii NULL,
  duplicate TINYINT(1) NOT NULL DEFAULT 0,
  coins_delta INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_spins_user_created (user_id, created_at),
  CONSTRAINT fk_spins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(40) CHARACTER SET ascii NOT NULL,
  data JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_events_user_created (user_id, created_at),
  KEY ix_events_name_created (name, created_at),
  CONSTRAINT fk_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_at DATETIME(3) NULL AFTER last_seen_at;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_no INT UNSIGNED NOT NULL DEFAULT 1 AFTER registered_at;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER session_no;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS session_no INT UNSIGNED NOT NULL DEFAULT 1 AFTER user_id;
ALTER TABLE spins ADD COLUMN IF NOT EXISTS session_no INT UNSIGNED NOT NULL DEFAULT 1 AFTER user_id;
ALTER TABLE spins ADD COLUMN IF NOT EXISTS slot_ms INT UNSIGNED NOT NULL DEFAULT 0 AFTER coins_delta;

CREATE INDEX IF NOT EXISTS ix_users_created ON users (created_at);
CREATE INDEX IF NOT EXISTS ix_users_registered ON users (registered_at);
CREATE INDEX IF NOT EXISTS ix_runs_created ON runs (created_at);
CREATE INDEX IF NOT EXISTS ix_runs_user_session ON runs (user_id, session_no);
CREATE INDEX IF NOT EXISTS ix_spins_created ON spins (created_at);

CREATE TABLE IF NOT EXISTS player_archive (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reason VARCHAR(20) CHARACTER SET ascii NOT NULL,
  archived_on DATE NOT NULL,
  first_day DATE NOT NULL,
  last_day DATE NOT NULL,
  registered TINYINT(1) NOT NULL DEFAULT 0,
  consent_stats TINYINT(1) NOT NULL DEFAULT 0,
  sessions INT UNSIGNED NOT NULL DEFAULT 0,
  runs INT UNSIGNED NOT NULL DEFAULT 0,
  spins INT UNSIGNED NOT NULL DEFAULT 0,
  play_s INT UNSIGNED NOT NULL DEFAULT 0,
  doubled INT UNSIGNED NOT NULL DEFAULT 0,
  interstitials INT UNSIGNED NOT NULL DEFAULT 0,
  nudges JSON NULL,
  device VARCHAR(10) CHARACTER SET ascii NULL,
  os VARCHAR(20) CHARACTER SET ascii NULL,
  browser VARCHAR(20) CHARACTER SET ascii NULL,
  country CHAR(2) CHARACTER SET ascii NULL,
  region VARCHAR(3) CHARACTER SET ascii NULL,
  heat JSON NULL,
  segments JSON NULL,
  KEY ix_archive_first_day (first_day),
  KEY ix_archive_last_day (last_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_archive_days (
  archive_id INT UNSIGNED NOT NULL,
  day DATE NOT NULL,
  runs INT UNSIGNED NOT NULL DEFAULT 0,
  flight_s INT UNSIGNED NOT NULL DEFAULT 0,
  spins INT UNSIGNED NOT NULL DEFAULT 0,
  slot_s INT UNSIGNED NOT NULL DEFAULT 0,
  doubled INT UNSIGNED NOT NULL DEFAULT 0,
  interstitials INT UNSIGNED NOT NULL DEFAULT 0,
  nudges_shown INT UNSIGNED NOT NULL DEFAULT 0,
  nudges_clicked INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (archive_id, day),
  KEY ix_archive_days_day (day),
  CONSTRAINT fk_archive_days_archive FOREIGN KEY (archive_id) REFERENCES player_archive(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE users u
JOIN (SELECT user_id, MAX(created_at) AS t FROM runs WHERE created_at > NOW(3) - INTERVAL 2 DAY GROUP BY user_id) a ON a.user_id = u.id
SET u.last_seen_at = a.t
WHERE a.t > u.last_seen_at;

UPDATE users u
JOIN (SELECT user_id, MAX(created_at) AS t FROM spins WHERE created_at > NOW(3) - INTERVAL 2 DAY GROUP BY user_id) a ON a.user_id = u.id
SET u.last_seen_at = a.t
WHERE a.t > u.last_seen_at;
