(function () {
    const files = [
        '/assets/js/core/api.js?v=4',
        '/assets/js/core/ui.js?v=4',
        '/assets/js/core/base-page.js?v=4',
        '/assets/js/pages/qa-page.js?v=4',
        '/assets/js/pages/search-page.js?v=4',
        '/assets/js/pages/admin-page.js?v=4',
        '/assets/js/pages/history-page.js?v=4',
        '/assets/js/bootstrap.js?v=4'
    ];

    function loadSequential(index) {
        if (index >= files.length) return;
        const script = document.createElement('script');
        script.src = files[index];
        script.onload = function () {
            loadSequential(index + 1);
        };
        script.onerror = function () {
            console.error('JS load failed:', files[index]);
            loadSequential(index + 1);
        };
        document.body.appendChild(script);
    }

    loadSequential(0);
})();