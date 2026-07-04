<?php
/**
 * Rituel Barber — Gestion : API JSON.
 *
 * Règle d'or : aucun montant ni total ne sort de cette API vers un compte
 * "barber". Les prix ne circulent côté barbier qu'au moment de la saisie
 * (grille des prestations), jamais en relecture ni en cumul.
 */

require __DIR__ . '/db.php';

const UNDO_WINDOW_SECONDS = 300;   // le barbier peut annuler sa saisie pendant 5 min
const LOGIN_MAX_FAILS     = 5;
const LOGIN_LOCK_SECONDS  = 60;

session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
    'secure'   => !empty($_SERVER['HTTPS']),
    'path'     => '/',
]);
session_name('RBGESTION');
session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Cache-Control: no-store');

$action = $_GET['action'] ?? '';
$input  = [];
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PATCH', 'DELETE'], true)) {
    $raw = file_get_contents('php://input');
    $input = $raw ? (json_decode($raw, true) ?: []) : [];
}

try {
    route($action, $input);
} catch (Throwable $e) {
    fail(500, 'Erreur interne. Réessaie, et préviens le gérant si ça continue.');
}

/* ---------------------------------------------------------------- helpers */

function ok(array $data = []): never
{
    echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $code, string $message): never
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function current_user(): ?array
{
    if (empty($_SESSION['uid'])) {
        return null;
    }
    $st = db()->prepare('SELECT id, name, role FROM users WHERE id = ? AND active = 1');
    $st->execute([$_SESSION['uid']]);
    return $st->fetch() ?: null;
}

function require_auth(): array
{
    $u = current_user();
    if (!$u) {
        fail(401, 'Session expirée, reconnecte-toi.');
    }
    return $u;
}

function require_owner(): array
{
    $u = require_auth();
    if ($u['role'] !== 'owner') {
        fail(403, 'Réservé au gérant.');
    }
    return $u;
}

function services_list(): array
{
    return db()->query(
        'SELECT id, name, price_cents FROM services WHERE active = 1 ORDER BY sort, id'
    )->fetchAll();
}

function euros(int $cents): float
{
    return round($cents / 100, 2);
}

/* ----------------------------------------------------------------- router */

