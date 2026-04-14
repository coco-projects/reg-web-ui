<?php

    declare(strict_types=1);

    namespace App\Services;

    use GuzzleHttp\ClientInterface as GuzzleClientInterface;
    use GuzzleHttp\Exception\GuzzleException;
    use Psr\Log\LoggerInterface;

    final class PythonApiClient
    {
        public function __construct(
            private readonly GuzzleClientInterface $client,
            private readonly ConfigService $config,
            private readonly LoggerInterface $logger,
        ) {
        }

        public function get(string $path, array $query = []): array
        {
            $url = $this->buildUrl($path);
//            $this->logger->info('[PYTHON_API][GET] ' . $url, ['query' => $query]);

            try {
                $response = $this->client->request('GET', $url, [
                    'query' => $query,
                    'timeout' => (float) $this->config->getInt('PYTHON_API_TIMEOUT', 600),
                    'http_errors' => false,
                ]);

                return $this->decodeJson((string) $response->getBody(), (int) $response->getStatusCode());
            } catch (GuzzleException $e) {
                return $this->error('PYTHON_API_REQUEST_FAILED', $e->getMessage());
            }
        }

        public function postForm(string $path, array $form = []): array
        {
            $url = $this->buildUrl($path);

            try {
                $response = $this->client->request('POST', $url, [
                    'form_params' => $form,
                    'timeout' => (float) $this->config->getInt('PYTHON_API_TIMEOUT', 600),
                    'http_errors' => false,
                ]);

                return $this->decodeJson((string) $response->getBody(), (int) $response->getStatusCode());
            } catch (GuzzleException $e) {
                return $this->error('PYTHON_API_REQUEST_FAILED', $e->getMessage());
            }
        }

        public function postJson(string $path, array $json = []): array
        {
            $url = $this->buildUrl($path);

            try {
                $response = $this->client->request('POST', $url, [
                    'json' => $json,
                    'timeout' => (float) $this->config->getInt('PYTHON_API_TIMEOUT', 600),
                    'http_errors' => false,
                ]);

                return $this->decodeJson((string) $response->getBody(), (int) $response->getStatusCode());
            } catch (GuzzleException $e) {
                return $this->error('PYTHON_API_REQUEST_FAILED', $e->getMessage());
            }
        }

        public function delete(string $path): array
        {
            $url = $this->buildUrl($path);

            try {
                $response = $this->client->request('DELETE', $url, [
                    'timeout' => (float) $this->config->getInt('PYTHON_API_TIMEOUT', 600),
                    'http_errors' => false,
                ]);

                return $this->decodeJson((string) $response->getBody(), (int) $response->getStatusCode());
            } catch (GuzzleException $e) {
                return $this->error('PYTHON_API_REQUEST_FAILED', $e->getMessage());
            }
        }

        public function streamProxyUrl(string $path, array $query = []): string
        {
            $url = $this->buildUrl($path);
            if ($query === []) {
                return $url;
            }

            return $url . '?' . http_build_query($query);
        }

        public function buildUrl(string $path): string
        {
            $base = rtrim($this->config->getString('PYTHON_API_BASE_URL', 'http://127.0.0.1:8000'), '/');
            return $base . '/' . ltrim($path, '/');
        }

        private function decodeJson(string $body, int $statusCode): array
        {
            $decoded = json_decode($body, true);

            if (is_array($decoded)) {
                return $decoded;
            }

            return $this->error(
                'PYTHON_API_INVALID_JSON',
                'Invalid JSON response',
                [
                    'status_code' => $statusCode,
                    'raw' => $body,
                ]
            );
        }

        private function error(string $code, string $message, array $extra = []): array
        {
            return [
                'ok' => false,
                'error' => array_merge([
                    'code' => $code,
                    'message' => $message,
                ], $extra),
            ];
        }
    }