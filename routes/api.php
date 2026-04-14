<?php

    declare(strict_types = 1);

    use App\Services\PythonApiClient;
    use Psr\Container\ContainerInterface;
    use Psr\Http\Message\ResponseInterface;
    use Psr\Http\Message\ServerRequestInterface;
    use Slim\App;

    return function(App $app) {
        /** @var ContainerInterface $container */
        $container = $app->getContainer();

        /** @var PythonApiClient $api */
        $api = $container->get(PythonApiClient::class);

        $json = static function(ResponseInterface $response, array $payload): ResponseInterface {
            $response->getBody()->write(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $response->withHeader('Content-Type', 'application/json');
        };

        $sseProxy = static function(string $url, ResponseInterface $response, string $errorMessage): ResponseInterface {
            while (ob_get_level() > 0)
            {
                @ob_end_clean();
            }

            if (function_exists('apache_setenv'))
            {
                @apache_setenv('no-gzip', '1');
            }

            @ini_set('zlib.output_compression', '0');
            @ini_set('output_buffering', 'off');
            @ini_set('implicit_flush', '1');
            @ini_set('max_execution_time', '0');
            @set_time_limit(0);

            header('Content-Type: text/event-stream; charset=utf-8');
            header('Cache-Control: no-cache, no-store, must-revalidate');
            header('Pragma: no-cache');
            header('Expires: 0');
            header('Connection: keep-alive');
            header('X-Accel-Buffering: no');
            header('Content-Encoding: none');

            echo ":" . str_repeat(" ", 2048) . "\n\n";
            @flush();

            $ch = curl_init($url);
            if ($ch === false)
            {
                echo "data: " . json_encode([
                        'type'    => 'error',
                        'content' => ['message' => $errorMessage],
                    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
                @flush();
                return $response;
            }

            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => false,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_HEADER         => false,
                CURLOPT_HTTPGET        => true,
                CURLOPT_TIMEOUT        => 0,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_BUFFERSIZE     => 1024,
                CURLOPT_TCP_NODELAY    => 1,
                CURLOPT_HTTPHEADER     => [
                    'Accept: text/event-stream',
                    'Cache-Control: no-cache',
                ],
                CURLOPT_WRITEFUNCTION  => static function($ch, $chunk) {
                    echo $chunk;
                    @flush();
                    return strlen($chunk);
                },
            ]);

            $ok = curl_exec($ch);

            if ($ok === false)
            {
                $message = curl_error($ch) ?: $errorMessage;
                echo "data: " . json_encode([
                        'type'    => 'error',
                        'content' => ['message' => $message],
                    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
                @flush();
            }

            curl_close($ch);

            return $response;
        };

        $app->get('/php-api/health', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            return $json($response, $api->get('/api/health'));
        });

        $app->get('/php-api/projects', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            return $json($response, $api->get('/api/projects'));
        });

        $app->get('/php-api/models', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            return $json($response, $api->get('/api/models'));
        });

        $app->post('/php-api/search', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            $data = (array)$request->getParsedBody();

            return $json($response, $api->postForm('/api/search', $data));
        });

        $app->post('/php-api/answer', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            $data = (array)$request->getParsedBody();

            return $json($response, $api->postForm('/api/answer', $data));
        });

        $app->get('/php-api/answer-stream-proxy', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $sseProxy) {
            $query = $request->getQueryParams();
            unset($query['s']);
            $url = $api->streamProxyUrl('/api/answer/stream', $query);

            return $sseProxy($url, $response, '无法连接 Python SSE 接口');
        });

        $app->get('/php-api/source', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            $query = $request->getQueryParams();
            unset($query['s']);

            return $json($response, $api->get('/api/source', $query));
        });

        $app->get('/php-api/history', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            $query = $request->getQueryParams();
            unset($query['s']);

            return $json($response, $api->get('/api/history', $query));
        });

        $app->get('/php-api/history/{id}', function(ServerRequestInterface $request, ResponseInterface $response, array $args) use ($api, $json) {
            return $json($response, $api->get('/api/history/' . $args['id']));
        });

        $app->post('/php-api/history/{id}/favorite', function(ServerRequestInterface $request, ResponseInterface $response, array $args) use ($api, $json) {
            return $json($response, $api->postForm('/api/history/' . $args['id'] . '/favorite', []));
        });

        $app->delete('/php-api/history/{id}', function(ServerRequestInterface $request, ResponseInterface $response, array $args) use ($api, $json) {
            return $json($response, $api->delete('/api/history/' . $args['id']));
        });

        $app->post('/php-api/history/session/{sessionId}/favorite', function(ServerRequestInterface $request, ResponseInterface $response, array $args) use ($api, $json) {
            return $json($response, $api->postForm('/api/history/session/' . $args['sessionId'] . '/favorite', []));
        });

        $app->delete('/php-api/history/session/{sessionId}', function(ServerRequestInterface $request, ResponseInterface $response, array $args) use ($api, $json) {
            return $json($response, $api->delete('/api/history/session/' . $args['sessionId']));
        });

        $app->post('/php-api/history/clear-all', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            return $json($response, $api->postForm('/api/history/clear-all', []));
        });

        $app->post('/php-api/tasks', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            $raw  = (string)$request->getBody();
            $data = json_decode($raw, true);
            if (!is_array($data))
            {
                $data = (array)$request->getParsedBody();
            }

            return $json($response, $api->postJson('/api/tasks', $data));
        });

        $app->get('/php-api/tasks', function(ServerRequestInterface $request, ResponseInterface $response) use ($api, $json) {
            $query = $request->getQueryParams();
            unset($query['s']);

            return $json($response, $api->get('/api/tasks', $query));
        });

        $app->get('/php-api/tasks/{id}', function(ServerRequestInterface $request, ResponseInterface $response, array $args) use ($api, $json) {
            return $json($response, $api->get('/api/tasks/' . $args['id']));
        });

        $app->get('/php-api/tasks/{id}/logs', function(ServerRequestInterface $request, ResponseInterface $response, array $args) use ($api, $json) {
            $query = $request->getQueryParams();
            unset($query['s']);

            return $json($response, $api->get('/api/tasks/' . $args['id'] . '/logs', $query));
        });

        $app->get('/php-api/tasks/{id}/stream-proxy', function(ServerRequestInterface $request, ResponseInterface $response, array $args) use ($api, $sseProxy) {
            $query = $request->getQueryParams();
            unset($query['s']);
            $url = $api->streamProxyUrl('/api/tasks/' . $args['id'] . '/stream', $query);

            return $sseProxy($url, $response, '无法连接 Python Task SSE 接口');
        });
    };