function route(string $action, array $in): void
{
    switch ($action) {
        /* ------------------------------------------------ session & accès */
        case 'bootstrap':
            $count = (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
            $u = current_user();
            ok([
                'setup_required' => $count === 0,
                'user' => $u ? ['name' => $u['name'], 'role' => $u['role']] : null,
                'theme' => setting_get('theme', 'vert'),
            ]);

        case 'theme_set':
            require_owner();
            $theme = $in['theme'] ?? '';
            if (!in_array($theme, ['vert', 'turquoise', 'clair'], true)) {
                fail(422, 'Thème inconnu.');
            }
            setting_set('theme', $theme);
            ok(['theme' => $theme]);

        case 'setup':
            if ((int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
                fail(403, 'L\'application est déjà configurée.');
            }
            $password = trim($in['owner_password'] ?? '');
            $barber   = trim($in['barber_name'] ?? '');
            $pin      = trim($in['barber_pin'] ?? '');
            if (strlen($password) < 8) {
                fail(422, 'Le mot de passe gérant doit faire au moins 8 caractères.');
            }
            if (!preg_match('/^\d{4,6}$/', $pin)) {
                fail(422, 'Le PIN barbier doit faire 4 à 6 chiffres.');
            }
            if ($barber === '') {
                $barber = 'Barbier';
            }
            $now = date('Y-m-d H:i:s');
            $st = db()->prepare('INSERT INTO users(name, role, secret_hash, created_at) VALUES(?,?,?,?)');
            $st->execute(['Gérant', 'owner', password_hash($password, PASSWORD_DEFAULT), $now]);
            $ownerId = (int) db()->lastInsertId();
            $st->execute([$barber, 'barber', password_hash($pin, PASSWORD_DEFAULT), $now]);
            seed_services();
            $_SESSION['uid'] = $ownerId;
            ok(['user' => ['name' => 'Gérant', 'role' => 'owner']]);

        case 'login':
            login_rate_limit();
            $u = null;
            if (($in['mode'] ?? '') === 'password') {
                $st = db()->prepare("SELECT * FROM users WHERE role = 'owner' AND active = 1");
                $st->execute();
                foreach ($st->fetchAll() as $row) {
                    if (password_verify((string) ($in['password'] ?? ''), $row['secret_hash'])) {
                        $u = $row;
                        break;
                    }
                }
            } else {
                $pin = (string) ($in['pin'] ?? '');
                $st = db()->prepare("SELECT * FROM users WHERE role = 'barber' AND active = 1");
                $st->execute();
                foreach ($st->fetchAll() as $row) {
                    if (password_verify($pin, $row['secret_hash'])) {
                        $u = $row;
                        break;
                    }
                }
            }
            if (!$u) {
                login_record_fail();
                fail(401, 'Identifiants incorrects.');
            }
            login_clear_fails();
            session_regenerate_id(true);
            $_SESSION['uid'] = (int) $u['id'];
            ok(['user' => ['name' => $u['name'], 'role' => $u['role']]]);

        case 'logout':
            $_SESSION = [];
            session_destroy();
            ok();

        /* -------------------------------------------------- côté barbier */
        case 'state':
            $u = require_auth();
            $today = date('Y-m-d');
            $st = db()->prepare(
                "SELECT id, service_name, strftime('%H:%M', created_at) AS time, created_at
                 FROM entries WHERE user_id = ? AND date(created_at) = ?
                 ORDER BY created_at DESC"
            );
            $st->execute([$u['id'], $today]);
            $mine = [];
            foreach ($st->fetchAll() as $row) {
                // Volontairement SANS prix : le barbier ne relit jamais les montants.
                $mine[] = [
                    'id'       => (int) $row['id'],
                    'service'  => $row['service_name'],
                    'time'     => $row['time'],
                    'can_undo' => (time() - strtotime($row['created_at'])) <= UNDO_WINDOW_SECONDS,
                ];
            }
            ok([
                'user'     => ['name' => $u['name'], 'role' => $u['role']],
                'services' => services_list(),
                'today'    => ['count' => count($mine), 'entries' => $mine],
            ]);

        case 'add_entry':
            $u = require_auth();
            $serviceId = (int) ($in['service_id'] ?? 0);
            $price     = (int) ($in['price_cents'] ?? 0);
            $payment   = $in['payment'] ?? '';
            if (!in_array($payment, ['cash', 'card'], true)) {
                fail(422, 'Choisis Espèces ou Carte.');
            }
            if ($price < 0 || $price > 50000) {
                fail(422, 'Prix invalide.');
            }
            $serviceName = trim((string) ($in['service_name'] ?? ''));
            if ($serviceId > 0) {
                $st = db()->prepare('SELECT name FROM services WHERE id = ? AND active = 1');
                $st->execute([$serviceId]);
                $name = $st->fetchColumn();
                if ($name === false) {
                    fail(422, 'Prestation inconnue.');
                }
                $serviceName = $name;
            } elseif ($serviceName === '') {
                $serviceName = 'Autre';
            }
            // Saisie mise en attente hors-ligne : on accepte l'heure du client
            // si elle est plausible (dans les dernières 24 h).
            $createdAt = date('Y-m-d H:i:s');
            if (!empty($in['client_time'])) {
                $t = strtotime((string) $in['client_time']);
                if ($t !== false && $t <= time() + 120 && $t >= time() - 86400) {
                    $createdAt = date('Y-m-d H:i:s', $t);
                }
            }
            $st = db()->prepare(
                'INSERT INTO entries(user_id, service_id, service_name, price_cents, payment, created_at)
                 VALUES(?,?,?,?,?,?)'
            );
            $st->execute([$u['id'], $serviceId ?: null, $serviceName, $price, $payment, $createdAt]);
            ok([
                'entry' => [
                    'id'      => (int) db()->lastInsertId(),
                    'service' => $serviceName,
                    'time'    => date('H:i', strtotime($createdAt)),
                ],
            ]);

        case 'undo_entry':
            $u = require_auth();
            $id = (int) ($in['id'] ?? 0);
            $st = db()->prepare('SELECT user_id, created_at FROM entries WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                fail(404, 'Saisie introuvable.');
            }
            if ($u['role'] !== 'owner') {
                if ((int) $row['user_id'] !== (int) $u['id']) {
                    fail(403, 'Cette saisie n\'est pas la tienne.');
                }
                if (time() - strtotime($row['created_at']) > UNDO_WINDOW_SECONDS) {
                    fail(403, 'Trop tard pour annuler — demande au gérant.');
                }
            }
            db()->prepare('DELETE FROM entries WHERE id = ?')->execute([$id]);
            ok();

        /* --------------------------------------------------- côté gérant */
        case 'stats':
            require_owner();
            $period = $in['period'] ?? ($_GET['period'] ?? 'day');
            $ref    = $in['date'] ?? ($_GET['date'] ?? date('Y-m-d'));
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $ref)) {
                $ref = date('Y-m-d');
            }
            ok(stats_for($period, $ref));

        case 'entry_update':
            require_owner();
            $id = (int) ($in['id'] ?? 0);
            $price = (int) ($in['price_cents'] ?? -1);
            $payment = $in['payment'] ?? '';
            if ($price < 0 || $price > 50000 || !in_array($payment, ['cash', 'card'], true)) {
                fail(422, 'Valeurs invalides.');
            }
            $st = db()->prepare('UPDATE entries SET price_cents = ?, payment = ? WHERE id = ?');
            $st->execute([$price, $payment, $id]);
            ok();

        /* ------------------------------------------------------- réglages */
        case 'service_save':
            require_owner();
            $id    = (int) ($in['id'] ?? 0);
            $name  = trim((string) ($in['name'] ?? ''));
            $price = (int) ($in['price_cents'] ?? -1);
            if ($name === '' || mb_strlen($name) > 60 || $price < 0 || $price > 50000) {
                fail(422, 'Nom ou prix invalide.');
            }
            if ($id > 0) {
                db()->prepare('UPDATE services SET name = ?, price_cents = ? WHERE id = ?')
                    ->execute([$name, $price, $id]);
            } else {
                $max = (int) db()->query('SELECT COALESCE(MAX(sort),0) FROM services')->fetchColumn();
                db()->prepare('INSERT INTO services(name, price_cents, sort) VALUES(?,?,?)')
                    ->execute([$name, $price, $max + 1]);
                $id = (int) db()->lastInsertId();
            }
            ok(['services' => services_list()]);

        case 'service_delete':
            require_owner();
            // Désactivation, pas suppression : l'historique garde ses libellés.
            db()->prepare('UPDATE services SET active = 0 WHERE id = ?')
                ->execute([(int) ($in['id'] ?? 0)]);
            ok(['services' => services_list()]);

        case 'barber_save':
            require_owner();
            $id   = (int) ($in['id'] ?? 0);
            $name = trim((string) ($in['name'] ?? ''));
            $pin  = trim((string) ($in['pin'] ?? ''));
            if ($pin !== '' && !preg_match('/^\d{4,6}$/', $pin)) {
                fail(422, 'Le PIN doit faire 4 à 6 chiffres.');
            }
            if ($id > 0) {
                if ($name !== '') {
                    db()->prepare("UPDATE users SET name = ? WHERE id = ? AND role = 'barber'")
                        ->execute([$name, $id]);
                }
                if ($pin !== '') {
                    db()->prepare("UPDATE users SET secret_hash = ? WHERE id = ? AND role = 'barber'")
                        ->execute([password_hash($pin, PASSWORD_DEFAULT), $id]);
                }
            } else {
                if ($name === '' || $pin === '') {
                    fail(422, 'Nom et PIN obligatoires pour un nouveau barbier.');
                }
                db()->prepare("INSERT INTO users(name, role, secret_hash, created_at) VALUES(?, 'barber', ?, ?)")
                    ->execute([$name, password_hash($pin, PASSWORD_DEFAULT), date('Y-m-d H:i:s')]);
            }
            ok(['barbers' => barbers_list()]);

        case 'barber_toggle':
            require_owner();
            db()->prepare("UPDATE users SET active = 1 - active WHERE id = ? AND role = 'barber'")
                ->execute([(int) ($in['id'] ?? 0)]);
            ok(['barbers' => barbers_list()]);

        case 'barbers':
            require_owner();
            ok(['barbers' => barbers_list()]);

        case 'owner_password':
            $u = require_owner();
            $st = db()->prepare('SELECT secret_hash FROM users WHERE id = ?');
            $st->execute([$u['id']]);
            if (!password_verify((string) ($in['current'] ?? ''), $st->fetchColumn())) {
                fail(403, 'Mot de passe actuel incorrect.');
            }
            $new = (string) ($in['new'] ?? '');
            if (strlen($new) < 8) {
                fail(422, 'Le nouveau mot de passe doit faire au moins 8 caractères.');
            }
            db()->prepare('UPDATE users SET secret_hash = ? WHERE id = ?')
                ->execute([password_hash($new, PASSWORD_DEFAULT), $u['id']]);
            ok();

        case 'export':
            require_owner();
            $from = $_GET['from'] ?? date('Y-m-01');
            $to   = $_GET['to'] ?? date('Y-m-d');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
                fail(422, 'Dates invalides.');
            }
            header('Content-Type: text/csv; charset=utf-8');
            header("Content-Disposition: attachment; filename=rituel-barber_{$from}_{$to}.csv");
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF"); // BOM pour Excel
            fputcsv($out, ['Date', 'Heure', 'Barbier', 'Prestation', 'Prix (€)', 'Paiement'], ';');
            $st = db()->prepare(
                "SELECT e.created_at, u.name AS barber, e.service_name, e.price_cents, e.payment
                 FROM entries e JOIN users u ON u.id = e.user_id
                 WHERE date(e.created_at) BETWEEN ? AND ?
                 ORDER BY e.created_at"
            );
            $st->execute([$from, $to]);
            foreach ($st->fetchAll() as $r) {
                fputcsv($out, [
                    date('d/m/Y', strtotime($r['created_at'])),
                    date('H:i', strtotime($r['created_at'])),
                    $r['barber'],
                    $r['service_name'],
                    number_format(euros((int) $r['price_cents']), 2, ',', ''),
                    $r['payment'] === 'card' ? 'Carte' : 'Espèces',
                ], ';');
            }
            fclose($out);
            exit;

        default:
            fail(404, 'Action inconnue.');
    }
}

