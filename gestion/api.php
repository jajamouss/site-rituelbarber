<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

boot_session();
$action = $_GET['action'] ?? '';
verify_csrf();

try {
    match ($action) {
        'setup' => setup(),
        'login' => login(),
        'logout' => logout(),
        'session' => session_info(),
        'services' => services(),
        'entry_create' => entry_create(),
        'entry_undo' => entry_undo(),
        'entry_void' => entry_void(),
        'dashboard' => dashboard(),
        'service_save' => service_save(),
        'user_save' => user_save(),
        'export_csv' => export_csv(),
        default => json_response(['ok' => false, 'error' => 'Action inconnue.'], 404),
    };
} catch (Throwable $e) {
    json_response(['ok' => false, 'error' => 'Erreur serveur.', 'detail' => $e->getMessage()], 500);
}

function public_user(array $u): array
{
    return ['id' => (int)$u['id'], 'name' => $u['name'], 'role' => $u['role'], 'active' => (int)($u['active'] ?? 1)];
}

function setup(): never
{
    if (has_users()) {
        json_response(['ok' => false, 'error' => 'Installation deja effectuee.'], 409);
    }
    $in = json_input();
    $password = (string)($in['password'] ?? '');
    $pin = preg_replace('/\D+/', '', (string)($in['pin'] ?? ''));
    if (strlen($password) < 8) json_response(['ok' => false, 'error' => 'Mot de passe gerant : 8 caracteres minimum.'], 422);
    if (strlen($pin) !== 4) json_response(['ok' => false, 'error' => 'PIN barbier : 4 chiffres.'], 422);

    $admin = mutate_store(function (&$store) use ($in, $password, $pin) {
        if (count($store['users']) > 0) return null;
        $admin = [
            'id' => $store['next']['users']++,
            'name' => trim((string)($in['admin_name'] ?? 'Gerant')) ?: 'Gerant',
            'role' => 'admin',
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'pin_hash' => null,
            'active' => 1,
            'created_at' => paris_now(),
        ];
        $barber = [
            'id' => $store['next']['users']++,
            'name' => trim((string)($in['barber_name'] ?? 'Barbier')) ?: 'Barbier',
            'role' => 'barber',
            'password_hash' => null,
            'pin_hash' => password_hash($pin, PASSWORD_DEFAULT),
            'active' => 1,
            'created_at' => paris_now(),
        ];
        $store['users'][] = $admin;
        $store['users'][] = $barber;
        return $admin;
    });
    if (!$admin) json_response(['ok' => false, 'error' => 'Installation deja effectuee.'], 409);
    $_SESSION['user_id'] = (int)$admin['id'];
    json_response(['ok' => true, 'user' => public_user($admin), 'csrf' => csrf_token()]);
}

function login(): never
{
    $in = json_input();
    $mode = (string)($in['mode'] ?? 'pin');
    $store = load_store();
    $found = null;
    foreach ($store['users'] as $user) {
        if ((int)($user['active'] ?? 1) !== 1) continue;
        if ($mode === 'admin' && $user['role'] === 'admin' && password_verify((string)($in['password'] ?? ''), (string)($user['password_hash'] ?? ''))) {
            $found = $user; break;
        }
        if ($mode !== 'admin' && $user['role'] === 'barber' && password_verify(preg_replace('/\D+/', '', (string)($in['pin'] ?? '')), (string)($user['pin_hash'] ?? ''))) {
            $found = $user; break;
        }
    }
    if (!$found) json_response(['ok' => false, 'error' => $mode === 'admin' ? 'Mot de passe incorrect.' : 'PIN incorrect.'], 401);
    $_SESSION['user_id'] = (int)$found['id'];
    json_response(['ok' => true, 'user' => public_user($found), 'csrf' => csrf_token()]);
}

function logout(): never
{
    $_SESSION = [];
    session_destroy();
    json_response(['ok' => true]);
}

function session_info(): never
{
    json_response(['ok' => true, 'installed' => has_users(), 'user' => current_user(), 'csrf' => csrf_token()]);
}

function services(): never
{
    require_user();
    $services = load_store()['services'];
    usort($services, fn($a, $b) => [-(int)$a['active'], (int)$a['position'], (int)$a['id']] <=> [-(int)$b['active'], (int)$b['position'], (int)$b['id']]);
    json_response(['ok' => true, 'services' => $services]);
}

