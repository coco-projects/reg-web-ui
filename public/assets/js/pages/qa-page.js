class CodeRagQaPage extends CodeRagBasePage {
    constructor() {
        super();
        this.currentSessionId = '';
        this.lastAnswerText = '';
        this.currentHistoryItems = [];
        this.currentHistorySessionMap = {};
        this.currentEvidenceItems = [];
        this.currentHistoryPage = 1;
        this.historyPageSize = 20;
        this.currentStream = null;
        this.renderTimer = null;
        this.pendingAnswerText = '';
        this.questionTemplates = [
            { title: '解释方法', text: '像给同事讲代码一样，详细解释 {target} 的实现机制、执行流程和关键设计点。' },
            { title: '解释类', text: '请详细解释 {target} 这个类的职责、核心属性、主要方法和使用方式。' },
            { title: '写示例', text: '请直接给出一个更贴近真实业务的 {target} 调用示例，并逐步解释每一步。' },
            { title: '解释依赖', text: '请解释 {target} 是什么，它在这个项目里起什么作用？' },
            { title: '讲执行流程', text: '请按执行流程拆解 {target}，说明输入、分支、依赖调用和最终输出。' }
        ];
    }

    async init() {
        CodeRagUi.activateNav();
        this.bindCommonEvents();
        this.bindEvents();
        this.renderTemplates();
        await this.loadModelDefaults();
        this.loadQuestionFromUrl();
        this.updateSessionIndicator();
        await this.checkGlobalHealth($('#project_name').val() || '');
        await this.loadHistory(1);
        await this.restoreSessionFromUrlIfNeeded();
    }

    bindEvents() {
        const self = this;

        $(document).on('click', '[data-action="fill-question-example"]', function () {
            $('#question').val('像给同事讲代码一样，详细解释 SqlCache::autoCache 的实现机制、执行流程和关键设计点。');
        });

        $(document).on('click', '[data-action="ask-question-new-session"]', function () {
            self.askQuestion(true);
        });

        $(document).on('click', '[data-action="ask-question-current-session"]', function () {
            self.askQuestion(false);
        });

        $(document).on('click', '[data-action="search-history"]', function () {
            self.loadHistory(1);
        });

        $(document).on('click', '[data-action="history-prev"]', function () {
            self.prevHistoryPage();
        });

        $(document).on('click', '[data-action="history-next"]', function () {
            self.nextHistoryPage();
        });

        $(document).on('click', '[data-action="clear-all-history"]', function () {
            self.clearAllHistory();
        });

        $(document).on('click', '[data-action="start-new-session"]', function () {
            self.startNewSession();
        });

        $(document).on('click', '[data-action="copy-answer"]', function () {
            self.copyAnswer();
        });

        $(document).on('click', '[data-action="continue-followup"]', function () {
            self.continueFollowup();
        });

        $('#project_name').on('change', async function () {
            await self.checkGlobalHealth($(this).val() || '');
            await self.loadHistory(1);
        });

        $('#question').on('keydown', function (e) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                self.askQuestion(false);
            }
        });
    }

    async loadModelDefaults() {
        try {
            const data = await CodeRagPhpApi.get('/php-api/models', {});
            const modelData = data.data || {};

            if (typeof modelData.default_temperature !== 'undefined') {
                $('#temperature').val(modelData.default_temperature);
            }
            if (typeof modelData.default_top_p !== 'undefined') {
                $('#top_p').val(modelData.default_top_p);
            }
            if (typeof modelData.default_max_tokens !== 'undefined') {
                $('#max_tokens').val(modelData.default_max_tokens);
            }
            if (typeof modelData.default_stream !== 'undefined') {
                $('#stream_enabled').val(modelData.default_stream ? '1' : '0');
            }
            if (typeof modelData.session_context_limit !== 'undefined') {
                $('#session_context_limit_ui').val(modelData.session_context_limit);
            }
            if (typeof modelData.session_answer_char_limit !== 'undefined') {
                $('#session_answer_char_limit_ui').val(modelData.session_answer_char_limit);
            }
        } catch (e) {}
    }

    setLoading(active) {
        $('#answer_loading,#answer_loading_2').toggleClass('active', !!active);
    }

    updateSessionIndicator() {
        $('#current_session_id').text(this.currentSessionId || '（新会话）');
    }

    startNewSession() {
        this.currentSessionId = '';
        this.updateSessionIndicator();
        CodeRagUi.toast('已切换到新会话', 'success');
    }

    getKinds() {
        return $('#kinds_group').find('input:checked').map(function () {
            return $(this).val();
        }).get().join(',');
    }

    renderTemplates() {
        $('#templates').html(this.questionTemplates.map(tpl => `
            <div class="template-item" data-template="${encodeURIComponent(JSON.stringify(tpl))}">
              <div class="history-title">${CodeRagUi.escape(tpl.title)}</div>
              <div class="mini-meta">${CodeRagUi.escape(tpl.text)}</div>
            </div>
        `).join(''));

        $('#templates .template-item').off('click').on('click', function () {
            const tpl = JSON.parse(decodeURIComponent($(this).data('template')));
            $('#question').val(tpl.text.replaceAll('{target}', 'SqlCache::autoCache'));
        });
    }

    loadQuestionFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const q = params.get('question');
        const projectName = params.get('project_name');
        const profile = params.get('profile');
        const style = params.get('style');
        const embedModel = params.get('embed_model');
        const chatModel = params.get('chat_model');
        const sessionId = params.get('session_id');

        if (q) $('#question').val(q);
        if (projectName) $('#project_name').val(projectName);
        if (profile) $('#profile').val(profile);
        if (style) $('#style').val(style);
        if (embedModel) $('#embed_model').val(embedModel);
        if (chatModel) $('#chat_model').val(chatModel);
        if (sessionId) {
            this.currentSessionId = sessionId;
            this.updateSessionIndicator();
        }
    }

    async restoreSessionFromUrlIfNeeded() {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('session_id');
        if (!sessionId) return;

        const items = this.currentHistorySessionMap[sessionId] || [];
        if (!items.length) return;

        const last = items[items.length - 1];
        const index = this.currentHistoryItems.findIndex(x => x.id === last.id);
        if (index >= 0) {
            this.restoreHistoryByIndex(index);
            this.currentSessionId = sessionId;
            this.updateSessionIndicator();
        }
    }

    appendStatus(message) {
        const $box = $('#status');
        const time = new Date().toLocaleTimeString();
        $box.append($('<div>').text(`- [${time}] ${message}`));
        $box.scrollTop($box[0].scrollHeight);
    }

    renderStatusLines(lines) {
        $('#status').html('');
        (Array.isArray(lines) ? lines : []).forEach(line => this.appendStatus(line));
    }

    scheduleAnswerRender(force = false) {
        if (force) {
            if (this.renderTimer) {
                clearTimeout(this.renderTimer);
                this.renderTimer = null;
            }
            CodeRagUi.renderMarkdown($('#answer'), this.pendingAnswerText || '');
            $('#answer').scrollTop($('#answer')[0].scrollHeight);
            return;
        }

        if (this.renderTimer) return;

        this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            CodeRagUi.renderMarkdown($('#answer'), this.pendingAnswerText || '');
            $('#answer').scrollTop($('#answer')[0].scrollHeight);
        }, 120);
    }

    buildHistorySessionMap(items) {
        const groups = {};
        items.forEach(item => {
            const sid = item.session_id || 'no-session';
            if (!groups[sid]) groups[sid] = [];
            groups[sid].push(item);
        });

        Object.keys(groups).forEach(sid => {
            groups[sid].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
        });

        this.currentHistorySessionMap = groups;
    }

    renderSessionHistory(sessionIds, start, totalPages) {
        $('#history').html(sessionIds.map((sid, idx) => {
            const items = this.currentHistorySessionMap[sid] || [];
            const first = items[0] || {};
            const favorite = items.some(x => !!x.is_favorite);
            const created = first.created_at ? new Date(first.created_at * 1000).toLocaleString() : '-';
            const question = first.question || '(空问题)';
            const children = items.map((item) => {
                const globalIndex = this.currentHistoryItems.findIndex(x => x.id === item.id);
                return `
                    <div class="session-child-item" data-history-index="${globalIndex}">
                      <div class="history-title">${CodeRagUi.escape(item.question || '')}</div>
                      <div class="mini-meta">${item.created_at ? new Date(item.created_at * 1000).toLocaleString() : '-'} | ${item.profile || '-'} | ${item.style || '-'} | ${item.embed_model || '-'} | ${item.chat_model || '-'}</div>
                    </div>
                `;
            }).join('');

            return `
                <div class="session-group-item" data-session-id="${sid}">
                  <div class="session-group-head">
                    <div class="session-group-main">
                      <div class="actions-row mb-1">
                        <button class="btn btn-sm btn-outline-secondary" data-session-continue="${sid}">继续</button>
                        <button class="btn btn-sm btn-outline-secondary" data-session-detail="${sid}">详情</button>
                        <button class="btn btn-sm ${favorite ? 'btn-warning' : 'btn-outline-secondary'}" data-session-favorite="${sid}">${favorite ? '取消收藏' : '收藏'}</button>
                        <button class="btn btn-sm btn-danger" data-session-delete="${sid}">删除</button>
                      </div>
                      <div class="session-group-title-wrap">
                        <div class="session-group-title">Session ${start + idx + 1} · ${CodeRagUi.escape(question)}</div>
                        <button class="btn btn-sm btn-outline-secondary" data-session-toggle="${sid}">折叠</button>
                      </div>
                      <div class="mini-meta">${created} | ${first.project_name || '-'} | ${first.profile || '-'} | ${first.style || '-'} | ${first.embed_model || '-'} | ${first.chat_model || '-'} | ${items.length} 条对话 | <span class="${favorite ? 'favorite-on' : 'favorite-off'}">${favorite ? '★ 已收藏' : '☆ 未收藏'}</span></div>
                    </div>
                  </div>
                  <div class="session-children" id="session_children_${sid}">${children}</div>
                </div>
            `;
        }).join(''));

        this.bindSessionHistoryEvents();
        $('#history_pager_info').text(`第 ${this.currentHistoryPage} / ${totalPages} 页`);
    }

    bindSessionHistoryEvents() {
        const self = this;

        $('[data-session-toggle]').off('click').on('click', function (e) {
            e.stopPropagation();
            const sid = $(this).data('session-toggle');
            const $children = $('#session_children_' + sid);
            $children.toggleClass('collapsed');
            $(this).text($children.hasClass('collapsed') ? '展开' : '折叠');
        });

        $('.session-child-item').off('mouseenter').on('mouseenter', function (e) {
            const index = parseInt($(this).data('history-index'), 10);
            const item = self.currentHistoryItems[index];
            if (!item) return;
            const md = `### 问题\n\n${item.question || ''}\n\n### 回答预览\n\n${(item.answer || '').slice(0, 800)}`;
            CodeRagUi.showHover(e, md, true);
        }).off('mouseleave').on('mouseleave', function () {
            CodeRagUi.hideHover();
        }).off('click').on('click', function (e) {
            e.stopPropagation();
            const index = parseInt($(this).data('history-index'), 10);
            self.restoreHistoryByIndex(index);
        });

        $('.session-group-item').off('click').on('click', function (e) {
            if ($(e.target).closest('button').length || $(e.target).closest('.session-child-item').length) return;
            self.restoreSessionLatest($(this).data('session-id'));
        });

        $('[data-session-continue]').off('click').on('click', function (e) {
            e.stopPropagation();
            self.continueFromSession($(this).data('session-continue'));
        });

        $('[data-session-detail]').off('click').on('click', function (e) {
            e.stopPropagation();
            self.showSessionDialog($(this).data('session-detail'));
        });

        $('[data-session-favorite]').off('click').on('click', function (e) {
            e.stopPropagation();
            self.toggleSessionFavorite($(this).data('session-favorite'));
        });

        $('[data-session-delete]').off('click').on('click', function (e) {
            e.stopPropagation();
            self.deleteSession($(this).data('session-delete'));
        });
    }

    async loadHistory(page = 1) {
        this.currentHistoryPage = page;
        $('#history').html("<div class='mini-meta'>加载中...</div>");

        try {
            const data = await CodeRagPhpApi.get('/php-api/history', {
                project_name: $('#project_name').val() || '',
                keyword: $('#history_keyword').val() || '',
                limit: 200
            });

            this.currentHistoryItems = CodeRagUi.normalizeApiListResponse(data).filter(item => item && item.id);
            this.buildHistorySessionMap(this.currentHistoryItems);

            const sessionIds = Object.keys(this.currentHistorySessionMap).sort((a, b) => {
                const aItems = this.currentHistorySessionMap[a] || [];
                const bItems = this.currentHistorySessionMap[b] || [];
                const aTime = aItems[aItems.length - 1]?.created_at || 0;
                const bTime = bItems[bItems.length - 1]?.created_at || 0;
                return bTime - aTime;
            });

            if (!sessionIds.length) {
                $('#history').html("<div class='mini-meta'>暂无历史记录</div>");
                $('#history_pager_info').text('第 1 / 1 页');
                $('#history_prev_btn').prop('disabled', true);
                $('#history_next_btn').prop('disabled', true);
                return;
            }

            const totalPages = Math.max(1, Math.ceil(sessionIds.length / this.historyPageSize));
            if (this.currentHistoryPage > totalPages) this.currentHistoryPage = totalPages;
            const start = (this.currentHistoryPage - 1) * this.historyPageSize;
            const pageSessionIds = sessionIds.slice(start, start + this.historyPageSize);

            this.renderSessionHistory(pageSessionIds, start, totalPages);
            $('#history_prev_btn').prop('disabled', this.currentHistoryPage <= 1);
            $('#history_next_btn').prop('disabled', this.currentHistoryPage >= totalPages);
        } catch (e) {
            $('#history').html("<div class='mini-meta'>加载历史失败</div>");
        }
    }

    prevHistoryPage() {
        if (this.currentHistoryPage > 1) this.loadHistory(this.currentHistoryPage - 1);
    }

    nextHistoryPage() {
        this.loadHistory(this.currentHistoryPage + 1);
    }

    restoreHistoryByIndex(index) {
        const item = this.currentHistoryItems[index];
        if (!item) return;

        this.currentSessionId = item.session_id || '';
        this.updateSessionIndicator();

        $('#question').val(item.question || '');
        $('#project_name').val(item.project_name || '');
        $('#profile').val(item.profile || 'impl');
        $('#style').val(item.style || 'chat');
        $('#embed_model').val(item.embed_model || $('#embed_model').val());
        $('#chat_model').val(item.chat_model || $('#chat_model').val());

        this.lastAnswerText = item.answer || '';
        this.pendingAnswerText = item.answer || '';
        this.scheduleAnswerRender(true);

        $('#answer_meta').text(`session=${item.session_id || '-'} | embed=${item.embed_model || '-'} | chat=${item.chat_model || '-'} | ${(item.meta || {}).elapsed_ms || 0} ms`);

        this.renderEvidenceList(item.evidences || []);

        const logs = Array.isArray(item.meta?.logs) ? item.meta.logs : [];
        this.renderStatusLines(logs);

        CodeRagUi.toast('已恢复历史回答', 'success');
    }

    restoreSessionLatest(sessionId) {
        const items = this.currentHistorySessionMap[sessionId] || [];
        if (!items.length) return;
        this.restoreHistoryByIndex(this.currentHistoryItems.findIndex(x => x.id === items[items.length - 1].id));
    }

    continueFromSession(sessionId) {
        const items = this.currentHistorySessionMap[sessionId] || [];
        if (!items.length) return;
        const last = items[items.length - 1];
        this.currentSessionId = sessionId;
        this.updateSessionIndicator();
        $('#question').val(`继续基于这个会话展开说明：${last.question || ''}`).focus();
        $('#project_name').val(last.project_name || $('#project_name').val());
        $('#embed_model').val(last.embed_model || $('#embed_model').val());
        $('#chat_model').val(last.chat_model || $('#chat_model').val());
        $('#profile').val(last.profile || $('#profile').val());
        $('#style').val(last.style || $('#style').val());
    }

    showSessionDialog(sessionId) {
        const items = this.currentHistorySessionMap[sessionId] || [];
        if (!items.length) return;

        let md = `### Session: ${sessionId}\n\n`;
        items.forEach((it, i) => {
            md += `#### Q${i + 1}\n\n${it.question || ''}\n\n${it.answer || ''}\n\n`;
        });

        CodeRagUi.openModal('会话详情', `session=${sessionId} | ${items.length} 条对话`, md);
    }

    async toggleSessionFavorite(sessionId) {
        await CodeRagPhpApi.postForm(`/php-api/history/session/${encodeURIComponent(sessionId)}/favorite`, {});
        CodeRagUi.toast('整个会话收藏状态已切换', 'success');
        await this.loadHistory(this.currentHistoryPage);
    }

    async deleteSession(sessionId) {
        if (!confirm('确认删除整个会话？')) return;
        await CodeRagPhpApi.delete(`/php-api/history/session/${encodeURIComponent(sessionId)}`);
        CodeRagUi.toast('会话已删除', 'success');
        await this.loadHistory(this.currentHistoryPage);
    }

    async clearAllHistory() {
        if (!confirm('确认清空所有历史？')) return;
        await CodeRagPhpApi.postForm('/php-api/history/clear-all', {});
        await this.loadHistory(1);
    }

    continueFollowup() {
        $('#question').val('继续基于上一条回答展开说明，并补充更具体的实现细节。').focus();
    }

    async copyAnswer() {
        await CodeRagUi.copyText(this.lastAnswerText || $('#answer').text() || '');
    }

    renderEvidenceList(evidences) {
        this.currentEvidenceItems = Array.isArray(evidences) ? evidences : [];
        $('#evidence').html(!this.currentEvidenceItems.length ? "<div class='mini-meta'>没有 evidence</div>" : this.currentEvidenceItems.map((item, idx) => `
            <div class="evidence-item" data-evidence-index="${idx}">
              <div class="evidence-title">[${idx + 1}] ${CodeRagUi.escape(item.title || '')}</div>
              <div class="mini-meta">${CodeRagUi.escape(item.relative_path || '')}</div>
            </div>
        `).join(''));

        const self = this;
        $('#evidence .evidence-item').each(function () {
            const index = parseInt($(this).data('evidence-index'), 10);

            $(this).on('mouseenter', function () {
                const item = self.currentEvidenceItems[index];
                if (!item) return;

                const safeContent = String(item.content || '')
                    .split('\n')
                    .filter(line => !/^\s*code\s*:/i.test(line))
                    .join('\n');

                const md = `### ${item.title || ''}

- **source_type**: ${item.source_type || ''}
- **target**: \`${item.target_fqname || ''}\`
- **file**: \`${item.relative_path || ''}\`

${safeContent}`;
                CodeRagUi.renderMarkdown($('#evidence_detail'), md);
            }).on('click', async function () {
                const item = self.currentEvidenceItems[index];
                if (!item) return;
                if (item.relative_path) {
                    const projectName = $('#project_name').val();
                    await self.openSourceModalByPath(projectName, item.relative_path, 1, 180);
                }
            });
        });
    }

    async askQuestion(forceNewSession = false) {
        const projectName = $('#project_name').val();
        const question = $('#question').val();

        if (!projectName || !question) {
            CodeRagUi.toast('请先选择项目并输入问题', 'error');
            return;
        }

        const ok = await this.checkGlobalHealth(projectName);
        if (!ok) return;

        if (forceNewSession) {
            this.currentSessionId = '';
            this.updateSessionIndicator();
        }

        if (this.currentStream) {
            try {
                this.currentStream.close();
            } catch (e) {}
            this.currentStream = null;
        }

        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }

        this.setLoading(true);
        $('#answer_loading .text, #answer_loading_2 .text').text('生成中...');
        this.lastAnswerText = '';
        this.pendingAnswerText = '';
        $('#answer').html('');
        $('#evidence').html("<div class='mini-meta'>等待 evidence...</div>");
        $('#evidence_detail').html("<div class='mini-meta'>点击左侧 evidence 查看详情</div>");
        $('#status').html('');
        $('#answer_meta').html('');

        const query = {
            project_name: projectName,
            question: question,
            profile: $('#profile').val() || 'impl',
            style: $('#style').val() || 'chat',
            kinds: this.getKinds(),
            path_prefix: $('#path_prefix').val() || '',
            namespace_prefix: $('#namespace_prefix').val() || '',
            visibility: $('#visibility').val() || '',
            limit: $('#limit').val() || '5',
            debug: $('#debug').val() || '0',
            embed_model: $('#embed_model').val() || '',
            chat_model: $('#chat_model').val() || '',
            session_id: this.currentSessionId || '',
            temperature: $('#temperature').val() || '0.1',
            top_p: $('#top_p').val() || '1',
            max_tokens: $('#max_tokens').val() || '0'
        };

        const self = this;

        if (($('#stream_enabled').val() || '1') === '0') {
            try {
                const resp = await CodeRagPhpApi.postForm('/php-api/answer', query);
                const data = resp.data || {};
                const meta = resp.meta || {};

                this.pendingAnswerText = data.answer || '';
                this.lastAnswerText = data.answer || '';
                this.scheduleAnswerRender(true);

                this.currentSessionId = data.session_id || this.currentSessionId;
                this.updateSessionIndicator();

                this.renderEvidenceList(data.evidences || []);
                $('#answer_meta').text(`session=${this.currentSessionId || '-'} | embed=${meta.embed_model || '-'} | chat=${meta.chat_model || '-'} | ${meta.elapsed_ms || 0} ms`);

                const logs = Array.isArray(data.logs) ? data.logs : [];
                this.renderStatusLines(logs);
                this.appendStatus('回答完成');

                this.setLoading(false);
                await this.loadHistory(1);
                return;
            } catch (e) {
                this.appendStatus('非流式请求失败');
                this.setLoading(false);
                return;
            }
        }

        const es = new EventSource('/php-api/answer-stream-proxy?' + $.param(query));
        this.currentStream = es;

        es.onmessage = function (event) {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'status') {
                    const msg = data.content || '';
                    self.appendStatus(msg);
                } else if (data.type === 'chunk') {
                    self.pendingAnswerText += (data.content || '');
                    self.lastAnswerText = self.pendingAnswerText;
                    self.scheduleAnswerRender(false);
                } else if (data.type === 'done') {
                    const content = data.content || {};
                    self.currentSessionId = content.session_id || self.currentSessionId;
                    self.updateSessionIndicator();
                    self.renderEvidenceList(content.evidences || []);
                    const meta = content.meta || {};
                    self.scheduleAnswerRender(true);
                    $('#answer_meta').text(`session=${self.currentSessionId || '-'} | embed=${meta.embed_model || '-'} | chat=${meta.chat_model || '-'} | ${meta.elapsed_ms || 0} ms`);
                    self.appendStatus('回答完成');
                    $('#answer_loading .text, #answer_loading_2 .text').text('生成中...');
                    self.setLoading(false);
                    self.currentStream = null;
                    es.close();
                    setTimeout(() => self.loadHistory(1), 150);
                } else if (data.type === 'error') {
                    const content = data.content || {};
                    const message = typeof content === 'string'
                        ? content
                        : (content.message || '流式错误');

                    if (content.session_id) {
                        self.currentSessionId = content.session_id;
                        self.updateSessionIndicator();
                    }

                    self.appendStatus(message);
                    $('#answer_loading .text, #answer_loading_2 .text').text('生成中...');
                    self.setLoading(false);
                    self.currentStream = null;
                    es.close();

                    self.scheduleAnswerRender(true);
                    setTimeout(() => self.loadHistory(1), 150);

                    CodeRagUi.toast(message, 'error');
                }
            } catch (e) {
                self.appendStatus('前端解析流式数据失败');
                $('#answer_loading .text, #answer_loading_2 .text').text('生成中...');
                self.setLoading(false);
                self.currentStream = null;
                es.close();

                setTimeout(() => self.loadHistory(1), 150);

                CodeRagUi.toast('前端解析流式数据失败', 'error');
            }
        };

        es.onerror = function () {
            self.appendStatus('流式连接中断');
            $('#answer_loading .text, #answer_loading_2 .text').text('生成中...');
            self.setLoading(false);
            self.currentStream = null;
            es.close();
        };
    }
}

window.CodeRagQaPage = CodeRagQaPage;