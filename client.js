window.__ModuleLoader__.load({
  id: "dsh-novel-comment",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    /* remote contract mirrors lib/remote-contract.js */
    const scalar = (v) => ({ parse: (x) => { v(x); return x; }, safeParse: (x) => { try { v(x); return { success: true, data: x }; } catch (e) { return { success: false, error: e }; } } });
    const sid = scalar((v) => { if (typeof v !== "string" || !v) throw new Error("bad sessionId"); });
    const obj = scalar((v) => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("bad options"); });
    const res = scalar((v) => { if (!v || typeof v !== "object") throw new Error("bad result"); });
    const codec = (t, s) => ({ mode: "strict", typeSymbol: t, create: () => s });
    const param = (n, s) => ({ name: n, wire: n, source: "json", codec: codec(n, s) });
    const invoke = (m, ps) => ({ id: `dsh-novel-comment#readerPanel/${m}`, namespace: "readerPanel", service: "readerPanel", method: m, invocation: { kind: "direct" }, parameters: [param("sessionId", sid), ...ps], result: codec("ReaderResult", res) });
    const REMOTE = { package: "dsh-novel-comment", descriptors: [
      invoke("status", []), invoke("createReader", [param("options", obj)]), invoke("importChapter", [param("options", obj)]),
      invoke("rateChapter", [param("options", obj)]), invoke("reviewChapter", [param("options", obj)]),
      invoke("report", [param("options", obj)]), invoke("discover", [param("options", obj)]),
      invoke("importUrl", [param("options", obj)]), invoke("tags", []), invoke("search", [param("options", obj)]),
      invoke("updateTaste", [param("options", obj)]), invoke("shelfAdd", [param("options", obj)]), invoke("comments", [param("options", obj)]),
    ] };

    const THEME_KEY = "dsh-novel-comment.theme";
    const THEMES = [
      { id: "paper", label: "纸白", bg: "#f6f5f1", card: "#ffffff", softer: "#f1efe9", ink: "#292f2b", muted: "#676c64", faint: "#7f837b", line: "#e8e7e0", accent: "#425f55", star: "#d5a64c", danger: "#b7655c", ok: "#4f8a6d", warn: "#c58a3d", glow: "rgba(66,95,85,.06)", onAccent: "#ffffff" },
      { id: "cream", label: "米黄", bg: "#f8f1df", card: "#fffaf0", softer: "#f0e6cf", ink: "#3b3327", muted: "#665b4b", faint: "#837662", line: "#e4d7bb", accent: "#8a6134", star: "#c58a2e", danger: "#a75c52", ok: "#5c7d4f", warn: "#b5762f", glow: "rgba(138,97,52,.08)", onAccent: "#ffffff" },
      { id: "green", label: "护眼绿", bg: "#e9f1e4", card: "#f7fbf3", softer: "#dde9d6", ink: "#28372a", muted: "#566451", faint: "#73806b", line: "#cfdec6", accent: "#3f6b45", star: "#b8873a", danger: "#a05a52", ok: "#3f7a4c", warn: "#a9822f", glow: "rgba(63,107,69,.07)", onAccent: "#ffffff" },
      { id: "night", label: "夜间", bg: "#1f2327", card: "#272c31", softer: "#2f353b", ink: "#e8eae7", muted: "#a4aba3", faint: "#7d857e", line: "#3a4148", accent: "#7fb08a", star: "#d8b264", danger: "#d08a80", ok: "#88c79a", warn: "#d8a15a", glow: "rgba(127,176,138,.10)", onAccent: "#12201a" },
    ];
    const readTheme = () => {
      try {
        const saved = window.localStorage.getItem(THEME_KEY);
        return THEMES.some((t) => t.id === saved) ? saved : "paper";
      } catch { return "paper"; }
    };
    const palette = (id) => {
      const found = THEMES.find((t) => t.id === id) ?? THEMES[0];
      return { ...found, sans: '"Microsoft YaHei","PingFang SC",system-ui,sans-serif' };
    };
    const unwrap = (r) => { if (r && r.ok === false) throw new Error(r.error?.message ?? r.message ?? "remote 调用失败"); return r?.data ?? r; };
    const SHADOW = "0 2px 8px rgba(40,45,40,.05)";

    const makeStyles = (T) => ({
      root: { padding: "14px 14px 20px", background: T.bg, color: T.ink, fontFamily: T.sans, fontSize: 13, height: "100%", overflowY: "auto", boxSizing: "border-box" },
      head: { display: "flex", alignItems: "center", gap: 8, marginBottom: 2, position: "sticky", top: 0, zIndex: 2, background: T.bg, paddingBottom: 6 },
      title: { fontWeight: 700, fontSize: 16, letterSpacing: ".2px" },
      sub: { color: T.muted, fontSize: 11.5, margin: "0 0 10px" },
      iconBtn: { border: `1px solid ${T.line}`, background: T.card, color: T.ink, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12, fontFamily: T.sans, minHeight: 28 },
      tabs: { display: "flex", gap: 2, background: T.softer, borderRadius: 10, padding: 3, marginBottom: 12 },
      tab: (on) => ({ flex: 1, border: 0, background: on ? T.card : "transparent", color: on ? T.ink : T.muted, borderRadius: 8, padding: "6px 0", fontSize: 12, fontWeight: on ? 600 : 400, cursor: "pointer", fontFamily: T.sans, boxShadow: on ? SHADOW : "none" }),
      card: { background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: SHADOW },
      label: { color: T.muted, fontSize: 12, margin: "10px 0 5px" },
      input: { width: "100%", boxSizing: "border-box", border: `1px solid ${T.line}`, borderRadius: 8, padding: "7px 9px", fontSize: 12.5, fontFamily: T.sans, background: T.card, color: T.ink },
      row: { display: "flex", gap: 6, alignItems: "center" },
      primary: { border: 0, background: T.accent, color: T.onAccent, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, cursor: "pointer", fontFamily: T.sans, minHeight: 28 },
      ghost: { border: `1px solid ${T.line}`, background: T.card, color: T.ink, borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: T.sans, minHeight: 28 },
      star: (on) => ({ border: 0, background: "transparent", color: on ? T.star : T.faint, fontSize: 22, cursor: "pointer", padding: "0 2px", lineHeight: 1 }),
      chip: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 999, background: T.softer, color: T.muted, marginRight: 4 },
      error: { background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: 12, color: T.danger, fontSize: 12, whiteSpace: "pre-wrap", marginBottom: 10 },
      ok: { color: T.ok, fontSize: 12, margin: "2px 0 8px" },
      empty: { color: T.muted, fontSize: 12.5, padding: "14px 4px", lineHeight: 1.6 },
      pre: { background: T.softer, border: `1px solid ${T.line}`, borderRadius: 10, padding: 10, fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.6, maxHeight: 320, overflow: "auto", margin: 0 },
      avatar: (on) => ({ width: 28, height: 28, borderRadius: "50%", flex: "none", background: on ? T.accent : T.softer, color: on ? T.onAccent : T.muted, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }),
      readerBtn: (on) => ({ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.glow : T.card, borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontFamily: T.sans, color: T.ink, marginBottom: 6 }),
    });

    /** 六类标签选择器：喜好/雷点两种模式，支持别名搜索与自定义标签 */
    function TagPicker({ S, T, catalog, liked, disliked, onLiked, onDisliked }) {
      const [mode, setMode] = React.useState("liked");
      const [query, setQuery] = React.useState("");
      const [custom, setCustom] = React.useState("");
      const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
      const aliases = catalog?.aliases ?? {};
      const selected = mode === "liked" ? liked : disliked;
      const setSelected = mode === "liked" ? onLiked : onDisliked;
      const q = query.trim().toLowerCase();
      const aliasNames = (tag) => Object.entries(aliases).filter(([, v]) => v === tag).map(([k]) => k);
      const toggle = (tag) => setSelected(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
      const addCustom = () => {
        const value = custom.trim();
        if (!value) return;
        const canonical = Object.entries(aliases).find(([k]) => k.toLowerCase() === value.toLowerCase())?.[1];
        const next = canonical ?? value;
        if (!selected.includes(next)) setSelected([...selected, next]);
        setCustom("");
      };
      const chip = (tag) => {
        const on = selected.includes(tag);
        const alias = aliasNames(tag);
        return h("button", {
          key: tag, type: "button", onClick: () => toggle(tag),
          title: alias.length ? `别名：${alias.join(" / ")}` : tag,
          style: { ...S.chip, cursor: "pointer", minHeight: 24, marginBottom: 2, border: `1px solid ${on ? T.accent : "transparent"}`, background: on ? T.accent : T.softer, color: on ? T.onAccent : T.muted },
        }, tag);
      };
      const visible = categories
        .map((category) => ({ ...category, tags: category.tags.filter((tag) => !q || tag.toLowerCase().includes(q) || aliasNames(tag).some((alias) => alias.toLowerCase().includes(q))) }))
        .filter((category) => !q || category.tags.length > 0);
      return h("div", null,
        h("div", { style: { display: "flex", gap: 4, alignItems: "center", marginBottom: 6 } },
          h("button", { type: "button", onClick: () => setMode("liked"), style: { ...S.ghost, padding: "3px 10px", background: mode === "liked" ? T.accent : T.card, color: mode === "liked" ? T.onAccent : T.ink, border: `1px solid ${mode === "liked" ? T.accent : T.line}` } }, `喜好 ${liked.length}`),
          h("button", { type: "button", onClick: () => setMode("disliked"), style: { ...S.ghost, padding: "3px 10px", background: mode === "disliked" ? T.danger : T.card, color: mode === "disliked" ? T.onAccent : T.ink, border: `1px solid ${mode === "disliked" ? T.danger : T.line}` } }, `雷点 ${disliked.length}`),
          h("input", { style: { ...S.input, flex: 1, padding: "5px 8px" }, value: query, onChange: (e) => setQuery(e.target.value), placeholder: "搜标签或别名" })),
        h("div", { style: { fontSize: 11, color: T.muted, marginBottom: 5 } }, mode === "liked" ? "点标签加入「喜好」；找书时按喜好匹配" : "点标签加入「雷点」；找书时硬排除"),
        h("div", { style: { maxHeight: 190, overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: 10, padding: 8, background: T.card } },
          categories.length === 0
            ? h("div", { style: { ...S.empty, padding: 4 } }, "标签目录还没加载，点右上角刷新")
            : visible.map((category) => h("div", { key: category.id, style: { marginBottom: 6 } },
                h("div", { style: { fontSize: 11, color: T.muted, margin: "2px 0 4px" } }, category.label),
                h("div", { style: { display: "flex", flexWrap: "wrap", gap: 4 } }, category.tags.map(chip)))),
          q && visible.length === 0 ? h("div", { style: { ...S.empty, padding: 4 } }, `没有匹配「${query}」的标签，可以自己加一个`) : null),
        h("div", { style: { display: "flex", gap: 4, marginTop: 6 } },
          h("input", { style: { ...S.input, flex: 1, padding: "5px 8px" }, value: custom, onChange: (e) => setCustom(e.target.value), placeholder: "自定义标签（回车添加）", onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } } }),
          h("button", { type: "button", style: S.ghost, onClick: addCustom }, "添加")),
        selected.length
          ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 } }, selected.map((tag) => h("button", { key: `sel-${tag}`, type: "button", onClick: () => toggle(tag), style: { ...S.chip, cursor: "pointer", background: T.glow, color: T.ink, border: `1px solid ${T.line}` } }, `${tag} ×`)))
          : null);
    }

    function ReaderPanel({ sessionId, remote }) {
      const [phase, setPhase] = React.useState("loading");
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [toast, setToast] = React.useState("");
      const [tab, setTab] = React.useState("book");
      const [busy, setBusy] = React.useState(false);
      const [readerId, setReaderId] = React.useState("");
      const [bookId, setBookId] = React.useState("");
      const [chapterId, setChapterId] = React.useState("");
      const [stars, setStars] = React.useState(0);
      const [comment, setComment] = React.useState("");
      const [segQuote, setSegQuote] = React.useState("");
      const [segComment, setSegComment] = React.useState("");
      const [status, setStatus] = React.useState("follow");
      const [dropReason, setDropReason] = React.useState("slow_pacing");
      const [newName, setNewName] = React.useState("");
      const [newPersona, setNewPersona] = React.useState("");
      const [showCreate, setShowCreate] = React.useState(false);
      const [newLiked, setNewLiked] = React.useState([]);
      const [newDisliked, setNewDisliked] = React.useState([]);
      const [narrow, setNarrow] = React.useState(false);
      const [imp, setImp] = React.useState({ bookId: "", bookTitle: "", chapterId: "c1", sequenceNumber: 1, chapterTitle: "第一章", content: "" });
      const [reportDate, setReportDate] = React.useState("");
      const [reportText, setReportText] = React.useState("");
      const [reportFile, setReportFile] = React.useState("");
      const [found, setFound] = React.useState(null);
      const [uil, setUil] = React.useState({ bookId: "", bookTitle: "", chapterId: "c1", sequenceNumber: 1, chapterTitle: "第一章", url: "" });
      const [themeId, setThemeId] = React.useState(readTheme);
      const [catalog, setCatalog] = React.useState({ categories: [], aliases: {} });
      const [findTags, setFindTags] = React.useState([]);
      const [findExclude, setFindExclude] = React.useState([]);
      const [findMeta, setFindMeta] = React.useState(null);
      const [learned, setLearned] = React.useState({});
      const [tagEditor, setTagEditor] = React.useState("");
      const [editLiked, setEditLiked] = React.useState([]);
      const [editDisliked, setEditDisliked] = React.useState([]);
      const T = palette(themeId);
      const S = React.useMemo(() => makeStyles(T), [themeId]);
      const chooseTheme = React.useCallback((next) => {
        setThemeId(next);
        try { window.localStorage.setItem(THEME_KEY, next); } catch { /* 存储不可用时只影响记忆，不影响本次显示 */ }
      }, []);

      const run = React.useCallback(async (fn, okText) => {
        setBusy(true); setError(null); setToast("");
        try { const v = await fn(); if (okText) setToast(okText); return v; }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
        finally { setBusy(false); }
      }, []);

      const load = React.useCallback(async () => {
        if (!remote || !sessionId) { setError("面板服务还没挂载（remote.readerPanel 未注册）；请刷新或重装插件。"); setPhase("error"); return; }
        setPhase("loading");
        try { setData(unwrap(await remote.status(sessionId))); setPhase("ready"); setError(null); }
        catch (e) { setPhase("error"); setError(`读取失败：${e instanceof Error ? e.message : String(e)}`); }
      }, [remote, sessionId]);
      React.useEffect(() => { load(); }, [load]);
      React.useEffect(() => {
        if (!remote || !sessionId) return undefined;
        let alive = true;
        (async () => {
          try {
            const value = unwrap(await remote.tags(sessionId));
            if (alive && value && Array.isArray(value.categories) && value.categories.length) setCatalog(value);
          } catch (e) {
            console.error("[novel-reader] 标签目录读取失败", e);
          }
        })();
        return () => { alive = false; };
      }, [remote, sessionId]);
      React.useEffect(() => {
        const on = () => setNarrow(window.innerWidth < 380);
        on();
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
      }, []);

      const readers = Array.isArray(data?.readers) ? data.readers : [];
      const books = Array.isArray(data?.books) ? data.books : [];
      const quota = data?.quota ?? {};
      const ratings = Array.isArray(data?.recentRatings) ? data.recentRatings : [];
      const currentBook = books.find((b) => b.bookId === bookId) ?? books[0];
      const chapters = currentBook?.chapters ?? [];
      const effReader = readerId || readers[0]?.id || "";
      const effBook = currentBook?.bookId || "";
      const effChapter = chapterId || chapters[0]?.chapterId || "";
      const selReader = readers.find((r) => r.id === effReader);
      const selBook = books.find((b) => b.bookId === effBook);
      const selChapter = chapters.find((c) => c.chapterId === effChapter);

      const create = () => run(async () => {
        if (!newName.trim() || !newPersona.trim()) throw new Error("填名字和一句话人设");
        const r = unwrap(await remote.createReader(sessionId, { name: newName.trim(), persona: newPersona.trim(), likedTags: newLiked, dislikedTags: newDisliked }));
        setNewName(""); setNewPersona(""); setNewLiked([]); setNewDisliked([]); await load(); return r;
      }, "读者已创建");
      const template = (templateId) => run(async () => { const r = unwrap(await remote.createReader(sessionId, { templateId })); await load(); return r; }, "读者已创建");
      const doImport = () => run(async () => {
        const r = unwrap(await remote.importChapter(sessionId, { ...imp, sequenceNumber: Number(imp.sequenceNumber) || 1 }));
        await load(); setImp({ ...imp, content: "", chapterId: "" }); return r;
      }, "章节已导入");
      const doRate = () => run(async () => {
        if (!effReader || !effBook || !effChapter) throw new Error("先选读者、书和章");
        if (!stars) throw new Error("先点星级");
        if (!comment.trim()) throw new Error("写一句章评");
        const r = unwrap(await remote.rateChapter(sessionId, { readerId: effReader, bookId: effBook, chapterId: effChapter, stars, comment: comment.trim(), status, ...(status === "drop" ? { dropReasonCode: dropReason } : {}), ...(segQuote.trim() && segComment.trim() ? { segments: [{ quote: segQuote.trim(), comment: segComment.trim() }] } : {}) }));
        await load(); setStars(0); setComment(""); setSegQuote(""); setSegComment(""); return r;
      }, "评分已记录");
      const doReview = () => run(async () => {
        if (!effReader || !effBook || !effChapter) throw new Error("先选读者、书和章");
        const r = unwrap(await remote.reviewChapter(sessionId, { readerId: effReader, bookId: effBook, chapterId: effChapter }));
        await load(); return r;
      }, "读者评审完成");
      const doReport = (write = false) => run(async () => { const r = unwrap(await remote.report(sessionId, { date: reportDate || undefined, write })); setReportText(r.markdown ?? ""); setReportFile(r.file ?? ""); await load(); return r; }, write ? "日报已保存" : "");
      const doImportUrl = () => run(async () => {
        for (const k of ["bookId", "bookTitle", "chapterId", "chapterTitle", "url"]) if (!String(uil[k] || "").trim()) throw new Error(`填一下 ${k}`);
        const r = unwrap(await remote.importUrl(sessionId, { ...uil, sequenceNumber: Number(uil.sequenceNumber) || 1 }));
        await load(); return r;
      }, "已从链接导入");
      const doFind = () => run(async () => {
        if (!effReader) throw new Error("先创建一个读者");
        const r = unwrap(await remote.discover(sessionId, { readerId: effReader, limit: 3 }));
        setFound(Array.isArray(r.books) ? r.books : []);
        setFindMeta({ searchedTags: r.searchedTags ?? [], unknownTags: [] });
        return r;
      }, "找书完成");
      const doTagSearch = () => run(async () => {
        if (!findTags.length && !findExclude.length) throw new Error("至少选一个标签（喜好或雷点）");
        const r = unwrap(await remote.search(sessionId, { readerId: effReader || undefined, tags: findTags, excludeTags: findExclude, limit: 5 }));
        setFound(Array.isArray(r.books) ? r.books : []);
        setFindMeta({ searchedTags: r.searchedTags ?? [], unknownTags: r.unknownTags ?? [] });
        return r;
      }, "按标签找书完成");
      const doShelfAdd = (book) => run(async () => {
        const r = unwrap(await remote.shelfAdd(sessionId, { bookId: book.bookId, title: book.title ?? book.bookId, author: book.author, tags: book.tags ?? [], sourceId: book.sourceId, sourceSite: book.sourceSite }));
        await load(); return r;
      }, "已加入书架（只存书目，不存正文）");
      const doLearn = (book, chapterId) => run(async () => {
        const r = unwrap(await remote.comments(sessionId, { bookId: book.bookId, chapterId: chapterId || "c1" }));
        setLearned((prev) => ({ ...prev, [book.bookId]: r }));
        return r;
      }, "已读取评论区观察");
      const startTagEdit = (reader) => {
        setTagEditor(reader.id);
        setEditLiked(Array.isArray(reader.likedTags) ? reader.likedTags : []);
        setEditDisliked(Array.isArray(reader.dislikedTags) ? reader.dislikedTags : []);
      };
      const saveTagEdit = () => run(async () => {
        if (!tagEditor) throw new Error("先选读者");
        const r = unwrap(await remote.updateTaste(sessionId, { readerId: tagEditor, likedTags: editLiked, dislikedTags: editDisliked }));
        setTagEditor(""); await load(); return r;
      }, "口味标签已更新");

      const tabBtn = (id, label) => h("button", { key: id, type: "button", style: S.tab(tab === id), onClick: () => setTab(id) }, label);
      const starsRow = h("div", { style: S.row, marginTop: 2 }, [1, 2, 3, 4, 5].map((n) => h("button", { key: n, type: "button", style: S.star(stars >= n), onClick: () => setStars(n), title: `${n} 星` }, "★")));

      const profilePane = h(React.Fragment, null,
        readers.length === 0 ? h("div", { style: S.card }, h("div", { style: S.empty }, "还没有读者档案。创建一个属于你的阅读人格。"))
          : h("div", { style: S.card }, h("div", { style: S.label, marginTop: 0 }, "读者档案（跨书共享）"),
              readers.map((r) => h("button", { key: r.id, type: "button", style: S.readerBtn(r.id === effReader), onClick: () => setReaderId(r.id) },
                h("span", { style: S.avatar(r.id === effReader) }, String(r.name ?? "?").slice(0, 1)),
                h("span", { style: { flex: 1, minWidth: 0 } },
                  h("div", { style: { fontSize: 12.5, fontWeight: 600 } }, String(r.name ?? r.id)),
                  h("div", { style: { color: T.muted, fontSize: 11 } }, `口味 ${String(r.tasteVersion ?? "").slice(0, 6) || "—"} · ${r.status}`)),
                h("span", { style: { width: 7, height: 7, borderRadius: "50%", background: r.status === "active" ? T.ok : T.warn, flex: "none" } })))),
        selReader ? h("div", { style: { ...S.card, padding: "10px 12px" } },
          h("div", { style: { display: "flex", alignItems: "center", marginBottom: 4 } },
            h("div", { style: { ...S.label, margin: 0 } }, `${selReader.name} 的口味`),
            h("button", { type: "button", style: { ...S.iconBtn, marginLeft: "auto", padding: "2px 8px" }, onClick: () => startTagEdit(selReader) }, "改口味")),
          h("div", { style: { fontSize: 11.5, color: T.muted, marginBottom: 2 } }, `喜好 ${Array.isArray(selReader.likedTags) ? selReader.likedTags.length : 0} · 雷点 ${Array.isArray(selReader.dislikedTags) ? selReader.dislikedTags.length : 0}`),
          Array.isArray(selReader.likedTags) && selReader.likedTags.length ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 } }, selReader.likedTags.map((tag) => h("span", { key: `l-${tag}`, style: S.chip }, String(tag)))) : null,
          Array.isArray(selReader.dislikedTags) && selReader.dislikedTags.length ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 } }, selReader.dislikedTags.map((tag) => h("span", { key: `d-${tag}`, style: { ...S.chip, color: T.danger } }, String(tag)))) : null) : null,
        tagEditor ? h("div", { style: S.card },
          h("div", { style: { ...S.label, marginTop: 0, display: "flex", alignItems: "center" } }, `编辑口味标签 · ${readers.find((r) => r.id === tagEditor)?.name ?? tagEditor}`, h("button", { type: "button", style: { ...S.iconBtn, marginLeft: "auto", padding: "2px 8px" }, onClick: () => setTagEditor("") }, "取消")),
          h(TagPicker, { S, T, catalog, liked: editLiked, disliked: editDisliked, onLiked: setEditLiked, onDisliked: setEditDisliked }),
          h("button", { type: "button", style: { ...S.primary, marginTop: 8, width: "100%" }, onClick: saveTagEdit, disabled: busy }, "保存口味标签")) : null,
        h("button", { type: "button", style: { ...S.primary, width: "100%", marginBottom: 10 }, onClick: () => setShowCreate(true) }, `＋ 新建读者（${readers.length}/8）`),
        h("div", { style: { ...S.card, display: showCreate ? "block" : "none" } },
          h("div", { style: { ...S.label, marginTop: 0, display: "flex", alignItems: "center" } }, `新建读者（${readers.length}/8）`, h("button", { type: "button", style: { ...S.iconBtn, marginLeft: "auto", padding: "2px 8px" }, onClick: () => setShowCreate(false) }, "收起")),
          h("div", { style: { display: "flex", gap: 6, marginBottom: 8 } },
            h("button", { type: "button", style: S.ghost, onClick: () => template("binge"), disabled: busy }, "追更型"),
            h("button", { type: "button", style: S.ghost, onClick: () => template("emotion"), disabled: busy }, "情绪型"),
            h("button", { type: "button", style: S.ghost, onClick: () => template("plot"), disabled: busy }, "剧情型")),
          h("input", { style: S.input, value: newName, onChange: (e) => setNewName(e.target.value), placeholder: "名字：追更的阿追" }),
          h("div", { style: { height: 6 } }),
          h("input", { style: S.input, value: newPersona, onChange: (e) => setNewPersona(e.target.value), placeholder: "一句话人设：急性子，只看爽点" }),
          h("div", { style: { height: 8 } }),
          h(TagPicker, { S, T, catalog, liked: newLiked, disliked: newDisliked, onLiked: setNewLiked, onDisliked: setNewDisliked }),
          h("button", { type: "button", style: { ...S.primary, marginTop: 8, width: "100%" }, onClick: create, disabled: busy }, "创建读者")),
      );

      const importCard = h("div", { style: S.card },
        h("div", { style: S.label, marginTop: 0 }, "导入章节"),
        h("div", { style: S.row, marginBottom: 6 },
          h("input", { style: { ...S.input, flex: 1 }, value: imp.bookId, onChange: (e) => setImp({ ...imp, bookId: e.target.value }), placeholder: "bookId" }),
          h("input", { style: { ...S.input, flex: 1 }, value: imp.bookTitle, onChange: (e) => setImp({ ...imp, bookTitle: e.target.value }), placeholder: "书名" })),
        h("div", { style: S.row, marginBottom: 6 },
          h("input", { style: { ...S.input, flex: 1 }, value: imp.chapterId, onChange: (e) => setImp({ ...imp, chapterId: e.target.value }), placeholder: "chapterId" }),
          h("input", { style: { ...S.input, width: 64 }, type: "number", min: 1, value: imp.sequenceNumber, onChange: (e) => setImp({ ...imp, sequenceNumber: e.target.value }), placeholder: "序号" })),
        h("input", { style: S.input, value: imp.chapterTitle, onChange: (e) => setImp({ ...imp, chapterTitle: e.target.value }), placeholder: "章节标题" }),
        h("div", { style: { height: 6 } }),
        h("textarea", { style: { ...S.input, minHeight: 90, resize: "vertical" }, value: imp.content, onChange: (e) => setImp({ ...imp, content: e.target.value }), placeholder: "粘贴本章正文…" }),
        h("button", { type: "button", style: { ...S.primary, marginTop: 8, width: "100%" }, onClick: doImport, disabled: busy }, "导入"),
      );

      const bookPane = h(React.Fragment, null,
        h("div", { style: S.card },
          h("div", { style: S.label, marginTop: 0 }, "当前作品"),
          h("select", { style: S.input, value: effBook, onChange: (e) => { setBookId(e.target.value); setChapterId(""); setStars(0); setComment(""); } },
            books.length === 0 ? h("option", { value: "" }, "（还没有书稿，先在下面导入）") : books.map((b) => h("option", { key: b.bookId, value: b.bookId }, b.title || b.bookId))),
          h("div", { style: { height: 6 } }),
          h("select", { style: S.input, value: effChapter, onChange: (e) => setChapterId(e.target.value) },
            chapters.length === 0 ? h("option", { value: "" }, "（暂无章节）") : chapters.map((c) => h("option", { key: c.chapterId, value: c.chapterId }, `第 ${c.sequenceNumber} 章 · ${c.title}`)))),
        selReader ? null : h("div", { style: S.empty }, "先在「阅读档案」建一个读者。"),
        h("div", { style: S.card },
          h("div", { style: S.label, marginTop: 0 }, "阅读反馈"),
          h("div", { style: S.row }, h("div", { style: { color: T.muted, fontSize: 12, width: 40 } }, "星级"), starsRow),
          h("div", { style: S.label }, "段评（可选）"),
          h("input", { style: { ...S.input, marginBottom: 4 }, value: segQuote, onChange: (e) => setSegQuote(e.target.value), placeholder: "引用原文（15–40 字）" }),
          h("input", { style: S.input, value: segComment, onChange: (e) => setSegComment(e.target.value), placeholder: "这段好在哪 / 哪里出戏" }),
          h("div", { style: S.label }, "章评"),
          h("textarea", { style: { ...S.input, minHeight: 64, resize: "vertical" }, value: comment, onChange: (e) => setComment(e.target.value), placeholder: "为什么是这个星级？" }),
          h("div", { style: { ...S.row, marginTop: 8 } },
            h("select", { style: { ...S.input, flex: 1 }, value: status, onChange: (e) => setStatus(e.target.value) },
              h("option", { value: "follow" }, "继续追"), h("option", { value: "watch" }, "先观望"), h("option", { value: "drop" }, "弃书")),
            h("button", { type: "button", style: S.primary, onClick: doRate, disabled: busy }, "记录评分")),
          status === "drop" ? h("select", { style: { ...S.input, marginTop: 6 }, value: dropReason, onChange: (e) => setDropReason(e.target.value) },
            h("option", { value: "slow_pacing" }, "原因：节奏拖沓"), h("option", { value: "character_break" }, "原因：人设崩塌"),
            h("option", { value: "logic_error" }, "原因：逻辑问题"), h("option", { value: "prose" }, "原因：文笔劝退"),
            h("option", { value: "formulaic" }, "原因：套路化"), h("option", { value: "genre_mismatch" }, "原因：题材不合"), h("option", { value: "other" }, "原因：其他")) : null,
          h("button", { type: "button", style: { ...S.ghost, marginTop: 8, width: "100%", opacity: data?.modelConfigured ? 1 : 0.55 }, onClick: doReview, disabled: busy || !data?.modelConfigured, title: data?.modelConfigured ? "调用模型评审本章" : "未配置 READER_LLM_BASE_URL / READER_LLM_MODEL" },
            data?.modelConfigured ? "真实模型评审本章" : "真实评审未配置模型"),
          data?.modelConfigured ? null : h("div", { style: { color: T.muted, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 } }, "启用真实评审：设置 READER_LLM_BASE_URL / READER_LLM_MODEL（可选 READER_LLM_API_KEY）后重启 DSH。手工评分不受影响。")),
        importCard,
        ratings.length ? h("div", { style: S.label }, "本书最近评分") : null,
        ratings.slice(0, 5).map((r, i) => h("div", { key: i, style: S.card },
          h("div", { style: S.row }, h("span", { style: { color: T.star, fontWeight: 600 } }, `${r.stars} ★`), h("span", { style: { color: T.muted, fontSize: 11.5 } }, `${r.bookId} / ${r.chapterId}`), h("span", { style: { marginLeft: "auto", fontSize: 10.5, color: T.faint } }, `档案 ${String(r.tasteVersion ?? "").slice(0, 6) || "—"} · 稿件 r${r.revision ?? "?"}`)),
          h("div", { style: { marginTop: 4, fontSize: 12.5, lineHeight: 1.55 } }, String(r.comment ?? "")),
          Array.isArray(r.segments) && r.segments.length
            ? r.segments.map((s, j) => h("div", { key: j, style: { marginTop: 5, padding: "5px 8px", background: T.softer, borderLeft: `2px solid ${T.accent}`, borderRadius: "0 6px 6px 0", fontSize: 11.5, color: T.muted } }, `「${String(s.quote ?? "")}」 ${String(s.comment ?? "")}`))
            : null)),
      );

      const readBooks = Array.isArray(data?.readBooks)
        ? data.readBooks.filter((item) => !effReader || item.readerId === effReader)
        : [];
      const reportPane = h(React.Fragment, null,
        readBooks.length ? h("div", { style: S.card },
          h("div", { style: S.label, marginTop: 0 }, "它读过的书"),
          h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } },
            readBooks.slice(0, 8).map((item) => h("div", { key: `${item.readerId}:${item.bookId}`, style: { border: `1px solid ${T.line}`, borderRadius: 10, padding: 8, background: T.softer, minWidth: 0 } },
              h("div", { style: { fontWeight: 600, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, String(item.title ?? item.bookId)),
              h("div", { style: { color: T.muted, fontSize: 11, marginTop: 2 } }, `${item.stars} ★ · ${item.status === "drop" ? "弃书" : item.status === "watch" ? "观望" : "追更"} · ${item.ratings} 次 · 第 ${item.chapterNumber ?? "?"} 章`),
              item.comment ? h("div", { style: { fontSize: 11.5, marginTop: 4, lineHeight: 1.5, overflowWrap: "anywhere", wordBreak: "break-word" } }, String(item.comment).slice(0, 60)) : null)))) : null,
        h("div", { style: S.card },
          h("div", { style: S.row },
            h("input", { style: { ...S.input, flex: 1 }, type: "date", value: reportDate, onChange: (e) => setReportDate(e.target.value) }),
            h("button", { type: "button", style: S.primary, onClick: () => doReport(false), disabled: busy }, "生成"),
            h("button", { type: "button", style: S.ghost, onClick: () => doReport(true), disabled: busy }, "保存")),
          reportFile ? h("div", { style: { color: T.ok, fontSize: 11.5, marginTop: 6 } }, `已写入 ${reportFile}`) : null,
          reportText
            ? h("div", { style: { ...S.card, marginTop: 10 } }, String(reportText).split(/\r?\n/).map((line, i) => {
                if (line.startsWith("# ")) return h("div", { key: i, style: { fontWeight: 700, fontSize: 14, margin: "0 0 6px" } }, line.slice(2));
                if (line.startsWith("### ")) return h("div", { key: i, style: { fontWeight: 600, margin: "10px 0 4px", color: T.accent } }, line.slice(4));
                if (line.startsWith("- ")) return h("div", { key: i, style: { margin: "2px 0 2px 10px", color: T.muted } }, line.slice(2));
                if (!line.trim()) return null;
                return h("div", { key: i, style: { margin: "2px 0" } }, line);
              }))
            : h("div", { style: S.empty }, "今天还没有阅读记录，生成后这里会留下足迹。")));

      const findPane = h(React.Fragment, null,
        h("div", { style: S.card },
          h("div", { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, "按标签找书"),
          h("div", { style: { ...S.empty, padding: "0 0 8px" } }, "喜好标签加权匹配，雷点硬排除（需 READER_SOURCE=fake 演示）。"),
          h(TagPicker, { S, T, catalog, liked: findTags, disliked: findExclude, onLiked: setFindTags, onDisliked: setFindExclude }),
          h("button", { type: "button", style: { ...S.primary, width: "100%", marginTop: 8 }, onClick: doTagSearch, disabled: busy }, "按标签找 5 本"),
          h("button", { type: "button", style: { ...S.ghost, width: "100%", marginTop: 6 }, onClick: doFind, disabled: busy }, `按「${selReader?.name ?? "当前读者"}」的口味找 3 本`)),
        findMeta ? h("div", { style: { fontSize: 11, color: T.muted, margin: "0 2px 8px" } },
          `搜索标签：${(findMeta.searchedTags ?? []).join("、") || "—"}${Array.isArray(findMeta.unknownTags) && findMeta.unknownTags.length ? ` · 未收录：${findMeta.unknownTags.join("、")}` : ""}`) : null,
        h("div", { style: S.card },
          h("div", { style: S.label, marginTop: 0 }, "从公开链接导入（L2，需白名单）"),
          h("div", { style: S.row, marginBottom: 6 },
            h("input", { style: { ...S.input, flex: 1 }, value: uil.bookId, onChange: (e) => setUil({ ...uil, bookId: e.target.value }), placeholder: "bookId" }),
            h("input", { style: { ...S.input, flex: 1 }, value: uil.bookTitle, onChange: (e) => setUil({ ...uil, bookTitle: e.target.value }), placeholder: "书名" })),
          h("div", { style: S.row, marginBottom: 6 },
            h("input", { style: { ...S.input, flex: 1 }, value: uil.chapterId, onChange: (e) => setUil({ ...uil, chapterId: e.target.value }), placeholder: "chapterId" }),
            h("input", { style: { ...S.input, width: 64 }, type: "number", min: 1, value: uil.sequenceNumber, onChange: (e) => setUil({ ...uil, sequenceNumber: e.target.value }), placeholder: "序号" })),
          h("input", { style: S.input, value: uil.chapterTitle, onChange: (e) => setUil({ ...uil, chapterTitle: e.target.value }), placeholder: "章节标题" }),
          h("div", { style: { height: 6 } }),
          h("input", { style: S.input, value: uil.url, onChange: (e) => setUil({ ...uil, url: e.target.value }), placeholder: "https://… 章节页地址" }),
          h("button", { type: "button", style: { ...S.ghost, marginTop: 8, width: "100%" }, onClick: doImportUrl, disabled: busy }, "导入这一节"),
          h("div", { style: { color: T.muted, fontSize: 11, marginTop: 6 } }, "只保存 ≤300 字摘录；需在 READER_PAGE_HOSTS 里列域名，遇付费墙/验证码会停止。")),
        found === null ? null : found.length === 0 ? h("div", { style: S.empty }, "暂时没有符合当前口味的作品，继续阅读以丰富画像。")
          : found.map((item, i) => { const b = item.book ?? item; return h("div", { key: b.bookId ?? i, style: S.card },
              h("div", { style: { fontWeight: 600 } }, String(b.title ?? b.bookId ?? "未命名")),
              b.author ? h("div", { style: { color: T.muted, fontSize: 11.5, marginTop: 2 } }, String(b.author)) : null,
              Array.isArray(item.matchedTags) && item.matchedTags.length
                ? h("div", { style: { marginTop: 5 } }, item.matchedTags.map((tag, j) => h("span", { key: j, style: S.chip }, String(tag))))
                : null,
              item.reason || b.summary ? h("div", { style: { marginTop: 6, fontSize: 12 } }, String(item.reason ?? b.summary)) : null,
              h("div", { style: { display: "flex", gap: 6, marginTop: 8 } },
                h("button", { type: "button", style: S.ghost, onClick: () => doShelfAdd(b), disabled: busy }, "加入书架"),
                h("button", { type: "button", style: S.ghost, onClick: () => doLearn(b, b.chapterId ?? "c1"), disabled: busy }, "看评论区")),
              learned[b.bookId]
                ? h("div", { style: { marginTop: 8, padding: "6px 8px", background: T.softer, borderRadius: 8, fontSize: 11.5, color: T.muted, lineHeight: 1.55 } },
                    `关注点：${(learned[b.bookId].hints ?? []).join("；") || "暂时没有可用的评论区信号"}`)
                : null); }));

      const pane = tab === "profile" ? profilePane : tab === "book" ? bookPane : tab === "report" ? reportPane : findPane;

      return h("div", { style: S.root },
        h("div", { style: S.head },
          h("div", { style: S.title }, "读者档案"),
          h("div", { style: { display: "flex", gap: 4, marginLeft: "auto", alignItems: "center" } },
            THEMES.map((theme) => h("button", {
              key: theme.id, type: "button", title: `底色：${theme.label}`, "aria-label": `底色：${theme.label}`, onClick: () => chooseTheme(theme.id),
              style: { width: 15, height: 15, borderRadius: "50%", padding: 0, cursor: "pointer", border: `2px solid ${themeId === theme.id ? T.accent : "transparent"}`, background: theme.bg, boxShadow: `inset 0 0 0 1px ${theme.line}` },
            })),
            h("button", { type: "button", style: S.iconBtn, onClick: load, disabled: busy }, "刷新"))),
        h("div", { style: S.sub }, "口味是跨书资产 · 星级与章评只属于当前这本书"),
        h("div", { style: S.tabs },
          narrow && tab !== "find"
            ? h(React.Fragment, null, tabBtn("profile", "档案"), tabBtn("book", "作品"), tabBtn("report", "日报"),
                h("button", { type: "button", style: S.tab(false), onClick: () => setTab("find") }, "+1"))
            : h(React.Fragment, null, tabBtn("profile", "阅读档案"), tabBtn("book", "当前作品"), tabBtn("report", "日报"), tabBtn("find", "找书"))),
        error ? h("div", { style: S.error }, error) : null,
        toast ? h("div", { style: S.ok }, toast) : null,
        pane,
        h("div", { style: { display: "flex", gap: 8, color: T.muted, fontSize: 11.5, marginTop: 12, borderTop: `1px solid ${T.line}`, paddingTop: 8 } },
          h("span", null, `${quota.date ?? "—"} · 章 ${quota.chapters ?? 0}/${quota.maxChapters ?? 0}`),
          h("span", null, `token ${quota.tokens ?? 0}/${quota.maxTokens ?? 0}`),
          h("span", { style: { marginLeft: "auto" } }, selReader && selChapter ? `${selReader.name} · 第 ${selChapter.sequenceNumber} 章` : "")),
      );
    }

    const TAB_ID = "dsh-novel-comment";
    const TAB_KIND = "novel-reader";
    function OpenButton({ open }) {
      return h("button", { type: "button", onClick: open, title: "打开读者档案面板",
        style: { border: "1px solid var(--dsw-alias-border-l1,#e8e7e0)", background: "var(--dsw-alias-bg-l1,#fff)", color: "var(--dsw-alias-label-primary,#292f2b)", borderRadius: 8, padding: "3px 9px", cursor: "pointer", fontSize: 12 } }, "AI 读者");
    }

    return {
      inject: ["slots", "remote"],
      async apply(ctx) {
        let remote = null;
        try {
          const dispose = await ctx.remote.$mount(REMOTE);
          remote = ctx.get("remote.readerPanel") ?? null;
          if (typeof dispose === "function") ctx.effect(() => () => { try { dispose(); } catch { /* gone */ } });
          if (!remote) console.error("[novel-reader] remote.readerPanel 未注册");
        } catch (e) { console.error("[novel-reader] remote mount 失败", e); }
        const seat = ctx.inject(["sidebarRightTabs", "sidebarRight"], (scoped) => {
          const tabs = scoped.get("sidebarRightTabs");
          const right = scoped.get("sidebarRight");
          if (!tabs || !right) return;
          scoped.effect(() => tabs.register({ id: TAB_ID, kind: TAB_KIND, priority: "extension", keepMounted: true, title: () => "AI 读者",
            guide: [{ id: TAB_ID, order: 20, title: () => "AI 读者", description: () => "读者档案、当前作品与日报" }] }), "novel-reader: tab type");
          scoped.effect(() => scoped.slots.inject("sidebar.right.pane.tab", () => scoped.slots.register(
            { name: "sidebar.right.pane.tab", key: TAB_ID, inject: (sessionId) => ({ sessionId, remote }) }, ReaderPanel)), "novel-reader: tab body");
          scoped.effect(() => scoped.slots.inject("conversation.session.header.utilities", () => scoped.slots.register(
            { name: "conversation.session.header.utilities", id: "dsh-novel-comment-open", order: 36,
              inject: () => ({ open: () => { try { right.openTab(TAB_KIND); } catch (e) { console.error("[novel-reader] openTab", e); } } }) }, OpenButton)), "novel-reader: header button");
        });
        ctx.effect(() => () => { try { seat?.(); } catch { /* gone */ } });
      },
    };
  },
});
