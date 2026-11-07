// NAME: Smooth Fade
// AUTHOR: stevia7896
// VERSION: 1.1.0
// DESCRIPTION: Volume fade-out at the end of each track and fade-in on the next one. Works without Premium crossfade.

(function SmoothFade() {
    // Wait until the player and volume APIs are actually usable; calling them earlier throws.
    const S = window.Spicetify;
    const P = S?.Player;
    if (
        typeof P?.getVolume !== "function" || typeof P?.setVolume !== "function" ||
        !P?.origin?._state || !S?.Platform?.PlaybackAPI || !S?.LocalStorage || !document.body ||
        typeof P.getVolume() !== "number"
    ) {
        setTimeout(SmoothFade, 300);
        return;
    }

    const TICK_MS = 100;
    const SETTINGS_KEY = "smoothfade:settings";
    const RESTORE_KEY = "smoothfade:restoreVolume"; // user volume saved while a fade is in progress
    const USER_CHANGE_TOLERANCE = 0.05;              // volume drift larger than this = user moved the slider
    const PAUSE_RESTORE_MS = 1500;                    // paused/stopped this long mid-fade -> give volume back

    const DEFAULTS = { enabled: true, fadeOutSec: 6, fadeInSec: 3, skipSameAlbum: true };
    const LIMITS = { fadeOutSec: [1, 12], fadeInSec: [0, 8] };

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function loadSettings() {
        const cfg = { ...DEFAULTS };
        try {
            const saved = JSON.parse(S.LocalStorage.get(SETTINGS_KEY) || "{}");
            if (typeof saved.enabled === "boolean") cfg.enabled = saved.enabled;
            if (typeof saved.skipSameAlbum === "boolean") cfg.skipSameAlbum = saved.skipSameAlbum;
            for (const k of ["fadeOutSec", "fadeInSec"]) {
                const n = Number(saved[k]);
                if (Number.isFinite(n)) cfg[k] = clamp(n, ...LIMITS[k]);
            }
        } catch (_) { /* fall back to defaults */ }
        return cfg;
    }

    const cfg = loadSettings();
    const saveSettings = () => S.LocalStorage.set(SETTINGS_KEY, JSON.stringify(cfg));

    // If Spotify was closed in the middle of a fade, put the user's volume back.
    const pending = parseFloat(S.LocalStorage.get(RESTORE_KEY));
    if (Number.isFinite(pending)) P.setVolume(pending);
    S.LocalStorage.set(RESTORE_KEY, "");

    // ─── State ──────────────────────────────────────────────────────
    let baseVol = P.getVolume();  // the volume the user chose
    let lastSet = null;           // last volume we wrote (null = not controlling volume)
    let prevSet = null;           // the write before that (setVolume is async)
    let fadingOut = false;        // fade-out active on the previous tick
    let armedIn = false;          // current track should fade in
    let suppressUri = null;       // user overrode the fade on this track
    let lastUri = null;
    let lastProgress = 0;
    let pausedSince = null;
    let announcedFade = false;

    // sin curve: smooth at full volume, no lingering near silence
    const curve = (x) => Math.sin(clamp(x, 0, 1) * Math.PI / 2);

    function isExcluded(item, uri) {
        return !uri || uri.startsWith("spotify:ad:") || uri.startsWith("spotify:episode:") ||
            item?.type === "ad" || item?.isAd === true;
    }

    function nextIsSameAlbum() {
        const cur = P.data?.item?.album?.uri;
        const next = S.Queue?.nextTracks?.[0]?.contextTrack?.metadata?.album_uri;
        return !!cur && cur === next && P.getRepeat?.() !== 2;
    }

    function write(v) {
        prevSet = lastSet;
        lastSet = v;
        P.setVolume(v);
    }

    function release() {
        if (lastSet !== null) P.setVolume(baseVol);
        lastSet = prevSet = null;
        S.LocalStorage.set(RESTORE_KEY, "");
    }

    function tick() {
        const item = P.data?.item;
        const uri = item?.uri || null;
        const vol = P.getVolume();
        const p = P.getProgress();
        const d = P.getDuration();
        if (typeof vol !== "number" || !Number.isFinite(p) || !Number.isFinite(d)) return;

        // User moved the volume slider while we were in control: respect it, stop fading this track.
        if (lastSet !== null &&
            Math.abs(vol - lastSet) > USER_CHANGE_TOLERANCE &&
            (prevSet === null || Math.abs(vol - prevSet) > USER_CHANGE_TOLERANCE)) {
            baseVol = vol;
            lastSet = prevSet = null;
            S.LocalStorage.set(RESTORE_KEY, "");
            suppressUri = uri;
            armedIn = fadingOut = false;
            return;
        }

        // Track change (auto-advance or manual skip). Fade in only if we were fading out.
        if (uri !== lastUri) {
            armedIn = fadingOut;
            fadingOut = false;
            suppressUri = null;
            lastUri = uri;
        } else if (fadingOut && p < lastProgress - 3000) {
            // Same track restarted (repeat one, or seek to start during fade-out)
            armedIn = true;
            fadingOut = false;
        }
        lastProgress = p;

        if (!cfg.enabled || isExcluded(item, uri)) {
            release();
            armedIn = fadingOut = false;
            return;
        }

        if (!P.isPlaying()) {
            pausedSince ??= Date.now();
            if (lastSet !== null && Date.now() - pausedSince > PAUSE_RESTORE_MS) {
                release();
                armedIn = fadingOut = false;
            }
            return;
        }
        pausedSince = null;

        const outMs = cfg.fadeOutSec * 1000;
        const inMs = cfg.fadeInSec * 1000;
        let f = 1;
        let outActive = false;

        if (uri !== suppressUri && d > 0) {
            const remaining = d - p;
            if (d > outMs * 3 && remaining < outMs && !(cfg.skipSameAlbum && nextIsSameAlbum())) {
                f = Math.min(f, curve(remaining / outMs));
                outActive = true;
            }
            if (armedIn) {
                if (inMs > 0 && p < inMs) f = Math.min(f, curve(p / inMs));
                else armedIn = false;
            }
        }
        fadingOut = outActive;

        if (f < 1) {
            if (outActive && !announcedFade) {
                announcedFade = true; // one-time confirmation that fading works
                toast("Smooth Fade：开始淡出");
            }
            if (lastSet === null) {
                baseVol = vol; // take control: remember what the user had
                S.LocalStorage.set(RESTORE_KEY, String(baseVol));
            }
            const target = baseVol * f;
            if (lastSet === null || Math.abs(target - lastSet) > 0.003) write(target);
        } else if (lastSet !== null) {
            release();
        } else {
            baseVol = vol; // not fading: keep following the user's volume
        }
    }

    setInterval(() => {
        try { tick(); } catch (e) { console.error("[SmoothFade]", e); }
    }, TICK_MS);

    // ─── Own UI (no dependency on Spicetify UI helpers, which are partly broken on Spotify 1.3.8) ───
    const style = document.createElement("style");
    style.textContent = `
        .sf-toast{position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:2147483647;
            background:#1DB954;color:#000;font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:16px;
            box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .4s;pointer-events:none}
        .sf-panel{position:fixed;top:72px;right:24px;z-index:2147483647;width:300px;padding:18px;border-radius:10px;
            background:#282828;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.6);
            display:flex;flex-direction:column;gap:14px}
        .sf-panel[hidden]{display:none}
        .sf-row{display:flex;justify-content:space-between;align-items:center;gap:12px}
        .sf-title{font-weight:700;font-size:16px}
        .sf-val{color:#1DB954;font-weight:700}
        .sf-panel input[type=range]{width:100%;accent-color:#1DB954}
        .sf-note{font-size:12px;color:#b3b3b3}
        .sf-close{background:none;border:none;color:#b3b3b3;font-size:18px;cursor:pointer;padding:0 4px}
    `;
    document.head.appendChild(style);

    function toast(msg) {
        const el = document.createElement("div");
        el.className = "sf-toast";
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => { el.style.opacity = "0"; }, 3000);
        setTimeout(() => el.remove(), 3500);
    }

    const panel = document.createElement("div");
    panel.className = "sf-panel";
    panel.hidden = true;
    panel.innerHTML = `
        <div class="sf-row"><span class="sf-title">Smooth Fade</span><button class="sf-close" data-sf="close">×</button></div>
        <label class="sf-row"><span>启用淡入淡出</span><input type="checkbox" data-sf="en"></label>
        <div>
            <div class="sf-row"><span>结尾淡出</span><span class="sf-val" data-sf="out-v"></span></div>
            <input type="range" data-sf="out" min="${LIMITS.fadeOutSec[0]}" max="${LIMITS.fadeOutSec[1]}" step="0.5">
        </div>
        <div>
            <div class="sf-row"><span>开头淡入</span><span class="sf-val" data-sf="in-v"></span></div>
            <input type="range" data-sf="in" min="${LIMITS.fadeInSec[0]}" max="${LIMITS.fadeInSec[1]}" step="0.5">
        </div>
        <label class="sf-row"><span>同一张专辑连播时不淡出</span><input type="checkbox" data-sf="album"></label>
        <div class="sf-note">快捷键 Ctrl+Option+F 打开/关闭本面板。淡出过程中拖动音量条，会取消这一首的淡出。</div>`;
    document.body.appendChild(panel);

    const q = (k) => panel.querySelector(`[data-sf="${k}"]`);
    const showVals = () => {
        q("out-v").textContent = cfg.fadeOutSec + "s";
        q("in-v").textContent = cfg.fadeInSec + "s";
    };
    q("close").addEventListener("click", () => { panel.hidden = true; });
    q("en").addEventListener("change", (e) => { cfg.enabled = e.target.checked; saveSettings(); });
    q("album").addEventListener("change", (e) => { cfg.skipSameAlbum = e.target.checked; saveSettings(); });
    q("out").addEventListener("input", (e) => { cfg.fadeOutSec = Number(e.target.value); saveSettings(); showVals(); });
    q("in").addEventListener("input", (e) => { cfg.fadeInSec = Number(e.target.value); saveSettings(); showVals(); });

    function toggleSettings() {
        if (panel.hidden) {
            q("en").checked = cfg.enabled;
            q("album").checked = cfg.skipSameAlbum;
            q("out").value = cfg.fadeOutSec;
            q("in").value = cfg.fadeInSec;
            showVals();
        }
        panel.hidden = !panel.hidden;
    }

    window.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.altKey && e.code === "KeyF") {
            e.preventDefault();
            toggleSettings();
        }
    });

    // Spicetify entry points: best effort, any of them may silently not render on Spotify 1.3.8.
    const ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M1 12h2V4H1v8zm4 2h2V2H5v12zm4-2h2V4H9v8zm4-3h2V7h-2v2z"/></svg>`;
    const LABEL = "Smooth Fade 淡入淡出设置";
    try { if (S.Topbar?.Button) new S.Topbar.Button(LABEL, ICON, toggleSettings); } catch (e) { console.error("[SmoothFade] topbar", e); }
    try { if (S.Playbar?.Button) new S.Playbar.Button(LABEL, ICON, toggleSettings, false, false, true); } catch (e) { console.error("[SmoothFade] playbar", e); }
    try { if (S.Menu?.Item) new S.Menu.Item(LABEL, false, toggleSettings).register(); } catch (e) { console.error("[SmoothFade] menu", e); }

    toast("Smooth Fade 已加载 · Ctrl+Option+F 打开设置");
    console.log("[SmoothFade] loaded", cfg);
})();
