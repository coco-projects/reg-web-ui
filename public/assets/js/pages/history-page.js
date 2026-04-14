class CodeRagHistoryPage extends CodeRagBasePage {
    constructor() {
        super();
        this.currentItems = [];
        this.currentSessionMap = {};
        this.currentSessionItems = [];
        this.currentSessionEvidences = [];
        this.page = 1;
        this.pageSize = 20;
        this.currentRenderedSessionId = '';
    }

    async init() {
        CodeRagUi.activateNav();
        this.bindCommonEvents();
        this.bindEvents();
        this.startHealthPolling($('#history_project_name').val() || '');
        await this.loadHistory(1);
    }

    bindEvents() {
        const self = this;

        $(document).on('click', '[data-action="history-page-search"]', function () {
            self.loadHistory(1);
        });

        $(document).on('click', '[data-action="history-page-prev"]', function () {
            self.prevPage();
        });

        $(document).on('click', '[data-action="history-page-next"]', function () {
            self.nextPage();
        });

        $(document).on('click', '[data-action="history-page-clear-project"]', function () {
            self.clearCurrentProject();
        });

        $(document).on('click', '[data-action="history-page-clear-all"]', function () {
            self.clearAll();
        });

        $('#history_project_name').on('change', function () {
            self.startHealthPolling($(this).val() || '');
        });
    }

    buildSessionMap(items) {
        const groups = {};
        items.forEach(item => {
            const sid = item.session_id || 'no-session';
            if (!groups[sid]) groups[sid] = [];
            groups[sid].push(item);
        });
        Object.keys(groups).forEach(sid => groups[sid].sort((a, b) => (a.created_at || 0) - (b.created_at || 0)));
        this.currentSessionMap = groups;
    }

    buildSessionHtml(sessionIds, start) {
        return sessionIds.map((sid, idx) => {
            const items = this.currentSessionMap[sid] || [];
            const first = items[0] || {};
            const favorite = items.some(x => !!x.is_favorite);
            const created = first.created_at ? new Date(first.created_at * 1000).toLocaleString() : '-';
            const question = first.question || '(空问题)';
            const children = items.map((item) => {
                const globalIndex = this.currentItems.findIndex(x => x.id === item.id);
                return `
                    <div class="session-child-item" data-history-index="${globalIndex}">
                      <div class="history-title">${CodeRagUi.escape(item.question || '')}</div>
                      <div class="mini-meta">${item.created_at ? new Date(item.created_at * 1000).toLocaleString() : '-'} | ${item.profile || '-'} | ${item.style || '-'} | ${item.embed_model || '-'} | ${item.chat_model || '-'}</div>
                    </div>
                `;
            }).join('');

            return `
                <div class="session-group-item" data-history-session="${sid}">
                  <div class="session-group-head">
                    <div class="session-group-main">
                      <div class="actions-row mb-1">
                        <button class="btn btn-sm btn-outline-secondary" data-history-session-detail="${sid}">详情</button>
                        <button class="btn btn-sm btn-outline-secondary" data-history-session-continue="${sid}">继续提问</button>
                        <button class="btn btn-sm ${favorite ? 'btn-warning' : 'btn-outline-secondary'}" data-history-session-favorite="${sid}">${favorite ? '取消收藏' : '收藏'}</button>
                        <button class="btn btn-sm btn-danger" data-history-session-delete="${sid}">删除</button>
                      </div>
                      <div class="session-group-title">Session ${start + idx + 1} · ${CodeRagUi.escape(question)}</div>
                      <div class="mini-meta">${created} | ${first.project_name || '-'} | ${items.length} 条对话 | <span class="${favorite ? 'favorite-on' : 'favorite-off'}">${favorite ? '★ 已收藏' : '☆ 未收藏'}</span></div>
                      <div class="session-children">${children}</div>
                    </div>
                  </div>
                </div>
            `;
        }).join('');
    }

    async loadHistory(page = 1) {
        this.page = page;

        try {
            const res = await CodeRagPhpApi.get('/php-api/history', {
                project_name: $('#history_project_name').val() || '',
                keyword: $('#history_keyword_page').val() || '',
                limit: 200
            });

            this.currentItems = CodeRagUi.normalizeApiListResponse(res).filter(Boolean);
            this.buildSessionMap(this.currentItems);

            const sessionIds = Object.keys(this.currentSessionMap).sort((a, b) => {
                const aItems = this.currentSessionMap[a] || [];
                const bItems = this.currentSessionMap[b] || [];
                return (bItems[bItems.length - 1]?.created_at || 0) - (aItems[aItems.length - 1]?.created_at || 0);
            });

            const totalPages = Math.max(1, Math.ceil(sessionIds.length / this.pageSize));
            if (this.page > totalPages) this.page = totalPages;
            const start = (this.page - 1) * this.pageSize;
            const pageSessionIds = sessionIds.slice(start, this.page * this.pageSize);

            $('#history_page_list').html(pageSessionIds.length ? this.buildSessionHtml(pageSessionIds, start) : "<div class='mini-meta'>暂无历史</div>");

            $('#history_page_pager_info').text(`第 ${this.page} / ${totalPages} 页`);
            $('#history_page_prev_btn').prop('disabled', this.page <= 1);
            $('#history_page_next_btn').prop('disabled', this.page >= totalPages);

            this.bindListEvents();
        } catch (e) {
            $('#history_page_list').html("<div class='mini-meta'>加载历史失败</div>");
        }
    }

    bindListEvents() {
        const self = this;

        $('.session-child-item').off('mouseenter').on('mouseenter', function (e) {
            const index = parseInt($(this).data('history-index'), 10);
            const item = self.currentItems[index];
            if (!item) return;
            const md = `### 问题\n\n${item.question || ''}\n\n### 回答预览\n\n${(item.answer || '').slice(0, 800)}`;
            CodeRagUi.showHover(e, md, true);
        }).off('mouseleave').on('mouseleave', function () {
            CodeRagUi.hideHover();
        }).off('click').on('click', function (e) {
            e.stopPropagation();
            const index = parseInt($(this).data('history-index'), 10);
            const item = self.currentItems[index];
            if (!item) return;

            const sessionId = item.session_id || '';
            const items = self.currentSessionMap[sessionId] || [];
            const targetIndex = items.findIndex(x => x.id === item.id);

            self.showSession(sessionId, targetIndex);
        });

        $('[data-history-session-detail]').off('click').on('click', function () {
            self.showSession($(this).data('history-session-detail'), 0);
        });

        $('[data-history-session-continue]').off('click').on('click', function () {
            self.continueSession($(this).data('history-session-continue'));
        });

        $('[data-history-session-favorite]').off('click').on('click', async function () {
            const sid = $(this).data('history-session-favorite');
            await CodeRagPhpApi.postForm(`/php-api/history/session/${encodeURIComponent(sid)}/favorite`, {});
            await self.loadHistory(self.page);
        });

        $('[data-history-session-delete]').off('click').on('click', async function () {
            const sid = $(this).data('history-session-delete');
            if (!confirm('确认删除整个会话？')) return;
            await CodeRagPhpApi.delete(`/php-api/history/session/${encodeURIComponent(sid)}`);
            await self.loadHistory(self.page);
            $('#history_page_detail').html("<div class='doc-box history-detail-scroll'><div class='mini-meta'>会话已删除</div></div>");
        });

        $('[data-history-session]').off('click').on('click', function (e) {
            if ($(e.target).closest('button').length) return;
            self.showSession($(this).data('history-session'), 0);
        });
    }

    showSession(sessionId, focusIndex = 0) {
        const items = this.currentSessionMap[sessionId] || [];
        if (!items.length) return;

        this.currentRenderedSessionId = sessionId;
        this.currentSessionItems = items;
        this.currentSessionEvidences = items[items.length - 1]?.evidences || [];

        const safeFocusIndex = Math.max(0, Math.min(focusIndex, items.length - 1));

        const html = `
            <div class="doc-box history-detail-scroll" id="history_detail_scroll_box">
                <div class="history-session-view">
                    <div class="history-session-title">Session: ${CodeRagUi.escape(sessionId)}</div>
                    ${items.map((it, i) => `
                        <div class="history-turn-card history-turn-anchor ${i === safeFocusIndex ? 'active-turn' : ''}" id="history_turn_card_${i}">
                            <div class="history-turn-head">
                                <span class="history-turn-badge">Q${i + 1}</span>
                                <div class="history-turn-question">${CodeRagUi.escape(it.question || '')}</div>
                            </div>
                            <div class="history-turn-body">
                                <div class="mini-meta mb-2">
                                    ${it.created_at ? new Date(it.created_at * 1000).toLocaleString() : '-'} |
                                    ${CodeRagUi.escape(it.profile || '-')} |
                                    ${CodeRagUi.escape(it.style || '-')} |
                                    ${CodeRagUi.escape(it.embed_model || '-')} |
                                    ${CodeRagUi.escape(it.chat_model || '-')}
                                </div>
                                <div class="history-turn-answer" id="history_turn_answer_${i}"></div>
                            </div>
                        </div>
                    `).join('')}
                    ${this.currentSessionEvidences.length ? `
                        <div class="history-evidence-box">
                            <div class="history-evidence-title">Evidence 列表</div>
                            <div class="mini-meta">
                                ${this.currentSessionEvidences.map((ev, idx) => `[${idx + 1}] ${CodeRagUi.escape(ev.title || '')} | ${CodeRagUi.escape(ev.relative_path || '')}`).join('<br>')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        $('#history_page_detail').html(html);

        items.forEach((it, i) => {
            CodeRagUi.renderMarkdown($(`#history_turn_answer_${i}`), it.answer || '');
        });

        setTimeout(() => {
            this.scrollToTurn(safeFocusIndex);
        }, 30);
    }

    scrollToTurn(index) {
        const $box = $('#history_detail_scroll_box');
        const $target = $('#history_turn_card_' + index);

        if (!$box.length || !$target.length) return;

        $('#history_detail_scroll_box .history-turn-card').removeClass('active-turn');
        $target.addClass('active-turn');

        const top = Math.max(0, $target.position().top + $box.scrollTop() - 90);
        $box.stop(true).animate({ scrollTop: top }, 220);
    }

    continueSession(sessionId) {
        const items = this.currentSessionMap[sessionId] || [];
        if (!items.length) return;

        const last = items[items.length - 1];

        this.navigateToQa({
            question: `继续基于这个会话展开说明：${last.question || ''}`,
            project_name: last.project_name || '',
            profile: last.profile || 'impl',
            style: last.style || 'chat',
            embed_model: last.embed_model || '',
            chat_model: last.chat_model || '',
            session_id: last.session_id || '',
        });
    }

    prevPage() {
        if (this.page > 1) this.loadHistory(this.page - 1);
    }

    nextPage() {
        this.loadHistory(this.page + 1);
    }

    async clearCurrentProject() {
        const projectName = $('#history_project_name').val() || '';
        if (!projectName) {
            CodeRagUi.toast('请先选择项目', 'error');
            return;
        }

        if (!confirm(`确认删除项目 ${projectName} 的全部历史？`)) return;

        const items = await CodeRagPhpApi.get('/php-api/history', {
            project_name: projectName,
            keyword: '',
            limit: 5000
        });

        const rows = CodeRagUi.normalizeApiListResponse(items);
        const sessionIds = Array.from(new Set(rows.map(item => item.session_id).filter(Boolean)));

        for (const sessionId of sessionIds) {
            await CodeRagPhpApi.delete(`/php-api/history/session/${encodeURIComponent(sessionId)}`);
        }

        await this.loadHistory(1);
        $('#history_page_detail').html("<div class='doc-box history-detail-scroll'><div class='mini-meta'>当前项目历史已清空</div></div>");
    }

    async clearAll() {
        if (!confirm('确认清空所有历史？')) return;
        await CodeRagPhpApi.postForm('/php-api/history/clear-all', {});
        await this.loadHistory(1);
        $('#history_page_detail').html("<div class='doc-box history-detail-scroll'><div class='mini-meta'>历史已清空</div></div>");
    }
}

window.CodeRagHistoryPage = CodeRagHistoryPage;