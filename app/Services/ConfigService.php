<?php

    declare(strict_types=1);

    namespace App\Services;

    final class ConfigService
    {
        public function __construct(
            private readonly array $env = []
        ) {
        }

        public function get(string $key, mixed $default = null): mixed
        {
            if (array_key_exists($key, $this->env)) {
                return $this->env[$key];
            }

            $value = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);
            return $value === false || $value === null || $value === '' ? $default : $value;
        }

        public function getString(string $key, string $default = ''): string
        {
            return (string) $this->get($key, $default);
        }

        public function getInt(string $key, int $default = 0): int
        {
            return (int) $this->get($key, $default);
        }

        public function getBool(string $key, bool $default = false): bool
        {
            $value = $this->get($key, $default);
            if (is_bool($value)) {
                return $value;
            }

            $normalized = strtolower((string) $value);
            return in_array($normalized, ['1', 'true', 'yes', 'on'], true);
        }
    }