/* ------------------------------------------------------------ rate limit */

function login_rate_limit(): void
{
    $fails = (int) setting_get('login_fails', '0');
    $last  = (int) setting_get('login_last_fail', '0');
    if ($fails >= LOGIN_MAX_FAILS && (time() - $last) < LOGIN_LOCK_SECONDS) {
        fail(429, 'Trop de tentatives. Attends une minute et réessaie.');
    }
    if ((time() - $last) >= LOGIN_LOCK_SECONDS) {
        login_clear_fails();
    }
}

function login_record_fail(): void
{
    setting_set('login_fails', (string) ((int) setting_get('login_fails', '0') + 1));
    setting_set('login_last_fail', (string) time());
}

function login_clear_fails(): void
{
    setting_set('login_fails', '0');
}

/* ------------------------------------------------------------------ stats */

function barbers_list(): array
{
    return db()->query(
        "SELECT id, name, active FROM users WHERE role = 'barber' ORDER BY id"
    )->fetchAll();
}

/** Total et compteurs sur une plage de dates incluses. */
function range_summary(string $from, string $to): array
{
    $st = db()->prepare(
        "SELECT COUNT(*) AS n,
                COALESCE(SUM(price_cents), 0) AS total,
                COALESCE(SUM(CASE WHEN payment = 'card' THEN price_cents ELSE 0 END), 0) AS card
         FROM entries WHERE date(created_at) BETWEEN ? AND ?"
    );
    $st->execute([$from, $to]);
    return $st->fetch();
}

