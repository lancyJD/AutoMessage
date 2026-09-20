// content.js —— SuperDM-SendTest
// 仅植入「源文件发送机制」中真正发文字私信的部分：MQTT（edge-chat.instagram.com）。
// 原版 inject.c3f17983.js 的 c 函数（sendMessageBySocket）就是这样发文字的。
// 修复：补 .catch 保底、幂等防重、详细日志回传 popup。

(function () {
  'use strict';

  // 幂等：manifest content_scripts 已注入时，兜底注入不要重复注册
  if (window.__sdt_loaded) { console.log('[SuperDM-SendTest] already loaded'); return; }
  window.__sdt_loaded = true;

  function report(text) {
    console.log('[SuperDM-SendTest]', text);
    try { chrome.runtime.sendMessage({ type: 'SDM_LOG', text }); } catch (_) {}
  }

  // ---- 原版自带 Paho MQTT 客户端（模块 4558）----
  var PahoMQTT = (function () {
    var m = { exports: {} };
    window.PahoFactory(m, m.exports, {});
    return m.exports;
  })();
  var a = (typeof PahoMQTT === 'function') ? PahoMQTT(window.localStorage || {}) : PahoMQTT;

  function h() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ---- 源文件 c 函数忠实复刻：MQTT 发送文字 ----
  function sendTextMqtt(threadId, viewerId, text, user) {
    return new Promise((resolve) => {
      if (!a || !a.Client || !a.Message) {
        return resolve({ ok: false, level: 'conn', error: 'Paho 客户端未就绪（paho-src.js 可能没加载）' });
      }
      let done = false, acked = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };

      let client;
      try {
        client = new a.Client('edge-chat.instagram.com', 443, '/chat', 'mqttwsclient');
      } catch (e) {
        return resolve({ ok: false, level: 'conn', error: 'MQTT Client 构造失败: ' + (e && e.message) });
      }

      client.onConnectionLost = function (e) {
        const code = e && e.errorCode;
        const msg = e && e.errorMessage ? e.errorMessage : 'mqtt connection lost';
        report(`onConnectionLost code=${code} msg=${msg}`);
        // 已收到 IG 回执（item_ack）后连接被关，属正常处理完毕，不算失败、不重试
        if (acked) return;
        // code 0 = 服务端干净关闭且未收到任何回执，属真正连接级失败，可重试
        finish({ ok: false, level: 'conn', error: (code === 0 ? 'AMQJSC0000I OK.（连接被干净关闭，未收到回执）' : msg) });
      };
      client.onMessageArrived = function (msg) {
        report('onMessageArrived: ' + msg.payloadString);
        acked = true;
        try { client.disconnect(); } catch (_) {}
        let t;
        try { t = JSON.parse(msg.payloadString); } catch (_) { return finish({ ok: false, level: 'ack', error: 'bad mqtt response' }); }
        if ('200' == t.status_code) {
          finish({ ok: true, level: 'ack' });
        } else {
          const code = parseInt(t.status_code) || 999;
          const face = (t.payload && (t.payload.client_facing_error_message || t.payload.message)) || t.message || 'send message failed';
          const igCode = t.payload && t.payload.error_code;
          finish({ ok: false, level: 'ack', error: code + ': ' + face, igErrorCode: igCode });
        }
      };

      const connectOpts = {
        mqttVersion: 3,
        useSSL: true,
        keepAliveInterval: 10,
        userName: JSON.stringify({
          u: viewerId,
          s: Math.random() * Number.MAX_SAFE_INTEGER,
          cp: 1, ecp: 0, chat_on: true, fg: true,
          d: '08422231-8ac1-43f2-b2df-b6afc412f663',
          ct: 'cookie_auth', mqtt_sid: '', aid: 936619743392459,
          st: [], pm: [], dc: '', no_auto_fg: true,
          asi: { 'Accept-Language': 'en' },
          // 与原版逐字符一致（注意双层括号）
          a: 'Mozilla/5.0 ((Windows NT 10.0; Win64; x64)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
        }),
        onSuccess: function () {
          report('mqtt connected (onSuccess)');
          const m = new a.Message(JSON.stringify({
            client_context: h(),
            action: 'send_item',
            item_type: 'text',
            mutation_token: h(),
            text: text,
            thread_id: threadId,
          }));
          m.destinationName = '/ig_send_message';
          try { client.send(m); report('message sent to /ig_send_message'); }
          catch (e) { finish({ ok: false, level: 'conn', error: 'MQTT send 失败: ' + (e && e.message) }); }
        },
        onFailure: function (e) {
          const msg = (e && e.errorMessage) || 'mqtt connect failed';
          report('onFailure: ' + msg);
          finish({ ok: false, level: 'conn', error: msg });
        },
      };

      try {
        report('connecting edge-chat.instagram.com ...');
        client.connect(connectOpts);
      } catch (e) { finish({ ok: false, level: 'conn', error: 'connect exception: ' + (e && e.message) }); }

      setTimeout(() => finish({ ok: false, level: 'conn', error: 'mqtt timeout (20s)' }), 20000);
    });
  }

  // ---- 供 popup 调用 ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SDM_PING') { sendResponse({ ok: true, pong: true }); return false; }
    if (msg.type === 'SDM_SEND') {
      report('SDM_SEND -> ' + (msg.user && msg.user.username) + ' thread ' + msg.threadId);
      Promise.resolve()
        .then(() => sendTextMqtt(msg.threadId, msg.viewerId, msg.message, msg.user))
        .then(r => sendResponse({ ok: r.ok, error: r.error, user: msg.user }))
        .catch(e => sendResponse({ ok: false, error: 'mqtt exception: ' + (e && e.message), user: msg.user }));
      return true;
    }
  });

  report('SuperDM-SendTest content script loaded');
})();