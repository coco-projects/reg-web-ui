class CodeRagUi {
    static escape(text) {
        return String(text || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    static toast(message, type = 'info') {
        const $box = $('#toast_box');
        if (!$box.length) return;
        const $item = $(`<div class="toast-item toast-${type}"></div>`);
        $item.text(message);
        $box.append($item);
        setTimeout(() => {
            $item.fadeOut(200, function () {
                $(this).remove();
            });
        }, 1800);
    }

    static async copyText(text) {
        try {
            const finalText = String(text || '');
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(finalText);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = finalText;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '0';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            CodeRagUi.toast('复制成功', 'success');
            return true;
        } catch (e) {
            CodeRagUi.toast('复制失败', 'error');
            return false;
        }
    }

    static markdownToHtml(markdownText) {
        if (typeof marked === 'undefined') {
            return CodeRagUi.escape(markdownText || '');
        }
        return marked.parse(markdownText || '', { breaks: true, gfm: true });
    }

    static getTheme() {
        return localStorage.getItem('code_theme') || 'code-light-mint';
    }

    static allThemeClasses() {
        return [
            'theme-code-light-mint',
            'theme-code-light-ice',
            'theme-code-light-sand',
            'theme-code-light-lavender',
            'theme-code-light-sky',
            'theme-code-dark-slate',
            'theme-code-dark-forest',
            'theme-code-dark-ocean',
            'theme-code-dark-plum',
            'theme-code-dark-charcoal'
        ];
    }

    static applyTheme(theme) {
        const finalTheme = theme || 'code-light-mint';
        document.body.classList.remove(...CodeRagUi.allThemeClasses());
        document.body.classList.add('theme-' + finalTheme);
        localStorage.setItem('code_theme', finalTheme);
        $('#code_theme_selector').val(finalTheme);
    }

    static initThemeSelector() {
        const theme = CodeRagUi.getTheme();
        CodeRagUi.applyTheme(theme);

        $('#code_theme_selector').off('change').on('change', function () {
            CodeRagUi.applyTheme($(this).val());
        });
    }

    static decorateCodeBlocks(rootEl) {
        $(rootEl).find('pre code').each(function () {
            const block = this;

            if (window.hljs) {
                try {
                    hljs.highlightElement(block);
                } catch (e) {}
            }

            const pre = block.parentElement;
            if (!pre || pre.dataset.decorated === '1') return;
            pre.dataset.decorated = '1';

            const rawCode = block.textContent || '';
            const lines = rawCode.split('\n');

            const $wrapper = $('<div class="code-block-wrap"></div>');
            const $toolbar = $('<div class="code-block-toolbar"></div>');
            const $left = $('<span>代码块</span>');
            const $actions = $('<div class="code-toolbar-actions"></div>');
            const $copyBtn = $('<button class="btn btn-sm btn-outline-secondary">复制</button>');
            const $toggleBtn = $('<button class="btn btn-sm btn-outline-secondary">收起</button>');
            const $codeArea = $('<div class="code-area"></div>');
            const $gutter = $('<div class="code-gutter"></div>').text(lines.map((_, i) => String(i + 1)).join('\n'));
            const $codePane = $('<div class="code-pane"></div>');

            $(pre).before($wrapper);
            $wrapper.append($toolbar).append($codeArea);
            $toolbar.append($left).append($actions);
            $actions.append($copyBtn).append($toggleBtn);
            $codeArea.append($gutter).append($codePane);
            $codePane.append(pre);

            $copyBtn.on('click', async function () {
                await CodeRagUi.copyText(rawCode);
            });

            $toggleBtn.on('click', function () {
                $codeArea.toggleClass('code-hidden');
                $(this).text($codeArea.hasClass('code-hidden') ? '展开' : '收起');
            });
        });
    }

    static renderMarkdown($el, text) {
        $el.html(CodeRagUi.markdownToHtml(text || ''));
        CodeRagUi.decorateCodeBlocks($el[0]);
    }

    static showHover(event, markdownOrHtml, isMarkdown = false) {
        const $pop = $('#hover_pop');
        if (isMarkdown) {
            $pop.html(CodeRagUi.markdownToHtml(markdownOrHtml || ''));
        } else {
            $pop.html(markdownOrHtml || '');
        }
        $pop.css({
            display: 'block',
            left: Math.min(window.innerWidth - 980, event.clientX + 18) + 'px',
            top: Math.min(window.innerHeight - 680, event.clientY + 18) + 'px'
        });
        CodeRagUi.decorateCodeBlocks($pop[0]);
    }

    static hideHover() {
        $('#hover_pop').hide().html('');
    }

    static openModal(title, meta, markdown) {
        $('#source_modal_title').text(title || '详情');
        $('#source_modal_meta').text(meta || '');
        CodeRagUi.renderMarkdown($('#source_modal_content'), markdown || '');
        $('#source_modal_mask').css('display', 'flex');
    }

    static closeModal() {
        $('#source_modal_mask').hide();
    }

    static formatTaskStatus(status) {
        const map = {
            queued: 'task-status-queued',
            running: 'task-status-running',
            succeeded: 'task-status-succeeded',
            failed: 'task-status-failed',
            canceled: 'task-status-canceled'
        };
        return map[status] || 'task-status-queued';
    }

    static normalizeApiListResponse(resp) {
        if (Array.isArray(resp)) return resp;
        if (Array.isArray(resp?.data)) return resp.data;
        if (Array.isArray(resp?.items)) return resp.items;
        return [];
    }

    static renderBanner(html, type = 'danger') {
        $('#global_banner_area').html(`<div class="global-banner global-banner-${type}">${html}</div>`);
    }

    static clearBanner() {
        $('#global_banner_area').html('');
    }

    static activateNav() {
        const path = window.location.pathname;
        $('.nav-links [data-nav-path]').each(function () {
            const target = $(this).data('nav-path');
            if (target === path) {
                $(this).addClass('active').attr('aria-current', 'page');
            } else {
                $(this).removeClass('active').removeAttr('aria-current');
            }
        });
    }

    static renderLogLines($el, lines) {
        const arr = Array.isArray(lines) ? lines : [];
        $el.html(arr.map(line => CodeRagUi.escape(line)).join('<br>'));
    }
}

window.CodeRagUi = CodeRagUi;