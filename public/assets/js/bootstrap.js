(function () {
    function boot() {
        CodeRagUi.activateNav();
        CodeRagUi.initThemeSelector();

        const path = window.location.pathname;

        if (path === '/') {
            if (typeof CodeRagQaPage !== 'undefined') {
                window.pageApp = new CodeRagQaPage();
                window.pageApp.init();
            }
        } else if (path === '/search') {
            if (typeof CodeRagSearchPage !== 'undefined') {
                window.pageApp = new CodeRagSearchPage();
                window.pageApp.init();
            }
        } else if (path === '/admin') {
            if (typeof CodeRagAdminPage !== 'undefined') {
                window.pageApp = new CodeRagAdminPage();
                window.pageApp.init();
            }
        } else if (path === '/history') {
            if (typeof CodeRagHistoryPage !== 'undefined') {
                window.pageApp = new CodeRagHistoryPage();
                window.pageApp.init();
            }
        } else if (typeof CodeRagBasePage !== 'undefined') {
            const base = new CodeRagBasePage();
            base.bindCommonEvents();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();