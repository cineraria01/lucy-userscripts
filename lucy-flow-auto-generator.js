(function () {
  "use strict";

  const SCRIPT_VERSION = "0.2.7";
  const LUCY_BASE_URL = "https://lucystar.kr";
  const TOKEN_KEY = "lucy_tampermonkey_token";
  const PANEL_ID = "lucy-flow-connector-panel";
  const STYLE_MODAL_ID = "lucy-flow-style-modal";
  const STYLE_ID = "lucy-flow-connector-style";
  const STORAGE_PREFIX = "lucy_flow_connector_";

  function resolveGrantedGMInfo() {
    if (typeof GM_info !== "undefined" && GM_info) {
      return GM_info;
    }
    return globalThis.GM_info || null;
  }

  function normalizeVersion(value) {
    return String(value || "").trim().replace(/^v/i, "");
  }

  function resolveInstalledVersion() {
    const gmInfo = resolveGrantedGMInfo();
    const candidates = [
      globalThis.__LUCY_FLOW_INSTALLED_VERSION__,
      globalThis.__LUCY_FLOW_REMOTE_VERSION__,
      globalThis.__LUCY_FLOW_LOADER_VERSION__,
      gmInfo?.script?.version,
      gmInfo?.version,
      SCRIPT_VERSION,
    ];

    for (const candidate of candidates) {
      const version = normalizeVersion(candidate);
      if (version) {
        return version;
      }
    }

    return "unknown";
  }

  const INSTALLED_VERSION = resolveInstalledVersion();
  globalThis.__LUCY_FLOW_INSTALLED_VERSION__ = INSTALLED_VERSION;

  function readLocalStorage(key, fallback = "") {
    try {
      const value = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeLocalStorage(key, value) {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(value ?? ""));
    } catch (_) {}
  }

  function clearConnectorLocalStorage() {
    const keys = [
      "selectedProjectId",
      "selectedEpisodeId",
      "selectedStyleCode",
      "batchStartScene",
      "batchEndScene",
      "batchDelayMs",
      "autoSaveResults",
    ];
    for (const key of keys) {
      try {
        window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      } catch (_) {}
    }
  }

  function readLocalStorageBool(key, fallback = true) {
    return readLocalStorage(key, fallback ? "true" : "false") !== "false";
  }

  const state = {
    token: String(GM_getValue(TOKEN_KEY, "") || "").trim(),
    profile: null,
    connecting: false,
    projects: [],
    episodes: [],
    styles: [],
    promptBundle: null,
    selectedProjectId: readLocalStorage("selectedProjectId", ""),
    selectedEpisodeId: readLocalStorage("selectedEpisodeId", ""),
    selectedStyleCode: readLocalStorage("selectedStyleCode", ""),
    batchStartScene: readLocalStorage("batchStartScene", ""),
    batchEndScene: readLocalStorage("batchEndScene", ""),
    batchDelayMs: readLocalStorage("batchDelayMs", "8000"),
    autoSaveResults: readLocalStorageBool("autoSaveResults", true),
    batchRunning: false,
    stopRequested: false,
    seenResultUrls: [],
    autoLoaded: false,
  };

  function request(method, path, token, body = null) {
    return new Promise((resolve, reject) => {
      const headers = token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {};
      if (body) {
        headers["Content-Type"] = "application/json";
      }
      GM_xmlhttpRequest({
        method,
        url: `${LUCY_BASE_URL}${path}`,
        headers,
        data: body ? JSON.stringify(body) : undefined,
        onload(response) {
          const text = response.responseText || "";
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch (_) {
            data = text;
          }
          if (response.status >= 200 && response.status < 300) {
            resolve(data);
            return;
          }
          reject({
            status: response.status,
            data,
          });
        },
        onerror(error) {
          reject({ status: 0, data: error });
        },
      });
    });
  }

  function resolveLucyUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return value;
    }
    if (value.startsWith("/")) {
      return `${LUCY_BASE_URL}${value}`;
    }
    return `${LUCY_BASE_URL}/${value.replace(/^\/+/, "")}`;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 24px;
        right: 24px;
        width: min(520px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        z-index: 999999;
        background: rgba(255,255,255,0.98);
        color: #0f172a;
        border: 1px solid rgba(148,163,184,0.35);
        border-radius: 18px;
        box-shadow: 0 28px 80px rgba(15,23,42,0.28);
        backdrop-filter: blur(14px);
        overflow: hidden;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID}.is-hidden { display: none; }
      #${PANEL_ID} .lucy-header {
        cursor: move;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px;
        background: linear-gradient(135deg, #111827, #1d4ed8);
        color: #fff;
      }
      #${PANEL_ID} .lucy-header small {
        display: block;
        margin-top: 4px;
        color: rgba(255,255,255,0.78);
        line-height: 1.5;
      }
      #${PANEL_ID} .lucy-header-top {
        display:flex;
        align-items:center;
        gap:8px;
        flex-wrap:wrap;
      }
      #${PANEL_ID} .lucy-version-badge,
      #${STYLE_MODAL_ID} .lucy-version-badge {
        display:inline-flex;
        align-items:center;
        padding:4px 9px;
        border-radius:999px;
        font-size:11px;
        font-weight:800;
        letter-spacing:0.01em;
        background:rgba(255,255,255,0.16);
        color:#e2e8f0;
        border:1px solid rgba(255,255,255,0.24);
      }
      #${PANEL_ID} .lucy-close {
        border: none;
        background: rgba(255,255,255,0.16);
        color: #fff;
        border-radius: 10px;
        width: 32px;
        height: 32px;
        cursor: pointer;
        font-size: 18px;
      }
      #${PANEL_ID} .lucy-body {
        padding: 16px 18px 18px;
        overflow: auto;
        max-height: calc(100vh - 120px);
      }
      #${PANEL_ID} .lucy-row { display: flex; gap: 8px; flex-wrap: wrap; }
      #${PANEL_ID} .lucy-section { margin-top: 14px; }
      #${PANEL_ID} .lucy-label {
        display: block;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 6px;
        color: #334155;
      }
      #${PANEL_ID} .lucy-input,
      #${PANEL_ID} .lucy-select,
      #${PANEL_ID} .lucy-textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 10px 12px;
        background: #fff;
        color: #0f172a;
        font-size: 13px;
      }
      #${PANEL_ID} .lucy-textarea {
        min-height: 110px;
        resize: vertical;
        line-height: 1.55;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #${PANEL_ID} .lucy-button {
        border: none;
        border-radius: 11px;
        padding: 10px 13px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }
      #${PANEL_ID} .lucy-button.primary { background: #2563eb; color: #fff; }
      #${PANEL_ID} .lucy-button.dark { background: #0f172a; color: #fff; }
      #${PANEL_ID} .lucy-button.light { background: #eff6ff; color: #1d4ed8; }
      #${PANEL_ID} .lucy-button.ghost { background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; }
      #${PANEL_ID} .lucy-status {
        margin-top: 12px;
        display: none;
        padding: 12px 13px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.6;
      }
      #${PANEL_ID} .lucy-status.info { display: block; background: #eff6ff; color: #1d4ed8; border: 1px solid #93c5fd; }
      #${PANEL_ID} .lucy-status.success { display: block; background: #ecfdf5; color: #166534; border: 1px solid #86efac; }
      #${PANEL_ID} .lucy-status.error { display: block; background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; }
      #${PANEL_ID} .lucy-card {
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 12px;
        background: #f8fafc;
      }
      #${PANEL_ID} .lucy-card.compact {
        padding: 10px 12px;
      }
      #${PANEL_ID} .lucy-toolbar {
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        align-items:center;
      }
      #${PANEL_ID} .lucy-button.subtle {
        background:#ffffff;
        color:#334155;
        border:1px solid #e2e8f0;
      }
      #${PANEL_ID} .lucy-connection {
        display:flex;
        flex-direction:column;
        gap:6px;
      }
      #${PANEL_ID} .lucy-connection-top {
        display:flex;
        align-items:center;
        gap:8px;
        flex-wrap:wrap;
      }
      #${PANEL_ID} .lucy-connection-badge {
        display:inline-flex;
        align-items:center;
        padding:4px 9px;
        border-radius:999px;
        font-size:11px;
        font-weight:800;
        letter-spacing:0.01em;
      }
      #${PANEL_ID} .lucy-connection-badge.connected {
        background:#dcfce7;
        color:#166534;
      }
      #${PANEL_ID} .lucy-connection-badge.disconnected {
        background:#fee2e2;
        color:#991b1b;
      }
      #${PANEL_ID} .lucy-connection-name {
        font-size:14px;
        font-weight:800;
        color:#0f172a;
      }
      #${PANEL_ID} .lucy-connection-meta {
        display:flex;
        gap:6px;
        flex-wrap:wrap;
      }
      #${PANEL_ID} .lucy-chip {
        display:inline-flex;
        align-items:center;
        padding:4px 8px;
        border-radius:999px;
        font-size:11px;
        font-weight:700;
        background:#ffffff;
        border:1px solid #e2e8f0;
        color:#475569;
      }
      #${PANEL_ID} .lucy-inline-grid {
        display:grid;
        grid-template-columns:repeat(3, minmax(0, 1fr));
        gap:8px;
      }
      #${PANEL_ID} .lucy-mini-field {
        padding:8px 9px;
        border-radius:10px;
        border:1px solid #e2e8f0;
        background:#fff;
      }
      #${PANEL_ID} .lucy-mini-field strong {
        display:block;
        font-size:11px;
        color:#64748b;
        margin-bottom:4px;
      }
      #${PANEL_ID} .lucy-mini-field span {
        display:block;
        font-size:13px;
        color:#0f172a;
      }
      #${PANEL_ID} .lucy-meta {
        font-size: 12px;
        color: #64748b;
        line-height: 1.55;
      }
      #${PANEL_ID} .lucy-list {
        display: grid;
        gap: 8px;
        max-height: 180px;
        overflow: auto;
      }
      #${PANEL_ID} .lucy-style-item, #${STYLE_MODAL_ID} .lucy-style-item {
        padding: 10px 11px;
        border-radius: 12px;
        background: #fff;
        border: 1px solid #e2e8f0;
      }
      #${PANEL_ID} .lucy-style-visual, #${STYLE_MODAL_ID} .lucy-style-visual {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
      }
      #${PANEL_ID} .lucy-style-thumb, #${STYLE_MODAL_ID} .lucy-style-thumb {
        width: 72px;
        height: 72px;
        border-radius: 12px;
        object-fit: cover;
        background: linear-gradient(135deg, #dbeafe, #eff6ff);
        border: 1px solid #dbeafe;
      }
      #${PANEL_ID} .lucy-style-fallback, #${STYLE_MODAL_ID} .lucy-style-fallback {
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:11px;
        font-weight:700;
        color:#1d4ed8;
      }
      #${PANEL_ID} .lucy-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        background: #dbeafe;
        color: #1d4ed8;
      }
      #${PANEL_ID} .lucy-badge.user { background: #dcfce7; color: #166534; }
      #${PANEL_ID} .lucy-muted-button {
        border:none;
        background:transparent;
        color:#475569;
        padding:0;
        margin-top:6px;
        font-size:12px;
        font-weight:700;
        cursor:pointer;
      }
      #${STYLE_MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 1000000;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(15,23,42,0.42);
        padding: 16px;
      }
      #${STYLE_MODAL_ID}.is-open { display: flex; }
      #${STYLE_MODAL_ID} .lucy-style-dialog {
        width: min(840px, 100%);
        max-height: calc(100vh - 32px);
        overflow: auto;
        background: rgba(255,255,255,0.98);
        color: #0f172a;
        border-radius: 18px;
        border: 1px solid rgba(148,163,184,0.35);
        box-shadow: 0 28px 80px rgba(15,23,42,0.28);
        padding: 18px;
      }
      #${STYLE_MODAL_ID} .lucy-modal-top {
        display:flex;
        align-items:center;
        gap:8px;
        flex-wrap:wrap;
      }
      #${STYLE_MODAL_ID} .lucy-version-badge {
        background:#eff6ff;
        color:#1d4ed8;
        border:1px solid #bfdbfe;
      }
      #${STYLE_MODAL_ID} .lucy-style-grid {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      #${STYLE_MODAL_ID} .lucy-style-item.is-selected {
        border-color:#2563eb;
        background:#eff6ff;
        box-shadow:0 0 0 2px rgba(37,99,235,0.12);
      }
      #${STYLE_MODAL_ID} .lucy-style-item {
        cursor:pointer;
        transition:transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
      }
      #${STYLE_MODAL_ID} .lucy-style-item:hover {
        transform:translateY(-1px);
        box-shadow:0 12px 24px rgba(15,23,42,0.08);
        border-color:#93c5fd;
      }
      #${PANEL_ID} details.lucy-collapse {
        border:1px solid #e2e8f0;
        border-radius:12px;
        background:#fff;
        padding:10px 12px;
      }
      #${PANEL_ID} details.lucy-collapse summary {
        cursor:pointer;
        font-size:12px;
        font-weight:800;
        color:#334155;
        list-style:none;
      }
      #${PANEL_ID} details.lucy-collapse summary::-webkit-details-marker {
        display:none;
      }
      #${PANEL_ID} .lucy-helper {
        font-size:11px;
        color:#64748b;
        line-height:1.5;
      }
      #${PANEL_ID} .lucy-steps {
        display:grid;
        gap:8px;
      }
      #${PANEL_ID} .lucy-step {
        display:grid;
        grid-template-columns:24px minmax(0, 1fr);
        gap:10px;
        align-items:center;
        padding:8px 10px;
        border-radius:12px;
        background:#fff;
        border:1px solid #e2e8f0;
      }
      #${PANEL_ID} .lucy-step-copy {
        display:flex;
        align-items:center;
        gap:8px;
        min-width:0;
        flex-wrap:nowrap;
      }
      #${PANEL_ID} .lucy-step-no {
        display:flex;
        align-items:center;
        justify-content:center;
        width:24px;
        height:24px;
        border-radius:999px;
        font-size:11px;
        font-weight:800;
        background:#e2e8f0;
        color:#334155;
      }
      #${PANEL_ID} .lucy-step.is-done {
        border-color:#86efac;
        background:#f0fdf4;
      }
      #${PANEL_ID} .lucy-step.is-done .lucy-step-no {
        background:#22c55e;
        color:#fff;
      }
      #${PANEL_ID} .lucy-step strong {
        display:block;
        flex:0 0 auto;
        font-size:12px;
        color:#0f172a;
        margin-bottom:0;
        white-space:nowrap;
      }
      #${PANEL_ID} .lucy-step .lucy-helper {
        min-width:0;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      @media (max-width: 560px) {
        #${PANEL_ID} .lucy-step {
          align-items:start;
        }
        #${PANEL_ID} .lucy-step-copy {
          flex-wrap:wrap;
          gap:4px 8px;
        }
        #${PANEL_ID} .lucy-step .lucy-helper {
          white-space:normal;
          overflow:visible;
          text-overflow:clip;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setStatus(message, variant = "info") {
    const status = document.querySelector(`#${PANEL_ID} [data-role="status"]`);
    if (!status) return;
    status.className = `lucy-status ${variant}`;
    status.textContent = message;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function getSelectedStyle() {
    return (
      state.styles.find((style) => String(style.code) === String(state.selectedStyleCode)) ||
      null
    );
  }

  function buildStyleText(style) {
    if (!style) return "";
    const chunks = [
      style.style_prompt,
      style.character_style_prompt,
      style.background_style_prompt,
      style.color_style_prompt,
    ]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    return chunks.join("\n");
  }

  function buildMergedPrompt(item) {
    const style = getSelectedStyle();
    const styleText = buildStyleText(style);
    const isSubScene = item?.kind === "dialogue";
    const promptText = isSubScene
      ? String(item?.image_prompt || "").trim()
      : Array.isArray(item?.image_prompts_json)
        ? item.image_prompts_json.map((value) => String(value || "").trim()).filter(Boolean).join("\n\n")
        : "";
    if (!styleText) {
      return promptText;
    }
    if (!promptText) {
      return styleText;
    }
    return `${promptText}\n\n${styleText}`;
  }

  function getFlattenedPromptItems() {
    const scenes = Array.isArray(state.promptBundle?.scenes)
      ? [...state.promptBundle.scenes].sort((a, b) => Number(a.scene_index) - Number(b.scene_index))
      : [];
    const flattened = [];
    let sequence = 1;

    for (const scene of scenes) {
      const mainPromptText = Array.isArray(scene?.image_prompts_json)
        ? scene.image_prompts_json.map((value) => String(value || "").trim()).filter(Boolean).join("\n\n")
        : "";
      if (mainPromptText) {
        flattened.push({
          ...scene,
          kind: "scene",
          sequence_no: sequence++,
        });
      }

      const dialogues = Array.isArray(scene?.dialogues)
        ? [...scene.dialogues].sort((a, b) => Number(a.index) - Number(b.index))
        : [];
      for (const dialogue of dialogues) {
        const dialoguePrompt = String(dialogue?.image_prompt || "").trim();
        if (!dialoguePrompt) continue;
        flattened.push({
          kind: "dialogue",
          sequence_no: sequence++,
          scene_id: scene.scene_id,
          scene_index: scene.scene_index,
          title: scene.title,
          description: scene.description,
          dialogue_id: dialogue.id,
          dialogue_index: dialogue.index,
          dialogue_text: dialogue.text,
          image_prompt: dialoguePrompt,
        });
      }
    }
    return flattened;
  }

  function getBatchScenes() {
    const items = getFlattenedPromptItems();
    if (!items.length) return [];
    const start = Number(state.batchStartScene || items[0].sequence_no);
    const end = Number(state.batchEndScene || items[items.length - 1].sequence_no);
    return items.filter((item) => item.sequence_no >= start && item.sequence_no <= end);
  }

  function findFlowEditor() {
    return document.querySelector('div[data-slate-editor="true"][contenteditable="true"]');
  }

  function findFlowComposer(editor = null) {
    const targetEditor = editor || findFlowEditor();
    if (!targetEditor) return null;
    return (
      targetEditor.closest('div[class*="sc-9586f820-0"]') ||
      targetEditor.closest("form") ||
      targetEditor.parentElement
    );
  }

  function isButtonInteractive(button) {
    return Boolean(
      button &&
      !button.disabled &&
      button.getAttribute("aria-disabled") !== "true" &&
      button.getAttribute("data-disabled") !== "true"
    );
  }

  function getCreateButtonPriority(button) {
    if (!button) return 0;
    const iconText = String(
      button.querySelector(".google-symbols")?.textContent || ""
    )
      .trim()
      .toLowerCase();
    if (iconText.includes("arrow_forward")) {
      return 3;
    }
    if (iconText.includes("add_2")) {
      return 0;
    }

    const labelText = [
      button.getAttribute?.("aria-label"),
      button.textContent,
      button.innerText,
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .join(" ");
    return (
      labelText.includes("만들기") ||
      labelText.includes("create") ||
      labelText.includes("generate")
    )
      ? 1
      : 0;
  }

  function looksLikeCreateButton(button) {
    return getCreateButtonPriority(button) > 0;
  }

  function selectAllInEditor(editor) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getEditorPlainText(editor) {
    return String(editor?.innerText || editor?.textContent || "")
      .replace(/\uFEFF/g, "")
      .trim();
  }

  function injectPromptIntoFlow(promptText) {
    const editor = findFlowEditor();
    if (!editor) {
      throw new Error("Google Flow 입력창을 찾지 못했습니다.");
    }

    editor.focus();
    selectAllInEditor(editor);
    document.execCommand("delete", false);

    let pasted = false;
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", promptText);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      pasted = editor.dispatchEvent(pasteEvent);
    } catch (_) {
      pasted = false;
    }

    if (!getEditorPlainText(editor)) {
      document.execCommand("insertText", false, promptText);
    }

    if (getEditorPlainText(editor) !== promptText.trim()) {
      selectAllInEditor(editor);
      document.execCommand("insertText", false, promptText);
    }

    if (getEditorPlainText(editor) !== promptText.trim()) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.deleteContents();
      range.insertNode(document.createTextNode(promptText));
      selection.removeAllRanges();
      selection.addRange(range);
    }

    editor.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: promptText,
        inputType: pasted ? "insertFromPaste" : "insertText",
      })
    );
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: promptText,
        inputType: pasted ? "insertFromPaste" : "insertText",
      })
    );
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    editor.dispatchEvent(new Event("blur", { bubbles: true }));
    editor.focus();
  }

  function findCreateButton() {
    const composer = findFlowComposer();
    const searchRoot = composer || document;
    const buttons = [...searchRoot.querySelectorAll("button")]
      .map((button, index) => ({
        button,
        index,
        priority: getCreateButtonPriority(button),
      }))
      .filter((entry) => entry.priority > 0)
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        return left.index - right.index;
      });
    return (
      buttons.find((entry) => isButtonInteractive(entry.button))?.button ||
      buttons[0]?.button ||
      null
    );
  }

  function dispatchButtonEvent(target, type) {
    if (!target || typeof target.dispatchEvent !== "function") return;
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    if (type.startsWith("pointer")) {
      const PointerCtor =
        (typeof window !== "undefined" && window.PointerEvent) ||
        (typeof PointerEvent === "function" ? PointerEvent : null);
      if (PointerCtor) {
        target.dispatchEvent(
          new PointerCtor(type, {
            ...init,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
          })
        );
        return;
      }
    }

    const MouseCtor =
      (typeof window !== "undefined" && window.MouseEvent) ||
      (typeof MouseEvent === "function" ? MouseEvent : null);
    if (MouseCtor) {
      target.dispatchEvent(new MouseCtor(type, init));
      return;
    }

    target.dispatchEvent(new Event(type, init));
  }

  async function clickCreateButton() {
    let button = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      button = findCreateButton();
      if (isButtonInteractive(button)) {
        break;
      }
      await sleep(300);
    }
    if (!button) {
      throw new Error("Google Flow 만들기 버튼을 찾지 못했습니다.");
    }
    if (!isButtonInteractive(button)) {
      throw new Error("Google Flow 만들기 버튼이 아직 활성화되지 않았습니다.");
    }

    if (typeof button.focus === "function") {
      button.focus();
    }

    if (typeof button.click === "function") {
      button.click();
      return;
    }

    dispatchButtonEvent(button, "pointerdown");
    dispatchButtonEvent(button, "mousedown");
    dispatchButtonEvent(button, "pointerup");
    dispatchButtonEvent(button, "mouseup");
    dispatchButtonEvent(button, "click");
  }

  function collectGeneratedImageUrls() {
    const candidates = new Set();
    [...document.querySelectorAll("img[src], a[href]")]
      .forEach((node) => {
        const rawUrl = node.getAttribute("src") || node.getAttribute("href") || "";
        const url = String(rawUrl || "").trim();
        if (!url.startsWith("http")) return;
        const lower = url.toLowerCase();
        const looksLikeImage =
          lower.includes("googleusercontent") ||
          lower.includes("ggpht") ||
          /\.(png|jpg|jpeg|webp)(\?|$)/.test(lower);
        if (looksLikeImage) {
          candidates.add(url);
        }
      });
    return [...candidates];
  }

  async function registerGeneratedImage(scene, imageUrl) {
    if (!scene?.scene_id || !imageUrl) return;
    const payload = {
      scene_id: scene.scene_id,
      image_url: imageUrl,
      prompt_text: buildMergedPrompt(scene),
      style_code: state.selectedStyleCode || null,
      source_label: "google-flow-auto",
    };
    await request(
      "POST",
      "/api/v1/me/tampermonkey-assets/register",
      state.token,
      payload
    );
  }

  async function waitAndCaptureNewImage(scene, waitMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
      const urls = collectGeneratedImageUrls();
      const fresh = urls.find((url) => !state.seenResultUrls.includes(url));
      if (fresh) {
        state.seenResultUrls.unshift(fresh);
        state.seenResultUrls = state.seenResultUrls.slice(0, 200);
        if (state.autoSaveResults) {
          await registerGeneratedImage(scene, fresh);
        }
        return fresh;
      }
      await sleep(1500);
    }
    return null;
  }

  function render() {
    ensureStyles();
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
      attachDrag(panel);
    }

    const profileHtml = state.profile
      ? `
        <div class="lucy-connection">
          <div class="lucy-connection-top">
            <span class="lucy-connection-badge connected">Lucy 연결됨</span>
            <span class="lucy-connection-name">${escapeHtml(state.profile.display_name || state.profile.email)}</span>
          </div>
          <div class="lucy-connection-meta">
            <span class="lucy-chip">${escapeHtml(state.profile.email)}</span>
            <span class="lucy-chip">${escapeHtml(normalizeRoleLabel(state.profile.role))}</span>
            <span class="lucy-chip">프로젝트 ${state.projects.length || 0}</span>
            <span class="lucy-chip">스타일 ${state.styles.length || 0}</span>
          </div>
        </div>
      `
      : state.token && state.connecting
        ? `
        <div class="lucy-connection">
          <div class="lucy-connection-top">
            <span class="lucy-connection-badge connected">연결 확인 중</span>
            <span class="lucy-connection-name">저장된 토큰으로 Lucy 확인 중</span>
          </div>
          <div class="lucy-meta">토큰은 저장되어 있고, 현재 Lucy 계정 상태와 프로젝트/스타일 목록을 불러오는 중입니다.</div>
        </div>
      `
      : `
        <div class="lucy-connection">
          <div class="lucy-connection-top">
            <span class="lucy-connection-badge disconnected">Lucy 미연결</span>
            <span class="lucy-connection-name">토큰 저장 필요</span>
          </div>
          <div class="lucy-meta">토큰을 한 번 저장하면 새로고침 시 자동으로 연결하고 프로젝트/스타일도 자동으로 불러옵니다.</div>
        </div>
      `;

    const hasToken = Boolean(state.token);
    const hasEpisode = Boolean(state.selectedEpisodeId);
    const hasPromptBundle = Boolean(state.promptBundle && getFlattenedPromptItems().length);
    const hasStyle = Boolean(state.selectedStyleCode);

    const stepsHtml = `
      <div class="lucy-steps">
        <div class="lucy-step ${hasToken ? "is-done" : ""}">
          <div class="lucy-step-no">1</div>
          <div class="lucy-step-copy">
            <strong>토큰 확인</strong>
            <div class="lucy-helper">토큰 추가에서 Lucy 연동 토큰을 저장합니다.</div>
          </div>
        </div>
        <div class="lucy-step ${hasEpisode ? "is-done" : ""}">
          <div class="lucy-step-no">2</div>
          <div class="lucy-step-copy">
            <strong>프로젝트/에피소드 선택</strong>
            <div class="lucy-helper">프로젝트와 에피소드를 고르면 해당 에피소드 기준으로 작업합니다.</div>
          </div>
        </div>
        <div class="lucy-step ${hasPromptBundle ? "is-done" : ""}">
          <div class="lucy-step-no">3</div>
          <div class="lucy-step-copy">
            <strong>프롬프트 불러오기</strong>
            <div class="lucy-helper">실제 장수와 시작/끝 번호는 프롬프트를 불러와야 계산됩니다.</div>
          </div>
        </div>
        <div class="lucy-step ${hasStyle ? "is-done" : ""}">
          <div class="lucy-step-no">4</div>
          <div class="lucy-step-copy">
            <strong>스타일 선택 후 시작</strong>
            <div class="lucy-helper">스타일 보기에서 스타일을 고른 뒤 범위 생성 시작을 누릅니다.</div>
          </div>
        </div>
      </div>
    `;

    const projectOptions = [
      `<option value="">프로젝트 선택</option>`,
      ...state.projects.map(
        (project) =>
          `<option value="${project.id}" ${String(project.id) === String(state.selectedProjectId) ? "selected" : ""}>${escapeHtml(project.name)} (${project.episode_count})</option>`
      ),
    ].join("");

    const episodeOptions = [
      `<option value="">에피소드 선택</option>`,
      ...state.episodes.map(
        (episode) =>
          `<option value="${episode.id}" ${String(episode.id) === String(state.selectedEpisodeId) ? "selected" : ""}>${escapeHtml(episode.title)} (${episode.scene_count})</option>`
      ),
    ].join("");

    const promptJson = state.promptBundle
      ? escapeHtml(JSON.stringify(state.promptBundle, null, 2))
      : "";

    const stylesHtml = state.styles.length
      ? state.styles
          .map(
            (style) => `
              <div class="lucy-style-item ${String(style.code) === String(state.selectedStyleCode) ? "is-selected" : ""}" data-action="pick-style" data-style-code="${escapeHtml(style.code)}">
                <div class="lucy-style-visual">
                  ${
                    style.thumbnail_url
                      ? `<img class="lucy-style-thumb" src="${escapeHtml(resolveLucyUrl(style.thumbnail_url))}" alt="${escapeHtml(style.name)}">`
                      : `<div class="lucy-style-thumb lucy-style-fallback">NO IMAGE</div>`
                  }
                  <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                      <strong style="font-size:13px;">${escapeHtml(style.name)}</strong>
                      <span class="lucy-badge ${style.is_global ? "" : "user"}">${style.is_global ? "기본 스타일" : "내 스타일"}</span>
                    </div>
                    <div class="lucy-meta" style="margin-top:6px;">code: ${escapeHtml(style.code)}</div>
                    <div class="lucy-meta" style="margin-top:4px;">${escapeHtml(style.style_prompt || "대표 스타일 프롬프트 없음")}</div>
                    <details style="margin-top:8px;">
                      <summary style="cursor:pointer;font-size:12px;font-weight:700;color:#334155;">세부 스타일 보기</summary>
                      <div class="lucy-meta" style="margin-top:8px;">character: ${escapeHtml(style.character_style_prompt || "-")}</div>
                      <div class="lucy-meta" style="margin-top:4px;">background: ${escapeHtml(style.background_style_prompt || "-")}</div>
                      <div class="lucy-meta" style="margin-top:4px;">color: ${escapeHtml(style.color_style_prompt || "-")}</div>
                    </details>
                    <div class="lucy-muted-button" style="pointer-events:none;">${String(style.code) === String(state.selectedStyleCode) ? "선택됨" : "카드를 눌러 선택"}</div>
                  </div>
                </div>
              </div>
            `
          )
          .join("")
      : `<div class="lucy-meta">불러온 스타일이 없습니다.</div>`;

    panel.innerHTML = `
      <div class="lucy-header" data-role="drag-handle">
        <div>
          <div class="lucy-header-top">
            <div style="font-size:18px;font-weight:800;">Lucy Flow Connector</div>
            <span class="lucy-version-badge">설치 버전 v${escapeHtml(INSTALLED_VERSION)}</span>
          </div>
          <small>프로젝트 선택, 스타일 선택, 범위 생성만 빠르게 처리하는 패널입니다.</small>
        </div>
        <button class="lucy-close" type="button" data-action="close">×</button>
      </div>
      <div class="lucy-body">
        <div class="lucy-card compact">
          ${profileHtml}
        </div>

        <div class="lucy-section">
          ${stepsHtml}
        </div>

        <div class="lucy-section">
          <div class="lucy-toolbar">
            <button class="lucy-button primary" type="button" data-action="toggle-token">토큰 추가</button>
            <button class="lucy-button subtle" type="button" data-action="reload-data">목록 새로고침</button>
            <button class="lucy-button ghost" type="button" data-action="open-styles">스타일 보기</button>
            <button class="lucy-button ghost" type="button" data-action="reset-storage">설정 초기화</button>
          </div>
        </div>

        <div class="lucy-section" data-role="token-box" style="display:${state.token ? "none" : "block"};">
          <label class="lucy-label">템퍼몽키 연동 토큰</label>
          <textarea class="lucy-textarea" data-role="token-input" placeholder="lucy_tm_...">${escapeHtml(state.token)}</textarea>
          <div class="lucy-row" style="margin-top:8px;">
            <button class="lucy-button primary" type="button" data-action="save-token">토큰 저장</button>
            <button class="lucy-button ghost" type="button" data-action="clear-token">토큰 지우기</button>
          </div>
        </div>

        <div data-role="status" class="lucy-status"></div>

        <div class="lucy-section">
          <label class="lucy-label">작업 선택</label>
          <div class="lucy-row" style="flex-direction:column;">
            <select class="lucy-select" data-role="project-select">${projectOptions}</select>
            <select class="lucy-select" data-role="episode-select">${episodeOptions}</select>
          </div>
          <div class="lucy-row" style="margin-top:10px;">
            <button class="lucy-button dark" type="button" data-action="load-prompt-bundle">프롬프트 불러오기</button>
          </div>
          <div class="lucy-helper" style="margin-top:8px;">선택 스타일: ${escapeHtml(getSelectedStyle()?.name || "선택 안함")} / 실제 생성 장수: ${getFlattenedPromptItems().length || 0}장 (서브 장면 포함)</div>
        </div>

        <div class="lucy-section">
          <label class="lucy-label">배치 생성 설정</label>
          <div class="lucy-inline-grid">
            <div class="lucy-mini-field">
              <strong>시작 번호</strong>
              <input class="lucy-input" data-role="batch-start" type="number" min="1" placeholder="${escapeHtml(getFlattenedPromptItems()[0]?.sequence_no || 1)}" value="${escapeHtml(state.batchStartScene)}">
            </div>
            <div class="lucy-mini-field">
              <strong>끝 번호</strong>
              <input class="lucy-input" data-role="batch-end" type="number" min="1" placeholder="${escapeHtml(getFlattenedPromptItems().slice(-1)[0]?.sequence_no || 1)}" value="${escapeHtml(state.batchEndScene)}">
            </div>
            <div class="lucy-mini-field">
              <strong>딜레이(ms)</strong>
              <input class="lucy-input" data-role="batch-delay" type="number" min="1000" step="500" placeholder="8000" value="${escapeHtml(state.batchDelayMs)}">
            </div>
          </div>
          <label class="lucy-meta" style="display:flex;align-items:center;gap:8px;margin-top:8px;">
            <input type="checkbox" data-role="auto-save-results" ${state.autoSaveResults ? "checked" : ""}>
            생성된 결과 이미지 URL을 Lucy로 자동 연결
          </label>
          <div class="lucy-row" style="margin-top:10px;">
            <button class="lucy-button ${state.batchRunning ? "ghost" : "primary"}" type="button" data-action="toggle-batch">${state.batchRunning ? "중지" : "범위 생성 시작"}</button>
          </div>
          <div class="lucy-helper" style="margin-top:8px;">선택한 스타일과 장면 프롬프트를 합쳐 Google Flow 입력창에 순차로 넣고 만들기 버튼을 누릅니다.</div>
        </div>

        <details class="lucy-collapse lucy-section">
          <summary>프롬프트 JSON 보기</summary>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 6px;">
            <span class="lucy-helper">평소에는 숨겨두고 필요할 때만 확인하세요.</span>
            <button class="lucy-button ghost" type="button" data-action="copy-json">JSON 복사</button>
          </div>
          <textarea class="lucy-textarea" data-role="prompt-json" placeholder="에피소드를 선택한 뒤 필요할 때만 JSON을 불러오세요.">${promptJson}</textarea>
        </details>
      </div>
    `;

    let styleModal = document.getElementById(STYLE_MODAL_ID);
    if (!styleModal) {
      styleModal = document.createElement("div");
      styleModal.id = STYLE_MODAL_ID;
      document.body.appendChild(styleModal);
    }
    styleModal.innerHTML = `
      <div class="lucy-style-dialog">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;">
          <div>
            <div class="lucy-modal-top">
              <div style="font-size:20px;font-weight:800;">Lucy 스타일 보기</div>
              <span class="lucy-version-badge">설치 버전 v${escapeHtml(INSTALLED_VERSION)}</span>
            </div>
            <div class="lucy-meta" style="margin-top:6px;">카드를 눌러 기본 스타일을 정하세요. 선택값은 localStorage에 저장되어 다음에도 기본값으로 사용됩니다.</div>
          </div>
          <button class="lucy-close" type="button" data-action="close-style-modal" style="color:#0f172a;background:#e2e8f0;">×</button>
        </div>
        <div class="lucy-row" style="margin-bottom:12px;">
          <button class="lucy-button ghost" type="button" data-action="clear-style-selection">스타일 선택 해제</button>
        </div>
        <div class="lucy-style-grid">${stylesHtml}</div>
      </div>
    `;

    styleModal.addEventListener("click", (event) => {
      if (
        event.target === styleModal ||
        event.target?.getAttribute("data-action") === "close-style-modal"
      ) {
        styleModal.classList.remove("is-open");
      }
    });

    bindPanelEvents(panel);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeRoleLabel(role) {
    const value = String(role || "").trim().toLowerCase();
    const labels = {
      admin: "관리자",
      assistant: "어시스턴트",
      manager: "매니저",
      tester: "테스터",
      member: "멤버",
      guest: "게스트",
    };
    return labels[value] || role || "-";
  }

  function bindPanelEvents(panel) {
    panel.querySelector('[data-action="close"]')?.addEventListener("click", () => {
      panel.classList.add("is-hidden");
    });

    panel.querySelector('[data-action="toggle-token"]')?.addEventListener("click", () => {
      const tokenBox = panel.querySelector('[data-role="token-box"]');
      tokenBox.style.display = tokenBox.style.display === "none" ? "block" : "none";
    });

    panel.querySelector('[data-action="save-token"]')?.addEventListener("click", async () => {
      const input = panel.querySelector('[data-role="token-input"]');
      state.token = String(input.value || "").trim();
      if (!state.token) {
        setStatus("빈 토큰은 저장할 수 없습니다.", "error");
        return;
      }
      GM_setValue(TOKEN_KEY, state.token);
      state.autoLoaded = false;
      setStatus("토큰을 저장했습니다.", "success");
      await autoInitialize();
    });

    panel.querySelector('[data-action="clear-token"]')?.addEventListener("click", () => {
      state.token = "";
      GM_setValue(TOKEN_KEY, "");
      panel.querySelector('[data-role="token-input"]').value = "";
      setStatus("저장된 토큰을 지웠습니다.", "info");
    });

    panel.querySelector('[data-action="load-projects"]')?.addEventListener("click", async () => {
      await loadProjects();
    });

    panel.querySelector('[data-action="open-styles"]')?.addEventListener("click", async () => {
      if (!state.styles.length) {
        await loadStyles();
      }
      document.getElementById(STYLE_MODAL_ID)?.classList.add("is-open");
    });

    panel.querySelector('[data-action="load-prompt-bundle"]')?.addEventListener("click", async () => {
      await loadPromptBundle();
    });

    panel.querySelector('[data-action="reload-data"]')?.addEventListener("click", async () => {
      if (!state.token) {
        setStatus("먼저 토큰을 저장해 주세요.", "error");
        return;
      }
      await Promise.all([loadProjects(), loadStyles()]);
    });

    panel.querySelector('[data-action="reset-storage"]')?.addEventListener("click", () => {
      clearConnectorLocalStorage();
      state.selectedProjectId = "";
      state.selectedEpisodeId = "";
      state.selectedStyleCode = "";
      state.batchStartScene = "";
      state.batchEndScene = "";
      state.batchDelayMs = "8000";
      state.autoSaveResults = true;
      state.promptBundle = null;
      state.episodes = [];
      render();
      setStatus("저장된 기본 설정을 초기화했습니다.", "success");
    });

    panel.querySelector('[data-action="toggle-batch"]')?.addEventListener("click", async () => {
      if (state.batchRunning) {
        state.stopRequested = true;
        state.batchRunning = false;
        render();
        setStatus("배치 생성을 중지 요청했습니다.", "info");
        return;
      }
      await startBatchGeneration();
    });

    panel.querySelector('[data-action="copy-json"]')?.addEventListener("click", async () => {
      const text = panel.querySelector('[data-role="prompt-json"]').value;
      if (!text.trim()) {
        setStatus("복사할 JSON이 없습니다.", "error");
        return;
      }
      await navigator.clipboard.writeText(text);
      setStatus("프롬프트 JSON을 복사했습니다.", "success");
    });

    panel.querySelector('[data-role="project-select"]')?.addEventListener("change", async (event) => {
      state.selectedProjectId = event.target.value;
      writeLocalStorage("selectedProjectId", state.selectedProjectId);
      state.selectedEpisodeId = "";
      writeLocalStorage("selectedEpisodeId", "");
      state.promptBundle = null;
      state.batchStartScene = "";
      state.batchEndScene = "";
      writeLocalStorage("batchStartScene", "");
      writeLocalStorage("batchEndScene", "");
      render();
      if (state.selectedProjectId) {
        await loadEpisodes(state.selectedProjectId);
      }
    });

    panel.querySelector('[data-role="episode-select"]')?.addEventListener("change", async (event) => {
      state.selectedEpisodeId = event.target.value;
      writeLocalStorage("selectedEpisodeId", state.selectedEpisodeId);
      state.promptBundle = null;
      state.batchStartScene = "";
      state.batchEndScene = "";
      writeLocalStorage("batchStartScene", "");
      writeLocalStorage("batchEndScene", "");
      render();
      if (state.selectedEpisodeId) {
        await loadPromptBundle();
      }
    });

    panel.querySelector('[data-role="batch-start"]')?.addEventListener("change", (event) => {
      state.batchStartScene = String(event.target.value || "");
      writeLocalStorage("batchStartScene", state.batchStartScene);
    });

    panel.querySelector('[data-role="batch-end"]')?.addEventListener("change", (event) => {
      state.batchEndScene = String(event.target.value || "");
      writeLocalStorage("batchEndScene", state.batchEndScene);
    });

    panel.querySelector('[data-role="batch-delay"]')?.addEventListener("change", (event) => {
      state.batchDelayMs = String(event.target.value || "8000");
      writeLocalStorage("batchDelayMs", state.batchDelayMs);
    });

    panel.querySelector('[data-role="auto-save-results"]')?.addEventListener("change", (event) => {
      state.autoSaveResults = !!event.target.checked;
      writeLocalStorage("autoSaveResults", state.autoSaveResults ? "true" : "false");
    });

    document.getElementById(STYLE_MODAL_ID)?.querySelectorAll('[data-action="pick-style"]')
      ?.forEach((button) => {
        button.addEventListener("click", () => {
          state.selectedStyleCode = String(button.getAttribute("data-style-code") || "");
          writeLocalStorage("selectedStyleCode", state.selectedStyleCode);
          document.getElementById(STYLE_MODAL_ID)?.classList.remove("is-open");
          render();
          setStatus("스타일을 선택했습니다.", "success");
        });
      });

    document.getElementById(STYLE_MODAL_ID)?.querySelector('[data-action="clear-style-selection"]')
      ?.addEventListener("click", () => {
        state.selectedStyleCode = "";
        writeLocalStorage("selectedStyleCode", "");
        render();
        setStatus("스타일 선택을 해제했습니다.", "info");
      });
  }

  function attachDrag(panel) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    panel.addEventListener("mousedown", (event) => {
      const handle = event.target.closest('[data-role="drag-handle"]');
      if (!handle) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      startX = event.clientX;
      startY = event.clientY;
      baseLeft = rect.left;
      baseTop = rect.top;
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      const nextLeft = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, baseLeft + (event.clientX - startX)));
      const nextTop = Math.max(8, Math.min(window.innerHeight - 80, baseTop + (event.clientY - startY)));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    window.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  async function loadProfile() {
    if (!state.token) {
      setStatus("먼저 토큰을 저장해 주세요.", "error");
      return;
    }
    state.connecting = true;
    render();
    setStatus("Lucy 연결을 확인하는 중입니다...", "info");
    try {
      state.profile = await request("GET", "/api/v1/me/tampermonkey-profile", state.token);
      state.connecting = false;
      render();
      setStatus(`연결 성공: ${state.profile.email}`, "success");
    } catch (error) {
      state.connecting = false;
      state.profile = null;
      render();
      setStatus(formatError(error, "연결 확인에 실패했습니다."), "error");
    }
  }

  async function loadProjects() {
    if (!state.token) {
      setStatus("먼저 토큰을 저장해 주세요.", "error");
      return;
    }
    setStatus("프로젝트 목록을 불러오는 중입니다...", "info");
    try {
      state.projects = await request("GET", "/api/v1/me/tampermonkey-projects", state.token);
      render();
      setStatus(`프로젝트 ${state.projects.length}개를 불러왔습니다.`, "success");
      if (state.selectedProjectId) {
        await loadEpisodes(state.selectedProjectId);
      }
    } catch (error) {
      setStatus(formatError(error, "프로젝트 목록을 불러오지 못했습니다."), "error");
    }
  }

  async function loadEpisodes(projectId) {
    if (!projectId) return;
    setStatus("에피소드 목록을 불러오는 중입니다...", "info");
    try {
      state.episodes = await request(
        "GET",
        `/api/v1/me/tampermonkey-projects/${projectId}/episodes`,
        state.token
      );
      render();
      setStatus(`에피소드 ${state.episodes.length}개를 불러왔습니다.`, "success");
    } catch (error) {
      setStatus(formatError(error, "에피소드 목록을 불러오지 못했습니다."), "error");
    }
  }

  async function loadPromptBundle() {
    if (!state.selectedEpisodeId) {
      setStatus("먼저 에피소드를 선택해 주세요.", "error");
      return;
    }
    setStatus("프롬프트 JSON을 불러오는 중입니다...", "info");
    try {
      state.promptBundle = await request(
        "GET",
        `/api/v1/me/tampermonkey-episodes/${state.selectedEpisodeId}/prompt-bundle`,
        state.token
      );
      const flattenedItems = getFlattenedPromptItems();
      if (flattenedItems.length) {
        state.batchStartScene = String(flattenedItems[0].sequence_no);
        state.batchEndScene = String(
          flattenedItems[flattenedItems.length - 1].sequence_no
        );
        writeLocalStorage("batchStartScene", state.batchStartScene);
        writeLocalStorage("batchEndScene", state.batchEndScene);
      }
      render();
      setStatus("프롬프트 JSON을 불러왔습니다.", "success");
    } catch (error) {
      setStatus(formatError(error, "프롬프트 JSON을 불러오지 못했습니다."), "error");
    }
  }

  async function loadStyles() {
    if (!state.token) {
      setStatus("먼저 토큰을 저장해 주세요.", "error");
      return;
    }
    setStatus("스타일 목록을 불러오는 중입니다...", "info");
    try {
      state.styles = await request("GET", "/api/v1/me/tampermonkey-styles", state.token);
      render();
      setStatus(`스타일 ${state.styles.length}개를 불러왔습니다.`, "success");
    } catch (error) {
      setStatus(formatError(error, "스타일 목록을 불러오지 못했습니다."), "error");
    }
  }

  async function autoInitialize() {
    if (state.autoLoaded || !state.token) return;
    state.autoLoaded = true;
    try {
      await loadProfile();
      await Promise.all([loadProjects(), loadStyles()]);
    } catch (_) {
      // 개별 함수에서 상태 메시지를 처리합니다.
    }
  }

  async function startBatchGeneration() {
    if (!state.promptBundle) {
      setStatus("먼저 프롬프트 JSON을 불러와 주세요.", "error");
      return;
    }
    const queue = getBatchScenes();
    if (!queue.length) {
      setStatus("선택 범위에 해당하는 장면이 없습니다.", "error");
      return;
    }

    state.batchRunning = true;
    state.stopRequested = false;
    state.seenResultUrls = collectGeneratedImageUrls();
    render();

    const delayMs = Math.max(1000, Number(state.batchDelayMs || 8000));

    try {
      for (const scene of queue) {
        if (state.stopRequested) break;

        const sceneNo = Number(scene.sequence_no || 0);
        const promptText = buildMergedPrompt(scene);
        setStatus(`${sceneNo}번 프롬프트를 Google Flow에 입력하는 중입니다...`, "info");
        injectPromptIntoFlow(promptText);
        const editor = findFlowEditor();
        const editorText = getEditorPlainText(editor);
        if (!editorText) {
          throw new Error("Google Flow 입력창에 프롬프트가 들어가지 않았습니다.");
        }
        await sleep(400);
        await clickCreateButton();
        setStatus(`${sceneNo}번 생성 요청 완료. 결과를 기다리는 중입니다...`, "info");
        const capturedUrl = await waitAndCaptureNewImage(scene, delayMs);
        if (capturedUrl) {
          setStatus(
            state.autoSaveResults
              ? `${sceneNo}번 결과를 감지했고 Lucy에 연결했습니다.`
              : `${sceneNo}번 결과를 감지했습니다.`,
            "success"
          );
        } else {
          setStatus(`${sceneNo}번 결과 URL을 아직 감지하지 못했습니다. 다음 순서로 진행합니다.`, "info");
        }
      }

      if (state.stopRequested) {
        setStatus("배치 생성이 중지되었습니다.", "info");
      } else {
        setStatus("선택한 범위의 배치 생성이 완료되었습니다.", "success");
      }
    } catch (error) {
      setStatus(formatError(error, "배치 생성 중 오류가 발생했습니다."), "error");
    } finally {
      state.batchRunning = false;
      state.stopRequested = false;
      render();
    }
  }

  function formatError(error, fallback) {
    const detail =
      error?.data?.detail?.message ||
      error?.data?.detail ||
      error?.data?.message ||
      error?.data;
    const message = typeof detail === "string" ? detail : "";
    return message ? `${fallback} ${message}` : fallback;
  }

  function showPanel() {
    render();
    document.getElementById(PANEL_ID)?.classList.remove("is-hidden");
  }

  if (globalThis.__LUCY_FLOW_TEST_MODE__) {
    if (typeof globalThis.__LUCY_FLOW_TEST_HOOKS__ === "function") {
      globalThis.__LUCY_FLOW_TEST_HOOKS__({
        findCreateButton,
        clickCreateButton,
        resolveInstalledVersion,
      });
    }
    return;
  }

  GM_registerMenuCommand("Lucy 패널 열기", showPanel);
  GM_registerMenuCommand("Lucy 토큰 다시 입력", () => {
    showPanel();
    const panel = document.getElementById(PANEL_ID);
    const tokenBox = panel?.querySelector('[data-role="token-box"]');
    if (tokenBox) tokenBox.style.display = "block";
    panel?.querySelector('[data-role="token-input"]')?.focus();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", async () => {
      showPanel();
      await autoInitialize();
    });
  } else {
    showPanel();
    void autoInitialize();
  }
})();
