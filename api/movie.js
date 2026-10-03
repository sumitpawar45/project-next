// Vercel serverless function: /api/movies
// Keeps your TMDB key on the server so visitors never see it.
const T = "https://api.themoviedb.org/3";

module.exports = async (req, res) => {
  const key = process.env.TMDB_KEY;
  if (!key) return res.status(500).json({ error: "TMDB_KEY is not set" });

  const { type, q, id, g } = req.query;
  const u = (path, params = {}) =>
    `${T}${path}?` + new URLSearchParams({ api_key: key, language: "en-US", include_adult: "false", ...params });

  if (type === "detail" && /^\d+$/.test(id)) {
    try {
      const d = await fetch(u(`/movie/${id}`, { append_to_response: "credits,watch/providers" })).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const reg = /^[A-Z]{2}$/.test(req.query.region) ? req.query.region : "US";
      const wp = ((d["watch/providers"] || {}).results || {})[reg] || {};
      const names = [...(wp.flatrate || []), ...(wp.rent || []), ...(wp.buy || [])].map(p => p.provider_name);
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
      return res.status(200).json({ overview: d.overview || "", cast: ((d.credits || {}).cast || []).slice(0, 5).map(c => c.name), platforms: [...new Set(names)].slice(0, 6) });
    } catch (e) { return res.status(502).json({ error: "TMDB request failed" }); }
  }

  let urls;
  if (type === "trending") urls = [1, 2, 3].map(p => u("/trending/movie/week", { page: p }));
  else if (type === "search" && q) urls = [u("/search/movie", { query: String(q).slice(0, 100) })];
  else if (type === "similar" && /^\d+$/.test(id)) urls = [u(`/movie/${id}/recommendations`)];
  else if (type === "genre" && /^\d+$/.test(g))
    urls = [1, 2].map(p => u("/discover/movie", { with_genres: g, sort_by: "popularity.desc", "vote_count.gte": "200", page: p }));
  else return res.status(400).json({ error: "bad request" });

  try {
    const pages = await Promise.all(
      urls.map(x => fetch(x).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }))
    );
    const seen = new Set(), results = [];
    pages.forEach(p => (p.results || []).forEach(t => {
      if (t.poster_path && !seen.has(t.id)) {
        seen.add(t.id);
        results.push({ id: t.id, title: t.title, release_date: t.release_date,
          vote_average: t.vote_average, genre_ids: t.genre_ids, poster_path: t.poster_path });
      }
    }));
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.status(200).json({ results });
  } catch (e) {
    res.status(502).json({ error: "TMDB request failed" });
  }
};
