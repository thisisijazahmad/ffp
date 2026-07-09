<?php
/**
 * Contact-form mail configuration — Fair Finance Pakistan.
 *
 * All website contact forms (about.html, roundtables.html, contact_form.html)
 * post to api/contact.php, which reads this file.
 *
 * IMPORTANT — to actually deliver mail from the Gmail account you must set a
 * Gmail "App Password" (NOT the normal account password):
 *   1. Enable 2-Step Verification on fairfinancepakistan@gmail.com
 *   2. Google Account → Security → App passwords → generate one for "Mail"
 *   3. Put the 16-character value below in 'password', or better, set the
 *      FFP_SMTP_PASS environment variable (keeps the secret out of the repo).
 *
 * Until a password is set, submissions are still SAVED to data/contact/ so no
 * enquiry is ever lost — they just won't be emailed yet.
 */

return [
    'smtp' => [
        'host' => 'smtp.gmail.com',
        'port' => 587,
        'secure' => 'tls',                          // STARTTLS on 587
        'username' => 'fairfinancepakistan@gmail.com',
        'password' => getenv('FFP_SMTP_PASS') ?: 'cqhyuzunbyiauoqx',  // <-- Gmail App Password here
    ],

    // The mail is sent "from" this address (per FFP brief).
    'from_email' => 'fairfinancepakistan@gmail.com',
    'from_name' => 'Fair Finance Pakistan',

    // Primary recipient that receives every submission (name, org, contact…).
    'to' => [
        'fairfinancepakistan@gmail.com',
    ],

    // Also copied to the FFP contact owner.
    'cc' => [
        'huma.iqbal@fairfinancepakistan.org',
    ],

    // Every submission is appended here as a backup (one JSON object per line).
    'store_dir' => __DIR__.'/../data/contact',

    // Simple per-IP throttle (seconds between submissions) to deter abuse.
    'min_seconds_between' => 20,

    // Friendly labels + field order for each form, keyed by the form's
    // data-contact-form value. Fields not listed are still included generically.
    'forms' => [
        'general-contact' => [
            'title' => 'New Contact Form Submission',
            'fields' => [
                'first_name' => 'First name',
                'last_name' => 'Last name',
                'email' => 'Email',
                'city' => 'City',
                'country' => 'Country',
                'message' => 'Message',
            ],
        ],
        'about-contact' => [
            'title' => 'New Enquiry (About page)',
            'fields' => [
                'firstName' => 'First name',
                'lastName' => 'Last name',
                'jobTitle' => 'Job title',
                'organization' => 'Company / organization',
                'email' => 'Email',
                'comments' => 'Comments or questions',
            ],
        ],
        'roundtable-interest' => [
            'title' => 'New Roundtable Interest Registration',
            'fields' => [
                'first_name' => 'First name',
                'last_name' => 'Last name',
                'job_title' => 'Job title',
                'company' => 'Company',
                'email' => 'Email',
                'city' => 'City',
                'country' => 'Country',
            ],
        ],
    ],
];
