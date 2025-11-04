const MAX_SQL_LENGTH = 20000;

// Disallow keywords anywhere (after stripping comments/strings)
const DISALLOWED_RE = /\b(?:insert|update|delete|merge|create|alter|drop|truncate|replace|grant|revoke|attach|detach|copy|export|load|install|uninstall|call|exec|execute|set|reset|pragma|begin|commit|rollback|savepoint|release|vacuum|analyze|explain|refresh|cluster|reindex|checkpoint)\b/i;

// The first major statement must be SELECT
const MAJOR_START_RE = /\b(select|insert|update|delete|merge)\b/i;

export function validateSQL(rawSql) {
    if (typeof rawSql !== "string") {
      return { ok: false, reason: "SQL must be a string." };
    }
    if (rawSql.length > MAX_SQL_LENGTH) {
      return { ok: false, reason: `SQL too long (> ${MAX_SQL_LENGTH} chars).` };
    }
  
    // 1) Normalize & strip comments/strings so keyword checks are reliable
    const cleaned = stripLiteralsAndComments(rawSql);
    if (/\0/.test(cleaned)) {
      return { ok: false, reason: "SQL contains null bytes." };
    }
  
    // 2) Reject multiple statements (allow a single trailing semicolon only)
    const multi = hasMultipleStatements(cleaned);
    if (multi) {
      return { ok: false, reason: "Multiple statements are not allowed." };
    }
  
    // 3) No disallowed tokens anywhere (even inside CTE bodies)
    if (DISALLOWED_RE.test(cleaned)) {
      const bad = cleaned.match(DISALLOWED_RE)[0].toUpperCase();
      return { ok: false, reason: `Disallowed keyword found: ${bad}.` };
    }
  
    // 4) Ensure the first major statement is SELECT (WITH is ok as a prefix)
    const first = cleaned.match(MAJOR_START_RE)?.[1]?.toLowerCase();
    if (first && first !== "select") {
      return { ok: false, reason: `Only SELECT is permitted (found ${first.toUpperCase()}).` };
    }
  
    // 5) If it starts with WITH, make sure a SELECT occurs at all
    if (/^\s*with\b/i.test(cleaned) && !/\bselect\b/i.test(cleaned)) {
      return { ok: false, reason: "WITH must lead to a SELECT query." };
    }
  
    return { ok: true };
  }
  

function stripLiteralsAndComments(sql) {
    let out = "", i = 0, n = sql.length;

    while (i < n) {
      const crtChar = sql[i], nextChar = sql[i + 1];
  
      // -- line comment
      if (crtChar === "-" && nextChar === "-") {
        i += 2; 
        while (i < n && sql[i] !== "\n"){
            i++; 
            out += " "; 
            continue;
        }
      }
      // /* block comment */
      if (crtChar === "/" && nextChar === "*") {
        i += 2; 
        while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")){
            i++;
        }
        if (i < n){
            i += 2; 
            out += " "; 
            continue;
        }
      }
      // 'single-quoted' string (handles doubled quotes '')
      if (crtChar === "'") {
        i++; 
        while (i < n) {
          if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
          if (sql[i] === "'") { i++; break; }
          i++;
        }
        out += " "; continue;
      }
      // "double-quoted" identifier/string (handles "" escapes)
      if (crtChar === '"') {
        i++; 
        while (i < n) {
          if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; }
          if (sql[i] === '"') { i++; break; }
          i++;
        }
        out += " "; continue;
      }
  
      out += crtChar; 
      i++;
    }

    return out;
  }

  function hasMultipleStatements(sql) {
    const trimmed = sql.trim();
    if (trimmed === "") return false;
    const endsWithSemicolon = /;\s*$/.test(trimmed);
    const internalSemicolons = (trimmed.slice(0, endsWithSemicolon ? -1 : undefined).match(/;/g) || []).length;
    return internalSemicolons > 0;
  }