function entry_create(): never
{
    $user = require_user();
    $in = json_input();
    $payment = (string)($in['payment'] ?? 'card');
    if (!in_array($payment, ['card', 'cash'], true)) json_response(['ok' => false, 'error' => 'Paiement invalide.'], 422);
    $serviceId = (int)($in['service_id'] ?? 0);
    $price = (int)($in['price'] ?? 0);
    $created = mutate_store(function (&$store) use ($serviceId, $price, $payment, $user) {
        $service = null;
        foreach ($store['services'] as $s) {
            if ((int)$s['id'] === $serviceId && (int)$s['active'] === 1) { $service = $s; break; }
        }
        if (!$service) return null;
        $row = [
            'id' => $store['next']['entries']++,
            'service_id' => $serviceId,
            'service_name' => $service['name'],
            'price' => $price > 0 ? $price : (int)$service['price'],
            'payment' => $payment,
            'user_id' => (int)$user['id'],
            'created_at' => paris_now(),
            'voided' => 0,
            'voided_at' => null,
            'void_reason' => null,
        ];
        $store['entries'][] = $row;
        return $row;
    });
    if (!$created) json_response(['ok' => false, 'error' => 'Prestation introuvable.'], 404);
    json_response(['ok' => true, 'entry_id' => (int)$created['id']]);
}

function entry_undo(): never
{
    $user = require_user();
    $ok = mutate_store(function (&$store) use ($user) {
        $latestKey = null; $latestTime = '';
        foreach ($store['entries'] as $k => $e) {
            if ((int)$e['user_id'] !== (int)$user['id'] || (int)$e['voided'] === 1) continue;
            if ($e['created_at'] > $latestTime) { $latestTime = $e['created_at']; $latestKey = $k; }
        }
        if ($latestKey === null) return 'none';
        $created = new DateTimeImmutable((string)$store['entries'][$latestKey]['created_at'], new DateTimeZone('Europe/Paris'));
        if ($created->getTimestamp() < time() - 300 && $user['role'] !== 'admin') return 'late';
        $store['entries'][$latestKey]['voided'] = 1;
        $store['entries'][$latestKey]['voided_at'] = paris_now();
        $store['entries'][$latestKey]['void_reason'] = 'Annulation rapide';
        return 'ok';
    });
    if ($ok === 'none') json_response(['ok' => false, 'error' => 'Aucune saisie a annuler.'], 404);
    if ($ok === 'late') json_response(['ok' => false, 'error' => 'Delai de 5 minutes depasse. Demande au gerant.'], 403);
    json_response(['ok' => true]);
}

function entry_void(): never
{
    require_admin();
    $id = (int)(json_input()['id'] ?? 0);
    mutate_store(function (&$store) use ($id) {
        foreach ($store['entries'] as &$e) {
            if ((int)$e['id'] === $id) {
                $e['voided'] = 1; $e['voided_at'] = paris_now(); $e['void_reason'] = 'Correction gerant';
            }
        }
    });
    json_response(['ok' => true]);
}

function dashboard(): never
{
    $user = require_user();
    $date = preg_replace('/[^0-9-]/', '', (string)($_GET['date'] ?? date('Y-m-d')));
    [$start, $end] = day_bounds($date);
    $store = load_store();
    $users = [];
    foreach ($store['users'] as $u) $users[(int)$u['id']] = $u['name'];
    $entries = array_values(array_filter($store['entries'], fn($e) => $e['created_at'] >= $start && $e['created_at'] <= $end));
    usort($entries, fn($a, $b) => strcmp($b['created_at'], $a['created_at']));
    foreach ($entries as &$e) $e['user_name'] = $users[(int)$e['user_id']] ?? 'Barbier';
    $valid = array_values(array_filter($entries, fn($e) => (int)$e['voided'] === 0));
    $total = array_sum(array_map(fn($e) => (int)$e['price'], $valid));
    $cash = array_sum(array_map(fn($e) => $e['payment'] === 'cash' ? (int)$e['price'] : 0, $valid));
    $count = count($valid);
    $summary = ['date'=>$date,'total'=>$total,'total_label'=>euros($total),'clients'=>$count,'avg'=>$count?(int)round($total/$count):0,'avg_label'=>$count?euros((int)round($total/$count)):'0 €','cash'=>$cash,'card'=>$total-$cash];
    if ($user['role'] === 'barber') {
        foreach ($entries as &$e) { unset($e['price'], $e['payment']); }
        $summary = ['date'=>$date,'clients'=>$count];
    } else {
        $summary['week'] = period_total('week', $store['entries']);
        $summary['month'] = period_total('month', $store['entries']);
        $summary['by_service'] = by_service($valid);
    }
    json_response(['ok' => true, 'role' => $user['role'], 'summary' => $summary, 'entries' => $entries]);
}

