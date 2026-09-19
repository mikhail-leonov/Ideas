/* js/i18n.js — minimal i18n engine. Must load BEFORE the lng/*.js packs and app.js.
   NOTE: this is the ONLY place the engine may be defined. */
window.FT = window.FT || {};
(function (FT) {
  "use strict";

  var packs = {};
  var currentLang = "en";
  var listeners = [];

  function register(code, data) {
    packs[code] = data || { strings: {} };
  }

  function escapeRegExp(s){
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* Interpolate {placeholders}. Uses function replacement so values containing "$&" etc are literal. */
  function interpolate(str, vars) {
    if (!vars) return str;
    Object.keys(vars).forEach(function (k) {
      str = str.replace(new RegExp("\\{" + escapeRegExp(k) + "\\}", "g"), function () {
        return vars[k];
      });
    });
    return str;
  }

  function t(key, vars) {
    var pack = packs[currentLang] || packs.en || { strings: {} };
    var fallback = packs.en || { strings: {} };
    var str = (pack.strings && pack.strings[key]) || (fallback.strings && fallback.strings[key]) || key;
    return interpolate(str, vars);
  }

  function applyToDom(root) {
    var scope = root || document;
    document.documentElement.lang = currentLang;
    document.documentElement.dir = (packs[currentLang] && packs[currentLang].dir) || "ltr";

    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      // Only overwrite if element has no child elements (safe text nodes)
      if(el.children.length === 0) el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
  }

  function setLang(code) {
    if (!packs[code]) return;
    currentLang = code;
    try { localStorage.setItem("ft_lang", code); } catch (e) { /* ignore */ }
    applyToDom();
    listeners.forEach(function (fn) { fn(code); });
  }

  function init() {
    var saved = null;
    try { saved = localStorage.getItem("ft_lang"); } catch (e) { /* ignore */ }
    if (saved && packs[saved]) {
      currentLang = saved;
    } else {
      var nav = ((navigator.language || "en").split("-")[0] || "en").toLowerCase();
      if (packs[nav]) currentLang = nav;
    }
    applyToDom();
  }

  function availableLanguages() {
    return Object.keys(packs).map(function (code) {
      return { code: code, name: packs[code].name, nativeName: packs[code].nativeName };
    });
  }

  function onChange(fn) { listeners.push(fn); }

  FT.I18n = {
    register: register,
    t: t,
    setLang: setLang,
    init: init,
    applyToDom: applyToDom,
    availableLanguages: availableLanguages,
    onChange: onChange,
    getCurrentLang: function () { return currentLang; }
  };
})(window.FT);
