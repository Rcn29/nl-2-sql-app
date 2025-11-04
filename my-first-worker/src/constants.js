export const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";

export const GATEWAY_TIMEOUT_MS = 30000;

export const MOCK_AI_RESPONSE = 
{
  "id": "id-1762274371643",
  "object": "chat.completion",
  "created": 1762274371,
  "model": "@cf/meta/llama-3-8b-instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"sql\":\"SELECT local_authority_ons_district_label, COUNT(*) AS crashes\\n        FROM collisions\\n        WHERE collision_year = (SELECT MAX(collision_year) FROM collisions)\\n        GROUP BY 1\\n        ORDER BY crashes ASC\\n        LIMIT 1;\\n\",\"reason\":\"Safest district of 2024 is the one with the lowest total number of crashes.\"}",
        "refusal": null
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1410,
    "completion_tokens": 77,
    "total_tokens": 1487
  }
};

export const SCHEMA_SNAPSHOT = `
Table/View: collisions

Columns (name TYPE):
- collision_index (UTF8)
- collision_year (INT32)
- collision_ref_no (UTF8)
- location_easting_osgr (INT32)
- location_northing_osgr (INT32)
- longitude (FLOAT)
- latitude (DOUBLE)
- police_force (INT32)
- collision_severity (INT32)
- number_of_vehicles (INT32)
- number_of_casualties (INT32)
- date (UTF8, format DD/MM/YYYY)
- day_of_week (INT32)
- time (UTF8)
- local_authority_ons_district (UTF8)
- local_authority_highway (UTF8)
- local_authority_highway_current (UTF8)
- first_road_class (INT32)
- first_road_number (INT32)
- road_type (INT32)
- speed_limit (INT32)
- junction_detail_historic (INT32)
- junction_detail (INT32)
- junction_control (INT32)
- second_road_class (INT32)
- second_road_number (INT32)
- pedestrian_crossing_human_control_historic (INT32)
- pedestrian_crossing_physical_facilities_historic (INT32)
- pedestrian_crossing (INT32)
- light_conditions (INT32)
- weather_conditions (INT32)
- road_surface_conditions (INT32)
- special_conditions_at_site (INT32)
- carriageway_hazards_historic (INT32)
- carriageway_hazards (INT32)
- urban_or_rural_area (INT32)
- did_police_officer_attend_scene_of_accident (INT32)
- trunk_road_flag (INT32)
- lsoa_of_accident_location (UTF8)
- enhanced_severity_collision (INT32)
- collision_injury_based (INT32)
- collision_adjusted_severity_serious (DOUBLE)
- collision_adjusted_severity_slight (DOUBLE)

Label/decoded fields (UTF8):
- police_force_label (UTF8)
- collision_severity_label (UTF8)
- day_of_week_label (UTF8)
- local_authority_ons_district_label (UTF8)
- local_authority_highway_label (UTF8)
- local_authority_highway_current_label (UTF8)
- first_road_class_label (UTF8)
- road_type_label (UTF8)
- junction_detail_historic_label (UTF8)
- junction_detail_label (UTF8)
- junction_control_label (UTF8)
- second_road_class_label (UTF8)
- pedestrian_crossing_human_control_historic_label (UTF8)
- pedestrian_crossing_physical_facilities_historic_label (UTF8)
- pedestrian_crossing_label (UTF8)
- light_conditions_label (UTF8)
- weather_conditions_label (UTF8)
- road_surface_conditions_label (UTF8)
- special_conditions_at_site_label (UTF8)
- carriageway_hazards_historic_label (UTF8)
- carriageway_hazards_label (UTF8)
- urban_or_rural_area_label (UTF8)
- did_police_officer_attend_scene_of_accident_label (UTF8)
- trunk_road_flag_label (UTF8)
- enhanced_severity_collision_label (UTF8)
- collision_injury_based_label (UTF8)
`.trim();

export const FEW_SHOTS = [
    {
      nl: "How many crashes of each severity in the latest year?",
      sql: `
        SELECT collision_severity_label, COUNT(*) AS crashes
        FROM collisions
        WHERE collision_year = (SELECT MAX(collision_year) FROM collisions)
        GROUP BY 1
        ORDER BY crashes DESC;`.trim()
    },
    {
      nl: "Top 5 districts by serious crashes last year.",
      sql: `
        SELECT local_authority_ons_district_label, COUNT(*) AS crashes
        FROM collisions
        WHERE collision_year = (SELECT MAX(collision_year) FROM collisions)
            AND collision_severity_label = 'Serious'
        GROUP BY 1
        ORDER BY crashes DESC
        LIMIT 5;`.trim()
    },
    {
        nl: "Safest districts by total crashes last year.",
        sql: `
        SELECT local_authority_ons_district_label, COUNT(*) AS crashes
        FROM collisions
            WHERE collision_year = (SELECT MAX(collision_year) FROM collisions)
        GROUP BY 1
        ORDER BY crashes ASC
        LIMIT 10;`.trim()
    }
  ];

export const SYSTEM_RULES = `
You are an expert DuckDB SQL compiler.
Return ONLY valid DuckDB SQL for the 'collisions' view/table, and a brief reasoning string.
Rules:
- Use **local_authority_ons_district / local_authority_ons_district_label**; the columns
  local_authority_district and local_authority_district_label **do not exist**.
- Output must be STRICT JSON: {"sql":"...","reason":"..."} with no extra text or code fences. 
- Correlate safety with number of crashes, "safest" or "least dangerous" means fewest crashes, "least safe" or "most dangerous" means most crashes.
- Prefer *_label columns in SELECT/GROUP BY for human-readable results.
- If the user doesn't specify a year, assume the latest full year:
    WHERE collision_year = (SELECT MAX(collision_year) FROM collisions)
- 'date' is UTF8 'DD/MM/YYYY'. Parse with STRPTIME for month/quarter aggregations.
- 'time' is 'HH:MM' and may be NULL; extract hour with CAST(SUBSTR(time,1,2) AS INTEGER).
- Do not use DDL/DML (no CREATE/INSERT/UPDATE/DELETE). SELECT-only.
- Avoid vendor-specific functions not supported by DuckDB.
- If ambiguous, choose the simplest correct interpretation and note it in "reason".
`.trim();