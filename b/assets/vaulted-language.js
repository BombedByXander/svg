(function () {
  "use strict";

  const attributes = ["title", "placeholder", "aria-label", "aria-description", "alt"];
  const ignored = "script,style,svg,textarea,input,select,option,pre,code,iframe,[translate='no'],[aria-hidden='true']";
  let root = null;
  let observer = null;
  let translator = null;
  let language = "en";
  let generation = 0;
  let running = false;
  const textNodes = new Set();
  const elements = new Set();
  const queuedText = new Set();
  const queuedAttributes = new Map();
  const textState = new WeakMap();
  const attributeState = new WeakMap();

  function status(message, state = "info") {
    window.dispatchEvent(new CustomEvent("vaulted-language-status", { detail: { message, state } }));
  }

  function shouldSkip(element) {
    return !element || Boolean(element.closest?.(ignored));
  }

  function trackText(node) {
    const value = node.data;
    if (!/[A-Za-z]/.test(value) || !value.trim() || shouldSkip(node.parentElement)) return;
    let state = textState.get(node);
    if (state && value === state.rendered) return;
    if (!state) {
      state = { source: value, rendered: value };
      textState.set(node, state);
    } else {
      state.source = value;
      state.rendered = value;
    }
    textNodes.add(node);
    if (language !== "en" && translator) queuedText.add(node);
  }

  function trackAttributes(element) {
    if (shouldSkip(element)) return;
    let map = attributeState.get(element);
    for (const name of attributes) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name) || "";
      if (!/[A-Za-z]/.test(value) || !value.trim()) continue;
      map ||= new Map();
      const old = map.get(name);
      if (old && value === old.rendered) continue;
      if (!old) map.set(name, { source: value, rendered: value });
      else { old.source = value; old.rendered = value; }
      elements.add(element);
      if (language !== "en" && translator) {
        let set = queuedAttributes.get(element);
        if (!set) queuedAttributes.set(element, set = new Set());
        set.add(name);
      }
    }
    if (map) attributeState.set(element, map);
  }

  function scan(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) { trackText(node); return; }
    if (node.nodeType === Node.ELEMENT_NODE) trackAttributes(node);
    if (node.nodeType !== Node.ELEMENT_NODE && node !== root && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) trackText(current);
    if (node.querySelectorAll) node.querySelectorAll("*").forEach(trackAttributes);
  }

  function restore() {
    for (const node of textNodes) {
      if (!node.isConnected) { textNodes.delete(node); continue; }
      const state = textState.get(node);
      if (state && node.data !== state.source) { state.rendered = state.source; node.data = state.source; }
    }
    for (const element of elements) {
      if (!element.isConnected) { elements.delete(element); continue; }
      const map = attributeState.get(element);
      if (!map) continue;
      for (const name of attributes) {
        const state = map.get(name);
        if (state && element.hasAttribute(name) && element.getAttribute(name) !== state.source) {
          state.rendered = state.source;
          element.setAttribute(name, state.source);
        }
      }
    }
  }

  function parts(value) {
    const leading = (value.match(/^\s*/) || [""])[0];
    const trailing = (value.match(/\s*$/) || [""])[0];
    const end = Math.max(leading.length, value.length - trailing.length);
    return { leading, body: value.slice(leading.length, end), trailing };
  }

  function entries() {
    const result = [];
    for (const node of queuedText) {
      const state = textState.get(node);
      if (!node.isConnected || !state) continue;
      const split = parts(state.source);
      if (split.body) result.push({ type: "text", node, state, ...split });
    }
    queuedText.clear();
    for (const [element, names] of queuedAttributes) {
      if (!element.isConnected) continue;
      const map = attributeState.get(element);
      for (const name of names) {
        const state = map?.get(name);
        if (!state || !element.hasAttribute(name)) continue;
        const split = parts(state.source);
        if (split.body) result.push({ type: "attribute", element, name, state, ...split });
      }
    }
    queuedAttributes.clear();
    return result;
  }

  function apply(entry, translated, token) {
    if (token !== generation || !translated) return;
    const current = entry.type === "text" ? entry.node.data : entry.element.getAttribute(entry.name);
    if (!entry.state || entry.state.source !== entry.leading + entry.body + entry.trailing) return;
    const value = entry.leading + translated.trim() + entry.trailing;
    entry.state.rendered = value;
    if (entry.type === "text") {
      if (current === entry.state.source || current === entry.state.rendered) entry.node.data = value;
    } else if (current === entry.state.source || current === entry.state.rendered) {
      entry.element.setAttribute(entry.name, value);
    }
  }

  async function translateBatch(batch, token) {
    const joined = batch.map(item => item.body).join("\n");
    try {
      const output = await translator.translate(joined);
      if (token !== generation) return;
      const lines = String(output).split(/\r?\n/);
      if (lines.length === batch.length) {
        batch.forEach((item, index) => apply(item, lines[index], token));
      } else {
        for (const item of batch) {
          if (token !== generation) return;
          const output = await translator.translate(item.body);
          apply(item, output, token);
        }
      }
    } catch (error) {
      status("Translation stopped. Try selecting the language again.", "error");
      console.warn("[vaulted-language] translation failed", error);
      throw error;
    }
  }

  async function drain(token) {
    if (running) return;
    running = true;
    try {
      while (token === generation) {
        const all = entries();
        if (!all.length) break;
        let batch = [];
        let size = 0;
        for (const entry of all) {
          const cost = entry.body.length;
          if (batch.length && (batch.length >= 16 || size + cost > 1200)) {
            await translateBatch(batch, token);
            batch = [];
            size = 0;
          }
          if (cost > 1800) {
            if (batch.length) await translateBatch(batch, token);
            batch = [];
            size = 0;
            const output = await translator.translate(entry.body);
            apply(entry, output, token);
          } else {
            batch.push(entry);
            size += cost;
          }
        }
        if (batch.length) await translateBatch(batch, token);
      }
      if (token === generation && language !== "en") status("Vaulted is translated on this device.", "ready");
    } catch (_) {
      // The failure message was sent by translateBatch.
    } finally {
      running = false;
      if (token === generation && (queuedText.size || queuedAttributes.size)) queueMicrotask(() => drain(token));
    }
  }

  function schedule() {
    if (language !== "en" && translator && !running) requestAnimationFrame(() => drain(generation));
  }

  function waitForGesture(target, token) {
    status("Click or tap once to download and start this language pack.", "waiting");
    const start = () => {
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("keydown", start, true);
      if (token === generation && target === language) setLanguage(target);
    };
    window.addEventListener("pointerdown", start, { capture: true, once: true });
    window.addEventListener("keydown", start, { capture: true, once: true });
  }

  async function setLanguage(next) {
    const target = String(next || "en");
    const token = ++generation;
    language = target;
    translator?.destroy?.();
    translator = null;
    queuedText.clear();
    queuedAttributes.clear();
    restore();
    document.documentElement.lang = target;
    document.documentElement.dir = target === "ar" ? "rtl" : "ltr";
    if (target === "en") { status("English is selected.", "ready"); return; }
    if (!("Translator" in window)) {
      status("On-device translation is not available in this browser. Use Chrome on desktop.", "error");
      return;
    }
    status("Preparing on-device translation…", "loading");
    try {
      const availability = await Translator.availability({ sourceLanguage: "en", targetLanguage: target });
      if (token !== generation) return;
      if (availability === "unavailable") {
        status("This language is not supported by your browser's translation model.", "error");
        return;
      }
      if (availability !== "available" && !navigator.userActivation?.isActive) {
        waitForGesture(target, token);
        return;
      }
      translator = await Translator.create({
        sourceLanguage: "en",
        targetLanguage: target,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", event => {
            if (token === generation) status(`Downloading language pack… ${Math.round(event.loaded * 100)}%`, "loading");
          });
        }
      });
      if (token !== generation) { translator?.destroy?.(); return; }
      for (const node of textNodes) queuedText.add(node);
      for (const element of elements) {
        const map = attributeState.get(element);
        if (map) queuedAttributes.set(element, new Set(map.keys()));
      }
      status("Translating Vaulted on this device…", "loading");
      await drain(token);
    } catch (error) {
      if (token === generation) status("Translation could not start. Try selecting the language again.", "error");
      console.warn("[vaulted-language] could not create translator", error);
    }
  }

  function attach(shadowRoot, initialLanguage = "en") {
    if (!shadowRoot || root === shadowRoot) return;
    root = shadowRoot;
    scan(root);
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData") trackText(record.target);
        else if (record.type === "attributes") trackAttributes(record.target);
        else record.addedNodes.forEach(scan);
      }
      schedule();
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
    setLanguage(initialLanguage);
  }

  window.VaultedLanguage = { attach, setLanguage, getLanguage: () => language };
})();
