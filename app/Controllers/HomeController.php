<?php

    declare(strict_types=1);

    namespace App\Controllers;

    use App\Services\PageBootService;
    use Psr\Http\Message\ResponseInterface;
    use Psr\Http\Message\ServerRequestInterface;
    use Slim\Views\Twig;

    final class HomeController
    {
        public function __construct(
            private readonly Twig $twig,
            private readonly PageBootService $pageBoot,
        ) {
        }

        public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
        {
            return $this->twig->render(
                $response,
                'index.twig',
                $this->pageBoot->getCommonPageData()
            );
        }
    }