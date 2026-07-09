<?php
/**
 * Contact-form handler — Fair Finance Pakistan.
 *
 * Receives POSTs from the website contact forms, stores them safely, and
 * emails them (To: fairfinancepakistan@gmail.com, Cc: huma.iqbal@…) from the
 * FFP Gmail account over authenticated SMTP.
 *
 * Returns JSON: { ok: bool, emailed: bool, stored: bool, message: string }
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception as MailException;

function respond(bool $ok, array $extra = [], int $status = 200): void
{
    http_response_code($status);
    echo json_encode(array_merge(['ok' => $ok], $extra), JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    respond(false, ['message' => 'Method not allowed.'], 405);
}

$config = require __DIR__ . '/contact_config.php';

/* ---- Honeypot: silently accept bots without doing anything ---- */
if (!empty($_POST['_gotcha'])) {
    respond(true, ['emailed' => false, 'stored' => false, 'message' => 'Thank you.']);
}

/* ---- Identify the form ---- */
$source = preg_replace('/[^a-z0-9\-]/', '', strtolower((string)($_POST['form_source'] ?? 'general-contact')));
$formDef = $config['forms'][$source] ?? null;
$title   = $formDef['title'] ?? 'New Website Submission';

/* ---- Collect submitted fields (skip internal ones) ---- */
$skip = ['_gotcha', 'form_source', 'password'];
$fields = [];
if ($formDef) {
    // Preserve the configured order + friendly labels.
    foreach ($formDef['fields'] as $name => $label) {
        if (isset($_POST[$name])) {
            $fields[$label] = trim((string)$_POST[$name]);
        }
    }
} else {
    foreach ($_POST as $name => $value) {
        if (in_array($name, $skip, true) || !is_string($value)) {
            continue;
        }
        $label = ucwords(str_replace(['_', '-'], ' ', $name));
        $fields[$label] = trim($value);
    }
}

/* ---- Validation ---- */
$email = '';
foreach (['email', 'Email'] as $k) {
    if (!empty($_POST[$k])) { $email = trim((string)$_POST[$k]); break; }
}
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(false, ['message' => 'Please enter a valid email address.'], 422);
}
$hasContent = false;
foreach ($fields as $label => $v) {
    if ($label !== 'Email' && $v !== '') { $hasContent = true; break; }
}
if (!$hasContent) {
    respond(false, ['message' => 'Please fill in the form before submitting.'], 422);
}

/* ---- Light per-IP throttle ---- */
$ip = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$storeDir = $config['store_dir'];
@mkdir($storeDir, 0775, true);
$throttleFile = $storeDir . '/.throttle.json';
$gap = (int)($config['min_seconds_between'] ?? 0);
if ($gap > 0) {
    $now = time();
    $map = is_file($throttleFile) ? (json_decode((string)file_get_contents($throttleFile), true) ?: []) : [];
    $key = md5($ip);
    if (isset($map[$key]) && ($now - (int)$map[$key]) < $gap) {
        respond(false, ['message' => 'You just submitted a message. Please wait a moment before trying again.'], 429);
    }
    $map[$key] = $now;
    // prune old entries to keep the file small
    foreach ($map as $k => $t) { if ($now - (int)$t > 86400) unset($map[$k]); }
    @file_put_contents($throttleFile, json_encode($map), LOCK_EX);
}

/* ---- Persist submission (backup that never fails the user) ---- */
$record = [
    'time'   => date('c'),
    'source' => $source,
    'ip'     => $ip,
    'fields' => $fields,
];
$stored = (bool)@file_put_contents(
    $storeDir . '/submissions-' . date('Y-m') . '.jsonl',
    json_encode($record, JSON_UNESCAPED_UNICODE) . "\n",
    FILE_APPEND | LOCK_EX
);

/* ---- Build the email bodies ---- */
$nameParts = array_filter([
    $_POST['first_name'] ?? ($_POST['firstName'] ?? ''),
    $_POST['last_name'] ?? ($_POST['lastName'] ?? ''),
]);
$senderName = trim(implode(' ', $nameParts)) ?: $email;

