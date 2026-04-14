class CodeRagPhpApi {
    static get(url, query = {}) {
        const qs = $.param(query || {});
        return $.ajax({
            url: qs ? `${url}?${qs}` : url,
            method: 'GET',
            dataType: 'json'
        });
    }

    static postForm(url, data = {}) {
        return $.ajax({
            url,
            method: 'POST',
            data,
            dataType: 'json'
        });
    }

    static postJson(url, data = {}) {
        return $.ajax({
            url,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            dataType: 'json'
        });
    }

    static delete(url) {
        return $.ajax({
            url,
            method: 'DELETE',
            dataType: 'json'
        });
    }

    static async health() {
        try {
            return await this.get('/php-api/health');
        } catch (e) {
            return {
                ok: false,
                error: {
                    code: 'PHP_PROXY_HEALTH_FAILED',
                    message: String(e)
                }
            };
        }
    }

    static async tasks(query = {}) {
        try {
            return await this.get('/php-api/tasks', query);
        } catch (e) {
            return {
                ok: false,
                data: [],
                error: {
                    code: 'PHP_PROXY_TASKS_FAILED',
                    message: String(e)
                }
            };
        }
    }
}

window.CodeRagPhpApi = CodeRagPhpApi;