// ==UserScript==
// @name         Lucy Flow Auto Generator Loader
// @namespace    https://lucystar.kr/
// @version      0.2.6
// @description  Lucy Flow 자동 생성 스크립트 로더
// @match        https://labs.google/fx/ko/tools/flow/project/*
// @downloadURL  https://raw.githubusercontent.com/cineraria01/lucy-userscripts/main/lucy-flow-loader.user.js
// @updateURL    https://raw.githubusercontent.com/cineraria01/lucy-userscripts/main/lucy-flow-loader.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @connect      lucystar.kr
// @connect      raw.githubusercontent.com
// ==/UserScript==
// 설치 URL: https://raw.githubusercontent.com/cineraria01/lucy-userscripts/main/lucy-flow-loader.user.js

(function () {
  "use strict";

  const LOADER_VERSION = "0.2.6";
  const REMOTE_SCRIPT_URL =
    "https://raw.githubusercontent.com/cineraria01/lucy-userscripts/main/lucy-flow-auto-generator.js";

  function resolveGrantedGMInfo() {
    if (typeof GM_info !== "undefined" && GM_info) {
      return GM_info;
    }
    return globalThis.GM_info || null;
  }

  function getInstalledVersion() {
    const gmInfo = resolveGrantedGMInfo();
    const runtimeVersion = gmInfo?.script?.version || gmInfo?.version;
    return String(runtimeVersion || LOADER_VERSION).trim() || LOADER_VERSION;
  }

  globalThis.__LUCY_FLOW_INSTALLED_VERSION__ = getInstalledVersion();

  function getRuntimeCacheBuster() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function fetchRemoteScript(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(String(response.responseText || ""));
            return;
          }
          reject(
            new Error(`Lucy loader fetch failed: HTTP ${response.status}`)
          );
        },
        onerror(error) {
          reject(new Error(`Lucy loader network error: ${String(error)}`));
        },
      });
    });
  }

  async function runRemoteScript() {
    const version = encodeURIComponent(getRuntimeCacheBuster());
    const targetUrl = `${REMOTE_SCRIPT_URL}?v=${version}`;
    const source = await fetchRemoteScript(targetUrl);
    const runner = new Function(
      "GM_getValue",
      "GM_setValue",
      "GM_registerMenuCommand",
      "GM_xmlhttpRequest",
      source
    );
    runner(GM_getValue, GM_setValue, GM_registerMenuCommand, GM_xmlhttpRequest);
  }

  runRemoteScript().catch((error) => {
    console.error(error);
    window.alert(
      `Lucy Flow Auto Generator 로드에 실패했습니다.\n${error?.message || error}`
    );
  });
})();
