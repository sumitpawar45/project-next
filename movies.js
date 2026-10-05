// Vercel serverless function: /api/movies
// Keeps your TMDB key on the server so visitors never see it.
// TV shows use NEGATIVE ids (id = -tmdbId) so movies and shows never collide.
const T = "https://api.themoviedb.org/3";

module.exports = async (req, res) => {
  const key = process.env.TMDB_KEY;
  if (!key) return res.status(500).json({ error: "TMDB_KEY is not set" });

  const { type, q, g } = req.query;
  const rawId = String(req.query.id || "");
  const isTV = /^-\d+$/.test(rawId);
  const id = isTV ? rawId.slice(1) : rawId;
  const kindTV = req.query.kind === "tv";
  const pg = Math.min(100, Math.max(1, parseInt(req.query.page) || 1));
  const u = (path, params = {}) =>
    `${T}${path}?` + new URLSearchParams({ api_key: key, language: "en-US", include_adult: "false", ...params });
  const getJson = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const mt = isTV ? "tv" : "movie";

  // Optional OMDb fallback (set OMDB_KEY in Vercel). Fills gaps TMDB leaves: posters, plot, cast, director.
  const OK = process.env.OMDB_KEY;
  const omdb = params => !OK ? Promise.resolve(null)
    : fetch("https://www.omdbapi.com/?" + new URLSearchParams({ apikey: OK, ...params }))
        .then(r => r.ok ? r.json() : null).then(j => (j && j.Response === "True") ? j : null).catch(() => null);
  const real = v => (v && v !== "N/A") ? v : "";

  if (type === "detail" && /^\d+$/.test(id)) {
    try {
      const d = await getJson(u(`/${mt}/${id}`, { append_to_response: "credits,watch/providers,videos,external_ids" }));
      const reg = /^[A-Z]{2}$/.test(req.query.region) ? req.query.region : "US";
      const wp = ((d["watch/providers"] || {}).results || {})[reg] || {};
      const names = [...(wp.flatrate || []), ...(wp.rent || []), ...(wp.buy || [])].map(p => p.provider_name);
      const cr = d.credits || {};
      const castFull = (cr.cast || []).slice(0, 12).map(c => ({ n: c.name, c: c.character || "", p: c.profile_path ? "https://image.tmdb.org/t/p/w185" + c.profile_path : "" }));
      const dir = isTV
        ? (d.created_by || []).map(c => c.name).slice(0, 3).join(", ")
        : (cr.crew || []).filter(c => c.job === "Director").map(c => c.name).slice(0, 2).join(", ");
      const rank = x => (x.type === "Trailer" ? 0 : 2) + (x.official ? 0 : 1);
      const trailers = ((d.videos || {}).results || []).filter(v => v.site === "YouTube")
        .sort((a, b) => rank(a) - rank(b)).slice(0, 6).map(v => ({ k: v.key, n: v.name, t: v.type }));
      const rd = isTV ? d.first_air_date : d.release_date;
      const release = rd ? new Date(rd + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
      const runtime = isTV ? ((d.episode_run_time || [])[0] || (d.last_episode_to_air || {}).runtime || 0) : (d.runtime || 0);
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
      const out = {
        overview: d.overview || "",
        cast: castFull.slice(0, 5).map(c => c.n),
        castFull, trailers, director: dir, dl: isTV ? "Creator" : "Director",
        runtime,
        language: (d.original_language || "en").toUpperCase(),
        release,
        seasons: isTV ? d.number_of_seasons || 0 : 0,
        episodes: isTV ? d.number_of_episodes || 0 : 0,
        platforms: [...new Set(names)].slice(0, 6),
        poster: ""
      };
      // fall back to OMDb for anything TMDB left empty
      const imdb = d.imdb_id || (d.external_ids || {}).imdb_id;
      if (OK && (!out.overview || !out.cast.length || !out.director || !out.runtime || !d.poster_path)) {
        const o = await omdb(imdb ? { i: imdb } : { t: d.title || d.name || "", y: (rd || "").slice(0, 4) });
        if (o) {
          if (!out.overview) out.overview = real(o.Plot);
          if (!out.cast.length) out.cast = real(o.Actors).split(", ").filter(Boolean).slice(0, 5);
          if (!out.director) out.director = real(o.Director) || real(o.Writer);
          if (!out.runtime) out.runtime = parseInt(real(o.Runtime)) || 0;
          if (!d.poster_path) out.poster = real(o.Poster);
        }
      }
      return res.status(200).json(out);
    } catch (e) { return res.status(502).json({ error: "TMDB request failed" }); }
  }

  if (type === "trailer" && /^\d+$/.test(id)) {
    try {
      const d = await getJson(u(`/${mt}/${id}/videos`));
      const yt = (d.results || []).filter(v => v.site === "YouTube");
      const rank = x => (x.type === "Trailer" ? 0 : 2) + (x.official ? 0 : 1);
      const keys = yt.sort((a, b) => rank(a) - rank(b)).map(x => x.key).slice(0, 5);
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
      return res.status(200).json({ key: keys[0] || null, keys });
    } catch (e) { return res.status(502).json({ error: "TMDB request failed" }); }
  }

  const span = (n, f) => Array.from({ length: n }, (_, i) => f((pg - 1) * n + i + 1));
  let urls;
  const k = kindTV ? "tv" : "movie";
  if (type === "trending") urls = span(3, p => u(`/trending/${k}/week`, { page: p }));
  else if (type === "top") urls = span(3, p => u(`/${k}/top_rated`, { page: p }));
  else if (type === "trendall") urls = span(2, p => u("/trending/all/day", { page: p }));
  else if (type === "multi" && q) urls = span(2, p => u("/search/multi", { query: String(q).slice(0, 100), page: p }));
  else if (type === "search" && q) urls = [u(`/search/${k}`, { query: String(q).slice(0, 100), page: pg })];
  else if (type === "similar" && /^\d+$/.test(id)) urls = [u(`/${mt}/${id}/recommendations`)];
  else if (type === "genre" && /^\d+$/.test(g))
    urls = span(2, p => u(`/discover/${k}`, { with_genres: g, sort_by: "popularity.desc", "vote_count.gte": kindTV ? "100" : "200", page: p }));
  else return res.status(400).json({ error: "bad request" });

  // which media type are plain (non-"multi") results?
  const defTV = type === "similar" ? isTV : kindTV;
  try {
    const pages = await Promise.all(
      urls.map(x => fetch(x).then(r => { if (!r.ok) { if (pg > 1) return { results: [] }; throw new Error(r.status); } return r.json(); }))
    );
    const seen = new Set(), results = [];
    pages.forEach(p => (p.results || []).forEach(t => {
      const mtype = t.media_type || (defTV ? "tv" : "movie");
      if (mtype !== "movie" && mtype !== "tv") return; // skip people
      const tv = mtype === "tv";
      const nid = tv ? -t.id : t.id;
      if (seen.has(nid) || !(t.title || t.name)) return; // keep poster-less titles too
      seen.add(nid);
      results.push({ id: nid, title: t.title || t.name, release_date: t.release_date || t.first_air_date,
        vote_average: t.vote_average, genre_ids: t.genre_ids, poster_path: t.poster_path || "" });
    }));
    // OMDb poster fallback for titles TMDB has no poster for (max 10 per request keeps it fast)
    if (OK) {
      const miss = results.filter(r => !r.poster_path).slice(0, 10);
      await Promise.all(miss.map(async r => {
        const o = await omdb({ t: r.title, y: (r.release_date || "").slice(0, 4) });
        if (o && real(o.Poster)) r.poster_path = o.Poster;
      }));
    }
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.status(200).json({ results });
  } catch (e) {
    res.status(502).json({ error: "TMDB request failed" });
  }
};
