<?php

    declare(strict_types=1);

    use App\Controllers\AdminController;
    use App\Controllers\HistoryController;
    use App\Controllers\HomeController;
    use App\Controllers\SearchController;
    use App\Services\ConfigService;
    use App\Services\PageBootService;
    use App\Services\PythonApiClient;
    use DI\Container;
    use Dotenv\Dotenv;
    use Monolog\Handler\RotatingFileHandler;
    use Monolog\Level;
    use Monolog\Logger;
    use Psr\Http\Client\ClientInterface;
    use Slim\Factory\AppFactory;
    use Slim\Views\Twig;
    use Slim\Views\TwigMiddleware;

    require __DIR__ . '/vendor/autoload.php';

    $dotenv = Dotenv::createImmutable(__DIR__);
    $dotenv->safeLoad();

    date_default_timezone_set($_ENV['APP_TZ'] ?? 'Asia/Shanghai');

    $container = new Container();

    $container->set(ConfigService::class, function () {
        return new ConfigService($_ENV);
    });

    $container->set(Logger::class, function (Container $container) {
        /** @var ConfigService $config */
        $config = $container->get(ConfigService::class);

        $logDir = $config->getString('LOG_DIR', 'storage/logs');
        $fullLogDir = str_starts_with($logDir, '/')
            ? $logDir
            : __DIR__ . '/' . ltrim($logDir, '/');

        if (!is_dir($fullLogDir)) {
            mkdir($fullLogDir, 0777, true);
        }

        $days = max(1, $config->getInt('LOG_DAYS', 30));
        $logFile = rtrim($fullLogDir, '/') . '/app.log';

        $logger = new Logger('code-rag-web');

        $logger->pushHandler(new RotatingFileHandler(
            $logFile,
            $days,
            Level::Warning,
            true,
            0755
        ));

        return $logger;
    });

    $container->set(Twig::class, function () {
        return Twig::create(__DIR__ . '/templates', [
            'cache' => false,
            'debug' => true,
            'auto_reload' => true,
        ]);
    });

    $container->set(ClientInterface::class, function () {
        return new \GuzzleHttp\Client();
    });

    $container->set(PythonApiClient::class, function (Container $container) {
        return new PythonApiClient(
            $container->get(ClientInterface::class),
            $container->get(ConfigService::class),
            $container->get(Logger::class),
        );
    });

    $container->set(PageBootService::class, function (Container $container) {
        return new PageBootService(
            $container->get(PythonApiClient::class),
            $container->get(ConfigService::class),
        );
    });

    $container->set(HomeController::class, function (Container $container) {
        return new HomeController(
            $container->get(Twig::class),
            $container->get(PageBootService::class),
        );
    });

    $container->set(SearchController::class, function (Container $container) {
        return new SearchController(
            $container->get(Twig::class),
            $container->get(PageBootService::class),
        );
    });

    $container->set(AdminController::class, function (Container $container) {
        return new AdminController(
            $container->get(Twig::class),
            $container->get(PageBootService::class),
        );
    });

    $container->set(HistoryController::class, function (Container $container) {
        return new HistoryController(
            $container->get(Twig::class),
            $container->get(PageBootService::class),
        );
    });

    AppFactory::setContainer($container);
    $app = AppFactory::create();

    $app->addBodyParsingMiddleware();
    $app->addRoutingMiddleware();

    $errorMiddleware = $app->addErrorMiddleware(true, true, true);
    $errorMiddleware->setDefaultErrorHandler(function (
        Psr\Http\Message\ServerRequestInterface $request,
        Throwable $exception,
        bool $displayErrorDetails
    ) use ($app, $container) {
        /** @var Logger $logger */
        $logger = $container->get(Logger::class);
        $logger->error('[PHP_ERROR] ' . $exception->getMessage(), [
            'path' => (string) $request->getUri()->getPath(),
            'trace' => $exception->getTraceAsString(),
        ]);

        $path = $request->getUri()->getPath();

        if (str_starts_with($path, '/php-api/')) {
            $response = $app->getResponseFactory()->createResponse(500);
            $response->getBody()->write(json_encode([
                'ok' => false,
                'error' => [
                    'code' => 'PHP_INTERNAL_ERROR',
                    'message' => $exception->getMessage(),
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $response->withHeader('Content-Type', 'application/json');
        }

        $response = $app->getResponseFactory()->createResponse(500);
        $response->getBody()->write(
            '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>系统错误</title></head><body style="font-family:sans-serif;padding:24px;">'
            . '<h2>页面发生错误</h2>'
            . '<p>' . htmlspecialchars($exception->getMessage(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</p>'
            . '</body></html>'
        );

        return $response->withHeader('Content-Type', 'text/html; charset=utf-8');
    });

    $app->add(TwigMiddleware::create($app, $container->get(Twig::class)));

    (require __DIR__ . '/routes/web.php')($app);
    (require __DIR__ . '/routes/api.php')($app);

    return $app;