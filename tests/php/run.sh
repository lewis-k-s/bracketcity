#!/bin/sh
set -eu

php tests/php/test-validator.php
php tests/php/test-wordpress-stubs.php
