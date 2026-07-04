<?php
declare(strict_types=1);

date_default_timezone_set('Europe/Paris');

const APP_NAME = 'Rituel Barber Gestion';
const DB_DIR = __DIR__ . '/data';
const STORE_PATH = DB_DIR . '/store.json';
const SESSION_NAME = 'rituel_barber_gestion';

function boot_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_name(SESSION_NAME);
        session_set_cookie_params([
            'lifetime' => 60 * 60 * 24 * 30,
            'path' => '/gestion',
            'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
    }
}

function default_store(): array
{
    return [
        'next' => ['users' => 1, 'services' => 1, 'entries' => 1],
        'users' => [],
        'services' => [
            ['id' => 1, 'name' => 'Coupe Classique', 'price' => 25, 'active' => 1, 'position' => 1],
            ['id' => 2, 'name' => 'Coupe & Barbe', 'price' => 40, 'active' => 1, 'position' => 2],
            ['id' => 3, 'name' => 'Taille de Barbe', 'price' => 20, 'active' => 1, 'position' => 3],
            ['id' => 4, 'name' => 'Degrade Americain', 'price' => 30, 'active' => 1, 'position' => 4],
            ['id' => 5, 'name' => 'Coupe Enfant', 'price' => 15, 'active' => 1, 'position' => 5],
            ['id' => 6, 'name' => 'Soin Visage', 'price' => 30, 'active' => 1, 'position' => 6],
        ],
        'entries' => [],
    ];
}

function load_store(): array
{
    if (!is_dir(DB_DIR)) {
        mkdir(DB_DIR, 0750, true);
    }
    if (!is_file(STORE_PATH)) {
        $store = default_store();
        $store['next']['services'] = 7;
        save_store($store);
        return $store;
    }
    $raw = file_get_contents(STORE_PATH);
    $store = json_decode($raw ?: '', true);
    if (!is_array($store)) {
        $store = default_store();
    }
    $store += default_store();
    return $store;
}

function save_store(array $store): void
{
    if (!is_dir(DB_DIR)) {
        mkdir(DB_DIR, 0750, true);
    }
    $tmp = STORE_PATH . '.tmp';
    file_put_contents($tmp, json_encode($store, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    rename($tmp, STORE_PATH);
}

function mutate_store(callable $fn): mixed
{
    if (!is_dir(DB_DIR)) {
        mkdir(DB_DIR, 0750, true);
    }
    $lockPath = DB_DIR . '/store.lock';
    $lock = fopen($lockPath, 'c');
    if (!$lock) {
        throw new RuntimeException('Verrou impossible.');
    }
    flock($lock, LOCK_EX);
    $store = load_store();
    $result = $fn($store);
    save_store($store);
    flock($lock, LOCK_UN);
    fclose($lock);
    return $result;
}

function has_users(): bool
{
    return count(load_store()['users']) > 0;
}

function current_user(): ?array
{
    boot_session();
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    foreach (load_store()['users'] as $user) {
        if ((int)$user['id'] === (int)$_SESSION['user_id'] && (int)($user['active'] ?? 1) === 1) {
            return ['id' => (int)$user['id'], 'name' => $user['name'], 'role' => $user['role'], 'active' => 1];
        }
    }
    return null;
}

function require_user(): array
{
    $user = current_user();
    if (!$user) {
        json_response(['ok' => false, 'error' => 'Session expiree.'], 401);
    }
    return $user;
}

function require_admin(): array
{
    $user = require_user();
    if ($user['role'] !== 'admin') {
        json_response(['ok' => false, 'error' => 'Acces gerant requis.'], 403);
    }
    return $user;
}

function csrf_token(): string
{
    boot_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(24));
    }
    return $_SESSION['csrf'];
}

function verify_csrf(): void
{
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        return;
    }
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!$token || !hash_equals(csrf_token(), $token)) {
        json_response(['ok' => false, 'error' => 'Jeton de securite invalide.'], 419);
    }
}

function json_input(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = $raw === '' ? [] : json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function euros(int $amount): string
{
    return number_format($amount, 0, ',', ' ') . ' €';
}

function paris_now(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Paris')))->format('Y-m-d H:i:s');
}

function day_bounds(?string $date = null): array
{
    $tz = new DateTimeZone('Europe/Paris');
    $d = $date ? new DateTimeImmutable($date, $tz) : new DateTimeImmutable('today', $tz);
    return [$d->format('Y-m-d 00:00:00'), $d->format('Y-m-d 23:59:59')];
}
