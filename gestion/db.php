<?php
/**
 * Rituel Barber — Gestion : accès base de données SQLite.
 * La base est créée automatiquement au premier lancement.
 */

date_default_timezone_set('Europe/Paris');

define('RB_DATA_DIR', __DIR__ . '/data');
define('RB_DB_PATH', RB_DATA_DIR . '/rituel.sqlite');

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    if (!is_dir(RB_DATA_DIR)) {
        mkdir(RB_DATA_DIR, 0750, true);
    }
    // Verrou d'accès web sur le dossier data (Apache/LiteSpeed).
    $ht = RB_DATA_DIR . '/.htaccess';
    if (!file_exists($ht)) {
        file_put_contents($ht, "Require all denied\nDeny from all\n");
    }

    $pdo = new PDO('sqlite:' . RB_DB_PATH, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = ON');

    $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    role        TEXT    NOT NULL CHECK (role IN ('owner','barber')),
    secret_hash TEXT    NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    price_cents INTEGER NOT NULL,
    sort        INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    service_id   INTEGER REFERENCES services(id),
    service_name TEXT    NOT NULL,
    price_cents  INTEGER NOT NULL,
    payment      TEXT    NOT NULL CHECK (payment IN ('cash','card')),
    created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
SQL);

    return $pdo;
}

function setting_get(string $key, ?string $default = null): ?string
{
    $st = db()->prepare('SELECT value FROM settings WHERE key = ?');
    $st->execute([$key]);
    $v = $st->fetchColumn();
    return $v === false ? $default : $v;
}

function setting_set(string $key, string $value): void
{
    db()->prepare('INSERT INTO settings(key, value) VALUES(?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        ->execute([$key, $value]);
}

/** Prestations par défaut, reprises des tarifs du salon. */
function seed_services(): void
{
    $defaults = [
        ['Coupe Classique',   2500],
        ['Coupe & Barbe',     4000],
        ['Taille de Barbe',   2000],
        ['Dégradé Américain', 3000],
        ['Coupe Enfant',      1500],
        ['Soin Visage',       3000],
    ];
    $st = db()->prepare('INSERT INTO services(name, price_cents, sort) VALUES(?, ?, ?)');
    foreach ($defaults as $i => [$name, $price]) {
        $st->execute([$name, $price, $i]);
    }
}
