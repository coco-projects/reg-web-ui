class CodeRagSearchPage extends CodeRagBasePage {
    constructor() {
        super();
        this.currentSearchItems = [];
    }

    async init() {
        CodeRagUi.activateNav();
        this.bindCommonEvents();
        this.bindEvents();
        this.startHealthPolling($('#search_project_name').val() || '');
    }

    bindEvents() {
        const self = this;

        $(document).on('click', '[data-action="fill-search-example"]', function () {
            $('#search_query').val('RedisTagAwareAdapter 类');
            $('#search_kinds_group input').prop('checked', false);
            $('#search_kinds_group input[value="class"]').prop('checked', true);
        });

        $(document).on('click', '[data-action="run-search"]', function () {
            self.runSearch();
        });

        $('#search_project_name').on('change', function () {
            self.startHealthPolling($(this).val() || '');
        });
    }

    getKinds() {
        return $('#search_kinds_group').find('input:checked').map(function () {
            return $(this).val();
        }).get().join(',');
    }

    getQaContextParams() {
        return {
            project_name: $('#search_project_name').val() || '',
            embed_model: $('#search_embed_model').val() || '',
            chat_model: $('#search_chat_model').val() || '',
        };
    }

    async runSearch() {
        const ok = await this.checkGlobalHealth($('#search_project_name').val() || '');
        if (!ok) return;

        $('#search_loading').addClass('active');
        $('#search_results').html("<div class='mini-meta'>搜索中...</div>");

        try {
            const data = await CodeRagPhpApi.postForm('/php-api/search', {
                project_name: $('#search_project_name').val(),
                query: $('#search_query').val(),
                kinds: this.getKinds(),
                path_prefix: $('#search_path_prefix').val() || '',
                namespace_prefix: $('#search_namespace_prefix').val() || '',
                visibility: $('#search_visibility').val() || '',
                limit: $('#search_limit').val() || '5',
                include_auxiliary: 0,
                embed_model: $('#search_embed_model').val() || '',
                chat_model: $('#search_chat_model').val() || ''
            });

            const items = CodeRagUi.normalizeApiListResponse(data);
            const meta = data.meta || {};
            this.currentSearchItems = items;

            let logsHtml = '';
            if (Array.isArray(meta.logs) && meta.logs.length) {
                logsHtml = `<div class="doc-box status-box mb-2">${meta.logs.map(line => CodeRagUi.escape(line)).join('<br>')}</div>`;
            }

            $('#search_results').html(
                logsHtml +
                `<div class="mini-meta mb-2">耗时：${meta.elapsed_ms || 0} ms | embed=${meta.embed_model || '-'} | chat=${meta.chat_model || '-'} | cli=${CodeRagUi.escape(meta.cli_preview || '')}</div>` +
                (items.length ? items.map((item, idx) => `
                    <div class="search-item" data-search-index="${idx}">
                      <div class="search-title">${CodeRagUi.escape(item.fqname || '')}</div>
                      <div class="mini-meta">${item.kind || ''} | ${item.source_scope || ''} | ${item.relative_path || ''}:${item.start_line || 0}-${item.end_line || 0}</div>
                      <div class="actions-row">
                        <button class="btn btn-sm btn-outline-secondary" data-search-detail="${idx}">详情</button>
                        <button class="btn btn-sm btn-warning" data-search-source="${idx}">看源码</button>
                        <button class="btn btn-sm btn-outline-secondary" data-search-ask="${idx}">带入问答</button>
                      </div>
                    </div>
                `).join('') : "<div class='mini-meta'>没有结果</div>")
            );

            if (Array.isArray(meta.logs) && meta.logs.length) {
                CodeRagUi.renderLogLines($('#search_logs_box'), meta.logs);
            }

            this.bindSearchEvents();
        } catch (e) {
            $('#search_results').html("<div class='mini-meta'>搜索失败</div>");
        }

        $('#search_loading').removeClass('active');
    }

    bindSearchEvents() {
        const self = this;

        $('#search_results .search-item').each(function () {
            const index = parseInt($(this).data('search-index'), 10);
            const item = self.currentSearchItems[index];

            $(this).on('mouseenter', function (e) {
                const md = `### ${item.fqname || ''}

- **kind**: ${item.kind || ''}
- **signature**: ${item.signature || ''}
- **file**: ${item.relative_path || ''}:${item.start_line || 0}-${item.end_line || 0}`;
                CodeRagUi.showHover(e, md, true);
            }).on('mouseleave', function () {
                CodeRagUi.hideHover();
            }).on('click', function (e) {
                if ($(e.target).closest('button').length) return;
                self.showSearchDetail(index);
            });
        });

        $('[data-search-detail]').off('click').on('click', function (e) {
            e.stopPropagation();
            self.showSearchDetail(parseInt($(this).data('search-detail'), 10));
        });

        $('[data-search-source]').off('click').on('click', function (e) {
            e.stopPropagation();
            const index = parseInt($(this).data('search-source'), 10);
            const item = self.currentSearchItems[index];
            if (!item) return;
            self.openSourceModalByPath($('#search_project_name').val(), item.relative_path, item.start_line, item.end_line);
        });

        $('[data-search-ask]').off('click').on('click', function (e) {
            e.stopPropagation();
            const index = parseInt($(this).data('search-ask'), 10);
            const item = self.currentSearchItems[index];
            if (!item) return;

            self.navigateToQa({
                question: `请解释 ${item.fqname} 是什么，它在这个项目里起什么作用？`,
                ...self.getQaContextParams(),
            });
        });
    }

    async showSearchDetail(index) {
        const item = this.currentSearchItems[index];
        if (!item) return;

        let md = `### ${item.fqname || ''}

- **kind**: \`${item.kind || ''}\`
- **scope**: \`${item.source_scope || ''}\`
- **file**: \`${item.relative_path || ''}\`
- **line_range**: \`${item.start_line || 0}-${item.end_line || 0}\`
- **signature**: \`${item.signature || ''}\``;

        if (item.code) {
            md += `

\`\`\`php
${item.code}
\`\`\``;
        }

        this.currentSourceModalData = {
            relative_path: item.relative_path || '',
            raw_content: item.code || '',
            start_line: item.start_line || 1,
            end_line: item.end_line || 1,
        };

        CodeRagUi.openModal(
            item.fqname || '搜索结果详情',
            `${item.kind || '-'} | ${item.source_scope || '-'} | ${item.relative_path || ''}:${item.start_line || 0}-${item.end_line || 0}`,
            md
        );
    }
}

window.CodeRagSearchPage = CodeRagSearchPage;