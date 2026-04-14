<?php

    declare(strict_types=1);

    use App\Controllers\AdminController;
    use App\Controllers\HistoryController;
    use App\Controllers\HomeController;
    use App\Controllers\SearchController;
    use Psr\Container\ContainerInterface;
    use Slim\App;

    return function (App $app) {
        /** @var ContainerInterface $container */
        $container = $app->getContainer();

        $app->get('/', [$container->get(HomeController::class), 'index']);
        $app->get('/search', [$container->get(SearchController::class), 'index']);
        $app->get('/admin', [$container->get(AdminController::class), 'index']);
        $app->get('/history', [$container->get(HistoryController::class), 'index']);
    };