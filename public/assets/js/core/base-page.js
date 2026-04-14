class CodeRagBasePage {
    constructor() {
        this.currentSourceModalData = null;
        this.healthTimer = null;
    }

    bindCommonEvents() {
        const self = this;

        $(document).on('click', '[data-box-toggle]', function () {
            const target = $(this).data('box-toggle');
            $('#' + target).toggleClass('collapsed');
            $(this).text($('#' + target).hasClass('collapsed') ? '展开' : '折叠');
        });

        $(document).on('click', '[data-action="close-source-modal"]', function () {
            CodeRagUi.closeModal();
        });

        $(document).on('click', '[data-action="copy-source-modal"]', async function () {
            const text = self.currentSourceModalData?.raw_content || $('#source_modal_content').text() || '';
            await CodeRagUi.copyText(text);
        });

        $(document).on('click', '[data-action="open-full-file"]', function () {
            if (!self.currentSourceModalData) return;
            const projectName = self.resolveCurrentProjectName();
            if (!projectName) return;
            self.openSourceModalByPath(projectName, self.currentSourceModalData.relative_path, 1, 400);
        });

        $('#source_modal_mask').on('click', function (e) {
            if (e.target.id === 'source_modal_mask') {
                CodeRagUi.closeModal();
            }
        });
    }

    resolveCurrentProjectName() {
        return (
            $('#project_name').val() ||
            $('#search_project_name').val() ||
            $('#admin_project_name').val() ||
            $('#history_project_name').val() ||
            ''
        );
    }

    resolveCurrentQaContext() {
        return {
            project_name: $('#project_name').val() || $('#search_project_name').val() || '',
            embed_model: $('#embed_model').val() || $('#search_embed_model').val() || '',
            chat_model: $('#chat_model').val() || $('#search_chat_model').val() || '',
            profile: $('#profile').val() || '',
            style: $('#style').val() || '',
            session_id: $('#current_session_id').text() && $('#current_session_id').text() !== '（新会话）'
                ? $('#current_session_id').text()
                : ''
        };
    }

    applyQaQueryToForm(params = {}) {
        if (params.question) $('#question').val(params.question);
        if (params.project_name) $('#project_name').val(params.project_name);
        if (params.profile) $('#profile').val(params.profile);
        if (params.style) $('#style').val(params.style);
        if (params.embed_model) $('#embed_model').val(params.embed_model);
        if (params.chat_model) $('#chat_model').val(params.chat_model);
    }

    buildQaUrl(params = {}) {
        const query = new URLSearchParams();
        Object.keys(params || {}).forEach(key => {
            const value = params[key];
            if (value === null || typeof value === 'undefined' || value === '') return;
            query.set(key, String(value));
        });
        return '/?' + query.toString();
    }

    navigateToQa(params = {}) {
        window.location.href = this.buildQaUrl(params);
    }

    startHealthPolling(projectName = '') {
        this.stopHealthPolling();
        const self = this;

        const tick = async function () {
            await self.checkGlobalHealth(projectName);
            self.healthTimer = setTimeout(tick, 2000);
        };

        tick();
    }

    stopHealthPolling() {
        if (this.healthTimer) {
            clearTimeout(this.healthTimer);
            this.healthTimer = null;
        }
    }

    async checkGlobalHealth(projectName = '') {
        const health = await CodeRagPhpApi.health();
        if (!(health && health.ok)) {
            CodeRagUi.renderBanner(
                `<strong>Python 服务不可用</strong>：请先启动 <code>python main.py web --host 0.0.0.0 --port 8000</code>`,
                'danger'
            );
            return false;
        }

        if (window.location.pathname === '/admin' && projectName) {
            try {
                const tasks = await CodeRagPhpApi.tasks({
                    project_name: projectName,
                    limit: 20
                });

                if (!(tasks && tasks.ok)) {
                    CodeRagUi.renderBanner(
                        `<strong>任务接口不可用</strong>：请检查 Python 服务与 <code>/api/tasks</code> 是否正常`,
                        'warning'
                    );
                    return true;
                }

                const rows = CodeRagUi.normalizeApiListResponse(tasks);
                const now = Date.now() / 1000;

                const queuedTooLong = rows.some(item => {
                    if (item.status !== 'queued') return false;
                    const createdAt = this.parseMaybeTimestamp(item.created_at);
                    if (!createdAt) return false;
                    return (now - createdAt) > 15;
                });

                if (queuedTooLong) {
                    CodeRagUi.renderBanner(
                        `<strong>任务等待较久：</strong>发现存在长时间 queued 的任务，请确认 worker 已启动：<code>python main.py task-worker</code>`,
                        'warning'
                    );
                } else {
                    CodeRagUi.clearBanner();
                }
            } catch (e) {
                CodeRagUi.renderBanner(
                    `<strong>任务接口不可用</strong>：请检查 Python 服务与 <code>/api/tasks</code> 是否正常`,
                    'warning'
                );
            }
        } else {
            CodeRagUi.clearBanner();
        }

        return true;
    }

    parseMaybeTimestamp(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value;
        const unix = Date.parse(value);
        if (isNaN(unix)) return 0;
        return Math.floor(unix / 1000);
    }

    async openSourceModalByPath(projectName, relativePath, startLine = 1, endLine = 120) {
        try {
            const data = await CodeRagPhpApi.get('/php-api/source', {
                project_name: projectName,
                relative_path: relativePath,
                start_line: startLine,
                end_line: endLine
            });

            if (data.error) {
                CodeRagUi.toast(data.error.message || '加载源码失败', 'error');
                return;
            }

            const payload = data.data || data;
            this.currentSourceModalData = payload;

            CodeRagUi.openModal(
                payload.relative_path || '源码片段',
                `行 ${payload.start_line}-${payload.end_line}`,
                `\`\`\`php\n${payload.raw_content || ''}\n\`\`\``
            );
        } catch (e) {
            CodeRagUi.toast('加载源码失败', 'error');
        }
    }
}

window.CodeRagBasePage = CodeRagBasePage;