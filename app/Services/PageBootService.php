<?php

    declare(strict_types=1);

    namespace App\Services;

    final class PageBootService
    {
        public function __construct(
            private readonly PythonApiClient $api,
        ) {
        }

        public function getProjects(): array
        {
            $projectsResp = $this->api->get('/api/projects');

            if (!(($projectsResp['ok'] ?? false) && is_array($projectsResp['data'] ?? null))) {
                return [];
            }

            return array_keys($projectsResp['data']);
        }

        public function getModels(): array
        {
            $modelsResp = $this->api->get('/api/models');

            if (!(($modelsResp['ok'] ?? false) && is_array($modelsResp['data'] ?? null))) {
                return [];
            }

            return $modelsResp['data'];
        }

        public function getCommonPageData(): array
        {
            $modelData = $this->getModels();

            return [
                'projects' => $this->getProjects(),
                'embed_model_choices' => $modelData['embed_model_choices'] ?? [],
                'chat_model_choices' => $modelData['chat_model_choices'] ?? [],
                'default_embed_model' => $modelData['embed_model'] ?? '',
                'default_chat_model' => $modelData['chat_model'] ?? '',
            ];
        }

        public function getProjectsOnlyPageData(): array
        {
            return [
                'projects' => $this->getProjects(),
            ];
        }
    }