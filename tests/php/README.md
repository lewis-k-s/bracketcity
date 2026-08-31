# PHP tests

Run the tests without a local PHP installation:

```sh
docker run --rm \
  -v "$PWD:/app" \
  -w /app \
  php:8.3-cli \
  sh -c "find wordpress-plugin tests/php -name '*.php' -print0 | xargs -0 -n1 php -l && sh tests/php/run.sh"
```

`test-validator.php` runs without WordPress. `test-wordpress-stubs.php` checks
the registration contract with small WordPress stubs.

A release gate must also run the plugin in a clean WordPress installation. That
release gate is disposable and uses port 18080:

```sh
sh tests/php/run-wordpress-integration.sh
```

It builds PHP with intl and mbstring, installs a clean WordPress site, activates
the mounted plugin, and tests the CPT, seed transaction, real REST dispatch,
role capability gates, future releases, correction rules, revisions, and the
shortcode assets. It removes its containers and volumes when it finishes.

All custom REST responses intentionally use `Cache-Control: no-store, private`.
This favors immediate puzzle-correction freshness over public response caching.
