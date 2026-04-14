class CodeRagAdminPage extends CodeRagBasePage
{


    constructor()
    {
        super();
        this.currentTasks  = [];
        this.currentTaskId = "";
        this.taskStream    = null;

        this.logLines      = [];
        this.logAutoScroll = true;

        this.initialRenderTailCount = 300;
        this.initialRenderChunkSize = 40;
        this.initialRenderDelayMs   = 12;
        this.logAppendBuffer        = [];
        this.logAppendFlushTimer    = null;
        this.isHydratingLogs        = false;

        this.progressState = {
            extraction   : null,
            symbol_index : null,
            summaries    : null,
            summary_index: null
        };
    }

    async init()
    {
        CodeRagUi.activateNav();
        this.bindCommonEvents();
        this.bindEvents();
        this.bindLogScrollMonitor();
        this.renderProgressPanel();
        this.startHealthPolling($("#admin_project_name").val() || "");
        await this.loadTasks();
    }

    bindEvents()
    {
        $(document).on("click", "[data-action=\"admin-task-full\"]", () => this.submitTask("pipeline_full"));
        $(document).on("click", "[data-action=\"admin-task-incremental\"]", () => this.submitTask("pipeline_incremental"));
        $(document).on("click", "[data-action=\"admin-task-reset\"]", () => this.submitTask("reset_project"));

        $("#admin_project_name").on("change", () => {
            this.startHealthPolling($("#admin_project_name").val() || "");
            this.loadTasks();
        });
    }

    bindLogScrollMonitor()
    {
        const self = this;
        $("#admin_progress").off("scroll").on("scroll", function () {
            const el               = this;
            const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            self.logAutoScroll     = distanceToBottom < 40;
        });
    }

    setLoading(active)
    {
        $("#admin_loading").toggleClass("active", !!active);
    }

    resetProgressState()
    {
        this.progressState = {
            extraction   : null,
            symbol_index : null,
            summaries    : null,
            summary_index: null
        };
        this.renderProgressPanel();
    }

    buildProgressCard(stageKey, title)
    {
        const item = this.progressState[stageKey];

        if (!item)
        {
            return `
            <div class="task-progress-card">
                <div class="task-progress-title">${title}</div>
                <div class="mini-meta">尚无进度</div>
            </div>
        `;
        }

        const current = Number(item.current || 0);
        const total   = Math.max(1, Number(item.total || 0));
        const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));

        return `
        <div class="task-progress-card">
            <div class="task-progress-head">
                <div class="task-progress-title">${title}</div>
                <div class="task-progress-value">${current}/${total} · ${percent}%</div>
            </div>
            <div class="task-progress-bar">
                <div class="task-progress-bar-inner" style="width:${percent}%"></div>
            </div>
            <div class="mini-meta">${CodeRagUi.escape(item.message || "")}</div>
        </div>
    `;
    }

    renderProgressPanel()
    {
        $("#admin_task_progress_panel").html(`
        <div class="task-progress-grid">
            ${this.buildProgressCard("extraction", "抽取")}
            ${this.buildProgressCard("symbol_index", "Symbol 索引")}
            ${this.buildProgressCard("summaries", "Summaries")}
            ${this.buildProgressCard("summary_index", "Summary 索引")}
        </div>
    `);
    }

    getSubmitSuccessMessage(taskType, reusedReason)
    {
        if (!reusedReason)
        {
            if (taskType === "reset_project") return "清空任务已提交";
            if (taskType === "pipeline_incremental") return "增量任务已提交";
            return "全量任务已提交";
        }

        if (reusedReason === "existing_full_task")
        {
            return "当前项目已有全量任务，已复用该任务";
        }
        if (reusedReason === "existing_incremental_task")
        {
            return "当前项目已有增量任务，已复用该任务";
        }
        if (reusedReason === "existing_reset_task")
        {
            return "当前项目已有清空任务，已复用该任务";
        }

        return "已复用当前项目已有任务";
    }

    async submitTask(taskType)
    {
        const projectName = $("#admin_project_name").val();
        if (!projectName)
        {
            CodeRagUi.toast("请先选择项目", "error");
            return;
        }

        const ok = await this.checkGlobalHealth(projectName);
        if (!ok) return;

        if (
            taskType === "reset_project" &&
            !confirm("确认清空当前项目的索引、辅助索引、summary、输出文件、增量状态和任务记录？不会删除历史问答记录，历史请到“历史”页单独删除。")
        ) return;

        const payload = {
            task_type   : taskType,
            project_name: projectName,
            debug       : $("#admin_debug").val() === "1",
            embed_model : $("#admin_embed_model").val() || "",
            chat_model  : $("#admin_chat_model").val() || ""
        };

        if (taskType !== "reset_project")
        {
            payload.mode        = $("#admin_mode").val() || "api";
            payload.incremental = taskType === "pipeline_incremental";
        }

        this.setLoading(true);
        this.resetLogState();
        $("#admin_result").html("<div class='mini-meta'>任务提交中...</div>");

        try
        {
            const res          = await CodeRagPhpApi.postJson("/php-api/tasks", payload);
            const data         = res.data || {};
            const task         = data.task || {};
            const taskId       = data.task_id || task.task_id;
            const reused       = !!data.reused;
            const reusedReason = data.reused_reason || null;

            if (!taskId)
            {
                this.setLoading(false);
                $("#admin_result").html(`<div class="mini-meta">${CodeRagUi.escape((res.error || {}).message || "任务提交失败")}</div>`);
                return;
            }

            this.currentTaskId = taskId;

            CodeRagUi.toast(this.getSubmitSuccessMessage(taskType, reusedReason), reused ? "info" : "success");

            if (reused)
            {
                $("#admin_result").html(`
                    <div><strong>${CodeRagUi.escape(taskId)}</strong></div>
                    <div class="mini-meta mt-1">当前项目已有任务，已复用现有任务</div>
                    <div class="mini-meta mt-1">reused_reason=${CodeRagUi.escape(reusedReason || "-")}</div>
                `);
            }

            await this.loadTasks();
            await this.watchTask(taskId);
        } catch (e)
        {
            this.setLoading(false);
            $("#admin_result").html("<div class='mini-meta'>任务提交失败</div>");
        }
    }

    resetLogState()
    {
        this.logLines        = [];
        this.logAppendBuffer = [];
        this.isHydratingLogs = false;

        if (this.logAppendFlushTimer)
        {
            clearTimeout(this.logAppendFlushTimer);
            this.logAppendFlushTimer = null;
        }

        $("#admin_progress").text("");
        this.logAutoScroll = true;
        this.resetProgressState();
    }

    renderTaskList()
    {
        $("#task_list").html(this.currentTasks.length ? this.currentTasks.map(task => `
            <div class="task-item" data-task-id="${task.task_id}">
              <div class="task-title">${CodeRagUi.escape(task.task_id || "")}</div>
              <div class="mini-meta">
                ${CodeRagUi.escape(task.task_type || "")} |
                ${CodeRagUi.escape(task.project_name || "")} |
                <span class="task-status-pill ${CodeRagUi.formatTaskStatus(task.status)}">${CodeRagUi.escape(task.status || "")}</span>
              </div>
              <div class="mini-meta">stage=${CodeRagUi.escape(task.progress_stage || "-")} | ${task.progress_percent || 0}%</div>
              <div class="mini-meta">message=${CodeRagUi.escape(task.message || "-")}</div>
            </div>
        `).join("") : "<div class='mini-meta'>暂无任务</div>");

        const self = this;
        $("#task_list .task-item").off("click").on("click", function () {
            self.watchTask($(this).data("task-id"));
        });
    }

    async loadTasks()
    {
        try
        {
            const res = await CodeRagPhpApi.get("/php-api/tasks", {
                project_name: $("#admin_project_name").val() || "",
                limit       : 20
            });

            this.currentTasks = CodeRagUi.normalizeApiListResponse(res).filter(item => {
                return [
                    "queued",
                    "running",
                    "failed",
                    "succeeded",
                    "canceled"
                ].includes(item.status);
            });

            this.renderTaskList();
        } catch (e)
        {
            $("#task_list").html("<div class='mini-meta'>加载任务失败</div>");
        }
    }

    renderImmediateLogTail(lines)
    {
        const $box = $("#admin_progress");
        const text = lines.length ? lines.join("\n") + "\n" : "";
        $box.text(text);

        if (this.logAutoScroll && $box[0])
        {
            requestAnimationFrame(() => {
                $box.scrollTop($box[0].scrollHeight);
            });
        }
    }

    async hydrateOldLogsGradually(allLines)
    {
        this.isHydratingLogs = true;

        const total       = allLines.length;
        const tailCount   = Math.min(this.initialRenderTailCount, total);
        const remainCount = Math.max(0, total - tailCount);

        if (tailCount > 0)
        {
            const tailLines = allLines.slice(total - tailCount);
            this.renderImmediateLogTail(tailLines);
        }
        else
        {
            $("#admin_progress").text("");
        }

        if (remainCount <= 0)
        {
            this.isHydratingLogs = false;
            return;
        }

        const $box = $("#admin_progress");
        let built  = `已先加载最近 ${tailCount} 行日志，正在补齐更早日志 0/${remainCount} ...\n\n`;
        $box.text(built + $box.text());

        let rendered = 0;
        while (rendered < remainCount)
        {
            const next      = Math.min(rendered + this.initialRenderChunkSize, remainCount);
            const chunkText = allLines.slice(rendered, next).join("\n") + "\n";
            const current   = $box.text();
            const tailText  = current.replace(/^已先加载最近 .*?\n\n/s, "");
            built           = `已先加载最近 ${tailCount} 行日志，正在补齐更早日志 ${next}/${remainCount} ...\n\n`;
            $box.text(built + chunkText + tailText);
            rendered = next;
            await new Promise(resolve => setTimeout(resolve, this.initialRenderDelayMs));
        }

        $box.text(allLines.join("\n") + "\n");
        this.isHydratingLogs = false;

        if (this.logAutoScroll && $box[0])
        {
            requestAnimationFrame(() => {
                $box.scrollTop($box[0].scrollHeight);
            });
        }
    }

    flushAppendBuffer()
    {
        if (!this.logAppendBuffer.length)
        {
            this.logAppendFlushTimer = null;
            return;
        }

        const $box           = $("#admin_progress");
        const el             = $box[0];
        const chunkText      = this.logAppendBuffer.join("\n") + "\n";
        this.logAppendBuffer = [];
        $box.text($box.text() + chunkText);

        if (this.logAutoScroll && el)
        {
            requestAnimationFrame(() => {
                $box.scrollTop(el.scrollHeight);
            });
        }

        this.logAppendFlushTimer = null;
    }

    queueAppendLog(line)
    {
        this.logAppendBuffer.push(line);
        if (this.logAppendFlushTimer) return;

        this.logAppendFlushTimer = setTimeout(() => {
            this.flushAppendBuffer();
        }, 16);
    }

    async watchTask(taskId)
    {
        this.currentTaskId = taskId;
        this.resetLogState();
        $("#admin_result").html(`<div class="mini-meta">正在订阅任务 ${CodeRagUi.escape(taskId)} ...</div>`);
        $("#admin_progress").text("日志加载中...\n");
        this.setLoading(true);

        if (this.taskStream)
        {
            try
            {
                this.taskStream.close();
            } catch (e)
            {
            }
            this.taskStream = null;
        }

        try
        {
            const taskResp = await CodeRagPhpApi.get(`/php-api/tasks/${encodeURIComponent(taskId)}`, {});
            if (taskResp.data)
            {
                this.renderTaskStatus(taskResp.data);
            }

            const logsResp = await CodeRagPhpApi.get(`/php-api/tasks/${encodeURIComponent(taskId)}/logs`, {});
            const logs     = CodeRagUi.normalizeApiListResponse(logsResp);

            this.logLines = logs.map(log => `[${log.ts || ""}] [${log.level || ""}] [${log.stage || ""}] ${log.message || ""}`);
            await this.hydrateOldLogsGradually(this.logLines);
        } catch (e)
        {
            $("#admin_progress").text("加载任务日志失败\n");
        }

        const es        = new EventSource(`/php-api/tasks/${encodeURIComponent(taskId)}/stream-proxy?s=${Date.now()}`);
        this.taskStream = es;
        const self      = this;

        es.onmessage = function (event) {
            try
            {
                const data = JSON.parse(event.data);

                if (data.type === "heartbeat")
                {
                    return;
                }
                else if (data.type === "log")
                {
                    const log = data.content || data;
                    self.appendTaskLog(log);
                }
                else if (data.type === "status")
                {
                    self.renderTaskStatus(data.content || {});
                    self.loadTasks();
                }
                else if (data.type === "progress")
                {
                    const c = data.content || data;
                    const stage = c.stage || "task";
                    const current = Number(c.current || 0);
                    const total = Math.max(1, Number(c.total || 0));
                    const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));

                    self.progressState[stage] = {
                        current: current,
                        total  : total,
                        message: c.message || ""
                    };
                    self.renderProgressPanel();

                    $("#admin_result").html(`
                        <div><strong>执行中</strong></div>
                        <div class="mini-meta mt-1">stage=${CodeRagUi.escape(stage)} | current=${current} | total=${total} | percent=${percent}%</div>
                    `);
                }
                else if (data.type === "done")
                {
                    const content = data.content || data;
                    self.renderTaskStatus(content);
                    self.setLoading(false);
                    self.taskStream = null;
                    es.close();
                    setTimeout(async function () {
                        await self.loadTasks();
                    }, 300);
                }
                else if (data.type === "error")
                {
                    const content = data.content || {};
                    const message = typeof content === "string"
                        ? content
                        : (content.message || "任务流异常");

                    self.queueAppendLog(`[ERROR] ${message}`);
                    self.setLoading(false);
                    self.taskStream = null;
                    es.close();
                }
            } catch (e)
            {
                self.queueAppendLog("[ERROR] 前端解析任务流失败");
                self.setLoading(false);
                self.taskStream = null;
                es.close();
            }
        };

        es.onerror = function () {
            self.queueAppendLog("[WARN] 任务流连接中断");
            self.setLoading(false);
            self.taskStream = null;
            es.close();
        };
    }

    appendTaskLog(log)
    {
        const line = `[${log.ts || ""}] [${log.level || "info"}] [${log.stage || "task"}] ${log.message || ""}`;
        this.logLines.push(line);
        this.queueAppendLog(line);
    }
    renderTaskStatus(task)
    {
        $("#admin_result").html(`
            <div><strong>${CodeRagUi.escape(task.task_id || "")}</strong></div>
            <div class="mini-meta mt-1">type=${CodeRagUi.escape(task.task_type || "")} | status=${CodeRagUi.escape(task.status || "")}</div>
            <div class="mini-meta mt-1">stage=${CodeRagUi.escape(task.progress_stage || "-")} | current=${task.progress_current || 0} | total=${task.progress_total || 0} | percent=${task.progress_percent || 0}%</div>
            <div class="mini-meta mt-1">message=${CodeRagUi.escape(task.message || "-")}</div>
            <div class="mini-meta mt-1">error=${CodeRagUi.escape(task.error_message || "-")}</div>
        `);
    }
}

window.CodeRagAdminPage = CodeRagAdminPage;