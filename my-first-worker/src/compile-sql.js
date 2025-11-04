import {safeJsonResponse} from "./router.js";
import { validateSQL } from "./validate-sql.js";
import * as C from "./constants.js";

export async function compileSQL(request, env) {
    const { question, k = 6 } = await request.json();

    let retrieved = {};

    // 1) Retrieve top-k snippets (embed question -> Vectorize query)
    try{
        const emb = await env.AI.run(C.EMBEDDING_MODEL, { text: question });
        const hits = await env.VDB.query(emb.data[0], {
        topK: Number(k) || 6,
        includeMetadata: true
        });

        // Build a compact retrieved context
        retrieved = hits.matches.map((m, i) => {
        const md = m.metadata || {};
        return `#${i + 1} [${md.type || "note"}] ${md.title || ""}
    Tables: ${(md.tables || []).join(", ") || "-"}
    Columns: ${(md.columns || []).join(", ") || "-"}
    Tags: ${(md.tags || []).join(", ") || "-"}
    `;
        }).join("\n");
    } catch (e){
        console.warn("Retrieval failed: ", e);
    }

    // 3) Build the chat payload
    const userContent = {
    question,
    schema: C.SCHEMA_SNAPSHOT,
    few_shots: C.FEW_SHOTS,
    retrieved_snippets: retrieved
    };

    // 4) Call model via AI Gateway or mock it if testing to save tokens.

    let result;

    if (env.MOCK_AI === true || env.MOCK_AI === "true"){
        const raw = C.MOCK_AI_RESPONSE?.choices?.[0]?.message?.content ?? "{}";
        const result = JSON.parse(raw);
        if (!result?.sql || !result?.reason) {
            return safeJsonResponse({ error: "Mock response from AI model does not contain {sql, reason}.", raw: result }, 502);
        }
        return safeJsonResponse(result);
    }
    
    if (!env.GATEWAY_ACCOUNT_ID || !env.GATEWAY_NAME) {
        return safeJsonResponse({ error: "Missing GATEWAY_ACCOUNT_ID or GATEWAY_NAME" }, 500);
    }
    if (!env.CF_API_TOKEN) {
    return safeJsonResponse({ error: "Missing CF_API_TOKEN (Workers AI API token)" }, 500);
    }

    const url = `https://gateway.ai.cloudflare.com/v1/${env.GATEWAY_ACCOUNT_ID}/${env.GATEWAY_NAME}/workers-ai/v1/chat/completions`;
    const body = {
    model: env.MODEL || "@cf/meta-llama/llama-2-7b-chat-hf-lora",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
        { role: "system", content: C.SYSTEM_RULES },
        { role: "user", content: JSON.stringify(userContent) }
    ]
    };

    const headers = {
        "content-type": "application/json",
        "authorization": `Bearer ${env.CF_API_TOKEN}`
        };

    if (env.AIGW_TOKEN) headers["cf-aig-authorization"] = `Bearer ${env.AIGW_TOKEN}`;


    try{
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort("gateway-timeout"), C.GATEWAY_TIMEOUT_MS);

        const resp = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: ac.signal
            });
        clearTimeout(timer);
        
        const raw = await resp.text();

        let data = null;
        if (raw && raw.trim().startsWith("{")) {
            try { 
                data = JSON.parse(raw); } 
            catch (e){ 
                console.warn("Failed to parse json of response from AI model for the following reason:", e);
            }
        }

        if (!resp.ok){
            return safeJsonResponse({
                error: "LLM call failed",
                status: resp.status,
                details: data ?? raw.slice(0, 1000)
            }, 502);
        }

        const txt = data?.choices?.[0]?.message?.content || "{}";
        result = safeParseJSON(txt);
        
        if (!result?.sql || !result?.reason) {
            return safeJsonResponse({ error: "Model did not return {sql, reason}.", raw: result }, 502);
        }

        let sql = result.sql;
        let reason = result.reason;

        const sqlOk = validateSQL(sql);
        if (!sqlOk.ok){
            return safeJsonResponse({error: "Rejected SQL", reason: sqlOk?.reason || "Unknown reason"}, 400);
        }
        return safeJsonResponse({sql, reason});
    } catch (err) {
        return safeJsonResponse({
            error: "Gateway fetch exception",
            message: String(err),
            name: err?.name
            }, 502);
    }
}

function safeParseJSON(s) {
    try {
        // strip code fences if any
        const cleaned = s.replace(/^```json|```$/g, "").trim();
        return JSON.parse(cleaned);
    } catch (e){
        console.warn("Failed to parse json:", e);
    }
}