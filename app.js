(() => {
  const DEFAULT_PLAYLIST = "https://iptv-org.github.io/iptv/countries/hk.m3u";
  const CATEGORIES = ["全部", "TVB", "ViuTV", "HOY", "港台", "其他"];
  const state = { channels: [], category: "全部", query: "", favoritesOnly: false, favorites: new Set(JSON.parse(localStorage.getItem("hktv-favorites") || "[]")), visibleLimit: 60, hls: null };
  const $ = id => document.getElementById(id);
  const video = $("video");

  function categoryFor(text) {
    const s = text.toLowerCase();
    if (/tvb|jade|pearl|翡翠|明珠|無線|无线/.test(s)) return "TVB";
    if (/viu/.test(s)) return "ViuTV";
    if (/hoy/.test(s)) return "HOY";
    if (/rthk|港台/.test(s)) return "港台";
    return "其他";
  }
  function attr(line, key) {
    const match = line.match(new RegExp("(?:^|\\s)" + key + '="([^"]*)"'));
    return match ? match[1] : "";
  }
  function parseM3U(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const result = [];
    let pending = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#EXTINF:")) {
        const comma = line.indexOf(",");
        pending = {
          name: comma >= 0 ? line.slice(comma + 1).trim() : "未知頻道",
          group: attr(line, "group-title") || "香港",
          logo: attr(line, "tvg-logo"),
          id: attr(line, "tvg-id")
        };
      } else if (line.startsWith("http") && pending) {
        result.push({
          id: line,
          name: pending.name,
          group: pending.group,
          logo: pending.logo,
          url: line,
          category: categoryFor(pending.name + " " + pending.group)
        });
        pending = null;
      }
    }
    return result;
  }
  function filteredChannels() {
    return state.channels.filter(c => {
      const categoryOK = state.category === "全部" || c.category === state.category;
      const queryOK = !state.query || (c.name + " " + c.group).toLowerCase().includes(state.query.toLowerCase());
      const favOK = !state.favoritesOnly || state.favorites.has(c.id);
      return categoryOK && queryOK && favOK;
    });
  }
  function renderCategories() {
    $("categoryTabs").innerHTML = CATEGORIES.map(c =>
      `<button class="category-tab ${state.category === c && !state.favoritesOnly ? "selected" : ""}" data-category="${escapeHTML(c)}">${escapeHTML(c)}</button>`
    ).join("");
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function renderChannels() {
    const list = filteredChannels();
    $("channelCount").textContent = `${state.channels.length} 個頻道載入`;
    const shown = list.slice(0, state.visibleLimit);
    $("channelGrid").innerHTML = shown.map(c => {
      const logo = c.logo ? `<img src="${escapeHTML(c.logo)}" alt="" loading="lazy" onerror="this.remove()">` : escapeHTML((c.name.match(/[A-Za-z0-9\u4e00-\u9fff]/g) || ["TV"]).slice(0,2).join(""));
      return `<button class="channel-card" data-id="${encodeURIComponent(c.id)}">
        <span class="channel-logo">${logo}</span>
        <span class="channel-info"><span class="channel-name">${escapeHTML(c.name)}</span><span class="channel-group">${escapeHTML(c.group)}</span></span>
        <span class="fav-star" data-fav="${encodeURIComponent(c.id)}" role="button" aria-label="收藏">${state.favorites.has(c.id) ? "★" : "☆"}</span>
      </button>`;
    }).join("");
    $("loadMoreBtn").hidden = list.length <= state.visibleLimit;
    if (!list.length && state.channels.length) $("channelGrid").innerHTML = `<div class="notice">沒有符合條件的頻道。試試其他分類或搜尋字詞。</div>`;
    renderCategories();
  }
  function setNotice(message, show = true) {
    $("notice").hidden = !show;
    $("notice").textContent = message;
  }
  async function loadPlaylist(url) {
    setNotice("正在載入香港頻道清單…");
    $("playerStatus").textContent = "LOADING";
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const channels = parseM3U(text);
      if (!channels.length) throw new Error("M3U 內沒有可識別的頻道項目");
      state.channels = channels;
      state.category = "全部";
      state.query = "";
      state.visibleLimit = 60;
      $("searchInput").value = "";
      localStorage.setItem("hktv-playlist-url", url);
      renderChannels();
      setNotice(`已載入 ${channels.length} 個清單項目。並非所有項目都一定可播放。`, true);
      $("playerStatus").textContent = "READY";
      $("settingsDialog").close();
    } catch (error) {
      $("playerStatus").textContent = "ERROR";
      setNotice(`載入失敗：${error.message}。可能是網絡、CORS 或清單網址問題。你可以稍後重試，或換用可公開讀取的 M3U 網址。`);
    }
  }
  function sourceCandidates(channel) {
    const isJade = /(^|[\s_-])(jade|翡翠台|翡翠)([\s_-]|$)/i.test(channel.name) ||
      /Jade\.hk/i.test(channel.id);
    if (!isJade) return [channel.url];

    // Ordered by preference. These are public stream endpoints found in
    // community IPTV listings; availability can change without notice.
    const candidates = [
      "https://edge6a.v2h-cdn.com/jade/jade.stream/chunklist.m3u8",
      channel.url,
      "http://103.172.187.30:12000/stream/mytv/tvb/master.m3u8"
    ];
    return [...new Set(candidates)];
  }

  let playAttemptToken = 0;
  let attemptTimer = null;

  function clearAttemptTimer() {
    if (attemptTimer) {
      clearTimeout(attemptTimer);
      attemptTimer = null;
    }
  }

  async function playChannel(channel) {
    const token = ++playAttemptToken;
    const sources = sourceCandidates(channel);
    let sourceIndex = 0;

    $("nowTitle").textContent = channel.name;
    $("videoPlaceholder").classList.add("hidden");
    $("playerStatus").textContent = "CONNECTING";
    $("playerMessage").textContent = sources.length > 1
      ? `正在连接直播源（1/${sources.length}），失败时会自动切换备用源。`
      : "正在连接直播源…";

    if (state.hls) { state.hls.destroy(); state.hls = null; }
    clearAttemptTimer();
    video.pause();
    video.removeAttribute("src");
    video.load();

    const failOrNext = (reason) => {
      if (token !== playAttemptToken) return;
      clearAttemptTimer();
      if (state.hls) { state.hls.destroy(); state.hls = null; }

      sourceIndex += 1;
      if (sourceIndex < sources.length) {
        $("playerStatus").textContent = "RETRYING";
        $("playerMessage").textContent =
          `第 ${sourceIndex} 個來源無法播放，正在嘗試備用源（${sourceIndex + 1}/${sources.length}）…`;
        trySource();
      } else {
        $("playerStatus").textContent = "UNAVAILABLE";
        $("playerMessage").textContent =
          `已測試 ${sources.length} 個直播來源，仍無法播放。${reason || "來源可能已失效、被網絡阻擋或有地區限制。"}請稍後重試。`;
        $("videoPlaceholder").classList.remove("hidden");
      }
    };

    const trySource = async () => {
      if (token !== playAttemptToken) return;
      clearAttemptTimer();
      if (state.hls) { state.hls.destroy(); state.hls = null; }
      video.pause();
      video.removeAttribute("src");
      video.load();

      const url = sources[sourceIndex];
      $("playerStatus").textContent = "CONNECTING";
      $("playerMessage").textContent =
        sources.length > 1
          ? `正在測試直播源（${sourceIndex + 1}/${sources.length}）…`
          : "正在連接直播源…";

      let settled = false;
      const cleanup = () => {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
      };
      const onPlaying = () => {
        if (settled || token !== playAttemptToken) return;
        settled = true;
        clearAttemptTimer();
        cleanup();
        $("playerStatus").textContent = "LIVE";
        $("playerMessage").textContent = `播放中 · 來源 ${sourceIndex + 1}/${sources.length}`;
      };
      const onError = () => {
        if (settled || token !== playAttemptToken) return;
        settled = true;
        cleanup();
        failOrNext("播放器回報串流錯誤。");
      };

      video.addEventListener("playing", onPlaying, { once: true });
      video.addEventListener("error", onError, { once: true });

      // Native HLS is preferred on iPad/iPhone Safari.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.load();
      } else if (window.Hls && Hls.isSupported()) {
        state.hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          manifestLoadingTimeOut: 12000,
          levelLoadingTimeOut: 12000,
          fragLoadingTimeOut: 20000
        });
        state.hls.attachMedia(video);
        state.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          if (token === playAttemptToken) state.hls.loadSource(url);
        });
        state.hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal && !settled && token === playAttemptToken) {
            settled = true;
            cleanup();
            failOrNext(data.details || "HLS 串流錯誤。");
          }
        });
      } else {
        settled = true;
        cleanup();
        failOrNext("此瀏覽器不支援此串流格式。");
        return;
      }

      attemptTimer = setTimeout(() => {
        if (settled || token !== playAttemptToken) return;
        settled = true;
        cleanup();
        failOrNext("連線逾時。");
      }, 15000);

      try {
        await video.play();
      } catch (error) {
        if (!settled && token === playAttemptToken) {
          settled = true;
          cleanup();
          failOrNext(error.message || "無法開始播放。");
        }
      }
    };

    trySource();
  }
  $("categoryTabs").addEventListener("click", e => {
    const button = e.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    state.favoritesOnly = false;
    $("favoritesToggle").classList.remove("active");
    $("favoritesToggle").textContent = "☆ 我的收藏";
    state.visibleLimit = 60;
    renderChannels();
  });
  $("channelGrid").addEventListener("click", e => {
    const star = e.target.closest("[data-fav]");
    if (star) {
      e.stopPropagation();
      const id = decodeURIComponent(star.dataset.fav);
      state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
      localStorage.setItem("hktv-favorites", JSON.stringify([...state.favorites]));
      renderChannels();
      return;
    }
    const card = e.target.closest("[data-id]");
    if (!card) return;
    const channel = state.channels.find(c => c.id === decodeURIComponent(card.dataset.id));
    if (channel) playChannel(channel);
  });
  $("searchInput").addEventListener("input", e => {
    state.query = e.target.value;
    state.visibleLimit = 60;
    renderChannels();
  });
  $("favoritesToggle").addEventListener("click", () => {
    state.favoritesOnly = !state.favoritesOnly;
    state.category = "全部";
    $("favoritesToggle").classList.toggle("active", state.favoritesOnly);
    $("favoritesToggle").textContent = state.favoritesOnly ? "★ 我的收藏" : "☆ 我的收藏";
    renderChannels();
  });
  $("loadMoreBtn").addEventListener("click", () => { state.visibleLimit += 60; renderChannels(); });
  $("refreshBtn").addEventListener("click", () => loadPlaylist(localStorage.getItem("hktv-playlist-url") || DEFAULT_PLAYLIST));
  $("settingsBtn").addEventListener("click", () => {
    $("playlistUrl").value = localStorage.getItem("hktv-playlist-url") || DEFAULT_PLAYLIST;
    $("settingsDialog").showModal();
  });
  $("savePlaylistBtn").addEventListener("click", () => {
    const url = $("playlistUrl").value.trim();
    if (!/^https?:\/\//i.test(url)) { setNotice("請輸入有效的 http 或 https M3U 網址。"); return; }
    loadPlaylist(url);
  });
  $("resetPlaylistBtn").addEventListener("click", () => {
    $("playlistUrl").value = DEFAULT_PLAYLIST;
    loadPlaylist(DEFAULT_PLAYLIST);
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  loadPlaylist(localStorage.getItem("hktv-playlist-url") || DEFAULT_PLAYLIST);
})();