function period_total(string $period, array $entries): array
{
    $tz = new DateTimeZone('Europe/Paris');
    $now = new DateTimeImmutable('now', $tz);
    $start = $period === 'week' ? $now->modify('monday this week')->format('Y-m-d 00:00:00') : $now->modify('first day of this month')->format('Y-m-d 00:00:00');
    $end = $period === 'week' ? $now->modify('sunday this week')->format('Y-m-d 23:59:59') : $now->modify('last day of this month')->format('Y-m-d 23:59:59');
    $valid = array_filter($entries, fn($e) => (int)$e['voided'] === 0 && $e['created_at'] >= $start && $e['created_at'] <= $end);
    $total = array_sum(array_map(fn($e) => (int)$e['price'], $valid));
    return ['total'=>$total,'total_label'=>euros($total),'clients'=>count($valid)];
}

function by_service(array $entries): array
{
    $rows = [];
    foreach ($entries as $e) {
        $name = $e['service_name'];
        $rows[$name] ??= ['service_name'=>$name,'qty'=>0,'total'=>0];
        $rows[$name]['qty']++;
        $rows[$name]['total'] += (int)$e['price'];
    }
    usort($rows, fn($a,$b)=>$b['total']<=>$a['total']);
    return array_values($rows);
}

function service_save(): never
{
    require_admin();
    $in = json_input();
    $id = (int)($in['id'] ?? 0);
    $name = trim((string)($in['name'] ?? ''));
    $price = (int)($in['price'] ?? 0);
    $active = !empty($in['active']) ? 1 : 0;
    if ($name === '' || $price <= 0) json_response(['ok' => false, 'error' => 'Nom et prix obligatoires.'], 422);
    mutate_store(function (&$store) use ($id, $name, $price, $active) {
        if ($id > 0) {
            foreach ($store['services'] as &$s) if ((int)$s['id'] === $id) { $s['name']=$name; $s['price']=$price; $s['active']=$active; return; }
        }
        $store['services'][] = ['id'=>$store['next']['services']++,'name'=>$name,'price'=>$price,'active'=>$active,'position'=>count($store['services'])+1];
    });
    json_response(['ok' => true]);
}

function user_save(): never
{
    require_admin();
    $in = json_input();
    $name = trim((string)($in['name'] ?? ''));
    $pin = preg_replace('/\D+/', '', (string)($in['pin'] ?? ''));
    if ($name === '' || strlen($pin) !== 4) json_response(['ok' => false, 'error' => 'Nom et PIN 4 chiffres obligatoires.'], 422);
    mutate_store(function (&$store) use ($name, $pin) {
        $store['users'][] = ['id'=>$store['next']['users']++,'name'=>$name,'role'=>'barber','pin_hash'=>password_hash($pin, PASSWORD_DEFAULT),'password_hash'=>null,'active'=>1,'created_at'=>paris_now()];
    });
    json_response(['ok' => true]);
}

function export_csv(): never
{
    require_admin();
    $from = preg_replace('/[^0-9-]/', '', (string)($_GET['from'] ?? date('Y-m-01')));
    $to = preg_replace('/[^0-9-]/', '', (string)($_GET['to'] ?? date('Y-m-d')));
    [$start] = day_bounds($from); [, $end] = day_bounds($to);
    $store = load_store();
    $users = []; foreach ($store['users'] as $u) $users[(int)$u['id']] = $u['name'];
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="rituel-barber-export.csv"');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['date','prestation','prix','paiement','barbier','annule','motif'], ';');
    foreach ($store['entries'] as $e) {
        if ($e['created_at'] < $start || $e['created_at'] > $end) continue;
        fputcsv($out, [$e['created_at'],$e['service_name'],$e['price'],$e['payment'],$users[(int)$e['user_id']] ?? '',$e['voided'],$e['void_reason']], ';');
    }
    exit;
}
