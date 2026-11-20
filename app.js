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
  async function playChannel(channel) {
    $("nowTitle").textContent = channel.name;
    $("playerStatus").textContent = "CONNECTING";
    $("videoPlaceholder").classList.add("hidden");
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    video.pause();
    video.removeAttribute("src");
    video.load();
    const url = channel.url;
    try {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
      } else if (window.Hls && Hls.isSupported()) {
        state.hls = new Hls({ enableWorker: true });
        state.hls.loadSource(url);
        state.hls.attachMedia(video);
        state.hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            $("playerStatus").textContent = "PLAYBACK ERROR";
            $("playerMessage").textContent = "此串流無法播放，可能不支援、已失效或有地區限制。";
          }
        });
      } else {
        throw new Error("此瀏覽器不支援該串流格式");
      }
      await video.play();
      $("playerStatus").textContent = "LIVE";
      $("playerMessage").textContent = "正在嘗試播放。若畫面沒有出現，該來源可能不可用或不支援此裝置。";
    } catch (error) {
      $("playerStatus").textContent = "UNAVAILABLE";
      $("playerMessage").textContent = `無法開始播放：${error.message}。請嘗試其他頻道。`;
      $("videoPlaceholder").classList.remove("hidden");
    }
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
