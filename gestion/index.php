<?php
declare(strict_types=1);
require __DIR__ . '/config.php';
boot_session();
$hasUsers = has_users();
$user = current_user();
$csrf = csrf_token();
?>
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="theme-color" content="#0e1713">
  <title>Rituel Barber - Gestion</title>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="assets/style.css?v=1">
</head>
<body data-has-users="<?= $hasUsers ? '1' : '0' ?>" data-user-role="<?= htmlspecialchars($user['role'] ?? '', ENT_QUOTES) ?>">
  <noscript>Active JavaScript pour utiliser l'application de gestion.</noscript>
  <main id="app" class="app-shell">
    <section class="boot-card">
      <div class="brand-mark">RB</div>
      <h1>Rituel Barber</h1>
      <p>Chargement de la gestion du salon...</p>
    </section>
  </main>
  <script>
    window.RIT_DB = {
      csrf: <?= json_encode($csrf) ?>,
      hasUsers: <?= $hasUsers ? 'true' : 'false' ?>,
      user: <?= json_encode($user ?: null, JSON_UNESCAPED_UNICODE) ?>
    };
  </script>
  <script src="assets/app.js?v=1" defer></script>
</body>
</html>