function service_split(string $from, string $to): array
{
    $st = db()->prepare(
        "SELECT service_name, SUM(price_cents) AS total, COUNT(*) AS n
         FROM entries WHERE date(created_at) BETWEEN ? AND ?
         GROUP BY service_name ORDER BY total DESC"
    );
    $st->execute([$from, $to]);
    $rows = $st->fetchAll();
    $grand = array_sum(array_column($rows, 'total'));
    return array_map(fn($r) => [
        'name'  => $r['service_name'],
        'total' => euros((int) $r['total']),
        'count' => (int) $r['n'],
        'share' => $grand > 0 ? round($r['total'] * 100 / $grand) : 0,
    ], $rows);
}

function daily_series(string $from, string $to): array
{
    $st = db()->prepare(
        "SELECT date(created_at) AS d, SUM(price_cents) AS total, COUNT(*) AS n
         FROM entries WHERE date(created_at) BETWEEN ? AND ?
         GROUP BY d"
    );
    $st->execute([$from, $to]);
    $by = [];
    foreach ($st->fetchAll() as $r) {
        $by[$r['d']] = ['total' => euros((int) $r['total']), 'count' => (int) $r['n']];
    }
    $out = [];
    for ($t = strtotime($from); $t <= strtotime($to); $t += 86400) {
        $d = date('Y-m-d', $t);
        $out[] = ['date' => $d] + ($by[$d] ?? ['total' => 0, 'count' => 0]);
    }
    return $out;
}