$rowsHtml = '';
$rowsText = '';
foreach ($fields as $label => $value) {
    $safeVal = nl2br(htmlspecialchars($value !== '' ? $value : '—', ENT_QUOTES, 'UTF-8'));
    $rowsHtml .= '<tr>'
        . '<td style="padding:8px 14px;border-bottom:1px solid #eee;font-weight:600;color:#132126;vertical-align:top;white-space:nowrap;">'
        . htmlspecialchars($label, ENT_QUOTES, 'UTF-8') . '</td>'
        . '<td style="padding:8px 14px;border-bottom:1px solid #eee;color:#333;">' . $safeVal . '</td>'
        . '</tr>';
    $rowsText .= $label . ': ' . ($value !== '' ? $value : '—') . "\n";
}

$html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;">'
    . '<div style="background:#132126;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;">'
    . '<h2 style="margin:0;font-size:18px;">' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h2>'
    . '<p style="margin:4px 0 0;color:#9fb4ad;font-size:13px;">Fair Finance Pakistan · ' . date('d M Y, H:i') . '</p>'
    . '</div>'
    . '<table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-top:none;font-size:14px;">'
    . $rowsHtml . '</table>'
    . '<p style="color:#888;font-size:12px;margin:14px 2px;">Submitted via ' . htmlspecialchars($source, ENT_QUOTES, 'UTF-8')
    . ' form · IP ' . htmlspecialchars($ip, ENT_QUOTES, 'UTF-8') . '</p></div>';

$text = $title . "\n" . str_repeat('=', strlen($title)) . "\n\n" . $rowsText
    . "\nSubmitted: " . date('c') . " · via {$source} form\n";

$subject = $title . ' — ' . $senderName;

/* ---- Send via PHPMailer / Gmail SMTP ---- */
require_once __DIR__ . '/lib/PHPMailer/Exception.php';
require_once __DIR__ . '/lib/PHPMailer/PHPMailer.php';
require_once __DIR__ . '/lib/PHPMailer/SMTP.php';

$emailed = false;
$errorDetail = '';
$smtp = $config['smtp'];

if (!empty($smtp['password'])) {
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = $smtp['host'];
        $mail->SMTPAuth   = true;
        $mail->Username   = $smtp['username'];
        $mail->Password   = $smtp['password'];
        $mail->SMTPSecure = $smtp['secure'] === 'ssl'
            ? PHPMailer::ENCRYPTION_SMTPS
            : PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = (int)$smtp['port'];
        $mail->CharSet    = 'UTF-8';

        $mail->setFrom($config['from_email'], $config['from_name']);
        foreach ($config['to'] as $to) { $mail->addAddress($to); }
        foreach (($config['cc'] ?? []) as $cc) { $mail->addCC($cc); }
        // Replies go straight to the person who filled the form.
        try { $mail->addReplyTo($email, $senderName); } catch (MailException $e) { /* ignore bad reply-to */ }

        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $html;
        $mail->AltBody = $text;

        $mail->send();
        $emailed = true;
    } catch (MailException $e) {
        $errorDetail = $mail->ErrorInfo ?: $e->getMessage();
        error_log('[FFP contact] mail failed: ' . $errorDetail);
    }
} else {
    $errorDetail = 'SMTP password not configured.';
    error_log('[FFP contact] ' . $errorDetail . ' Submission stored only.');
}

/* ---- Respond ---- */
if ($emailed || $stored) {
    respond(true, [
        'emailed' => $emailed,
        'stored'  => $stored,
        'message' => 'Thank you — your message has been received. We will be in touch soon.',
    ]);
}
respond(false, [
    'emailed' => false,
    'stored'  => false,
    'message' => 'Sorry, something went wrong sending your message. Please email us directly.',
    'detail'  => $errorDetail,
], 500);
