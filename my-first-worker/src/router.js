import {compileSQL} from "./compile-sql";

import * as C from "./constants";

export default {

  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      console.error("UNHANDLED in fetch:", err);
      return safeJsonResponse({ error: "Unhandled exception", message: String(err), stack: err?.stack }, 500);
    }
  },
};

  async function handle(request, env, ctx) {
    const url = new URL(request.url);

    // API routes
    if (request.method === "POST" && url.pathname === "/api/snippets/upsert") {
      return upsertSnippets(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/snippets/search") {
      return searchSnippets(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/compile-sql"){
      return compileSQL(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return safeJsonResponse({
        hasAI: !!env.AI,
        hasVDB: !!env.VDB,
        gwAcct: !!env.GATEWAY_ACCOUNT_ID,
        gwName: !!env.GATEWAY_NAME,
        provider: env.PROVIDER ?? null
      });
    }

    // Parquet via R2 with range reads
    if (request.method === "GET" && url.pathname === "/data/collisions_2024_enriched_v2.parquet") {
      const range = request.headers.get("Range");
      let opts;
      if (range) {
        const m = range.match(/bytes=(\d+)-(\d+)?/);
        if (m) {
          const start = Number(m[1]);
          const end = m[2] !== undefined ? Number(m[2]) : undefined;
          opts = end != null
            ? { range: { offset: start, length: end - start + 1 } }
            : { range: { offset: start } };
        }
      }
      const obj = await env.DATA.get("collisions_2024_enriched_v2.parquet", opts);
      if (!obj) return new Response("Not found", { status: 404 });

      const headers = new Headers({
        "content-type": "application/octet-stream",
        "cache-control": "public, max-age=3600",
        "accept-ranges": "bytes"
      });
      let status = 200;
      if (range && obj.range) {
        status = 206;
        const start = obj.range.offset;
        const end = obj.range.offset + obj.range.length - 1;
        headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
      }
      return new Response(obj.body, { status, headers });
    }

    // Fallback to static assets (if configured)
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response("Not Found", { status: 404 });
  }


async function upsertSnippets(request, env) {
  let cards;
  try {
    cards = await request.json(); // expect an array of cards like in snippets.json
    if (!Array.isArray(cards)) throw new Error("Body must be an array");
  } catch (e) {
    return safeJsonResponse({ error: "Invalid JSON body: " + (e?.message || e) }, 400);
  }

  // Build vectors (embed title+text+sql+NLs for better recall)
  const vectors = [];
  for (const c of cards) {
    const parts = [
      c.title || "",
      c.text || "",
      c.sql_base || "",
      ...(Array.isArray(c.examples) ? c.examples.map(e => e.nl || "").slice(0, 4) : [])
    ].filter(Boolean);

    const toEmbed = parts.join("\n");
    const emb = await env.AI.run(C.EMBEDDING_MODEL, { text: toEmbed });

    vectors.push({
      id: String(c.id),
      values: emb.data[0], // embedding vector
      metadata: {
        title: c.title || "",
        type: c.type || "",
        tables: c.tables || [],
        columns: c.columns || [],
        tags: c.tags || []
      }
    });
  }

  // Upsert to Vectorize
  await env.VDB.upsert(vectors);

  return safeJsonResponse({ upserted: vectors.length });
}

async function searchSnippets(request, env) {
  const { query, k = 6 } = await request.json();
  if (!query) return safeJsonResponse({ error: "Missing 'query'" }, 400);

  const emb = await env.AI.run(C.EMBEDDING_MODEL, { text: query });
  const res = await env.VDB.query(emb.data[0], {
    topK: Number(k) || 6,
    includeMetadata: true,
    returnVectors: false
  });

  // res.matches → [{id, score, metadata}, ...]
  return safeJsonResponse({ matches: res.matches });
}

export function safeJsonResponse(obj, status = 200) {
  const body = JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8" } });
}