function stats_for(string $period, string $ref): array
{
    switch ($period) {
        case 'week':
            $monday = date('Y-m-d', strtotime('monday this week', strtotime($ref)));
            $sunday = date('Y-m-d', strtotime($monday . ' +6 days'));
            $prevFrom = date('Y-m-d', strtotime($monday . ' -7 days'));
            $prevTo   = date('Y-m-d', strtotime($monday . ' -1 day'));
            $from = $monday; $to = $sunday;
            break;
        case 'month':
            $from = date('Y-m-01', strtotime($ref));
            $to   = date('Y-m-t', strtotime($ref));
            $prevFrom = date('Y-m-01', strtotime($from . ' -1 month'));
            $prevTo   = date('Y-m-t', strtotime($from . ' -1 month'));
            break;
        default: // day
            $period = 'day';
            $from = $to = $ref;
            $prevFrom = $prevTo = date('Y-m-d', strtotime($ref . ' -7 days')); // même jour sem. passée
    }

    $cur  = range_summary($from, $to);
    $prev = range_summary($prevFrom, $prevTo);

    $total = euros((int) $cur['total']);
    $prevTotal = euros((int) $prev['total']);
    $delta = null;
    if ($prevTotal > 0) {
        $delta = round(($total - $prevTotal) * 100 / $prevTotal);
    }

    $result = [
        'period'    => $period,
        'from'      => $from,
        'to'        => $to,
        'total'     => $total,
        'count'     => (int) $cur['n'],
        'avg'       => $cur['n'] > 0 ? round($total / $cur['n'], 2) : 0,
        'card_pct'  => (int) $cur['total'] > 0 ? round($cur['card'] * 100 / $cur['total']) : null,
        'delta_pct' => $delta,
        'split'     => service_split($from, $to),
    ];

    if ($period === 'day') {
        $st = db()->prepare(
            "SELECT e.id, strftime('%H:%M', e.created_at) AS time, e.service_name,
                    e.price_cents, e.payment, u.name AS barber
             FROM entries e JOIN users u ON u.id = e.user_id
             WHERE date(e.created_at) = ? ORDER BY e.created_at DESC"
        );
        $st->execute([$from]);
        $result['entries'] = array_map(fn($r) => [
            'id'      => (int) $r['id'],
            'time'    => $r['time'],
            'service' => $r['service_name'],
            'price'   => euros((int) $r['price_cents']),
            'payment' => $r['payment'],
            'barber'  => $r['barber'],
        ], $st->fetchAll());
    } else {
        $result['series'] = daily_series($from, $to);
    }

    return $result;
}
