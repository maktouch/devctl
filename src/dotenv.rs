use indexmap::IndexMap;
use serde_json::Value;

/// Serialize an env map, one `KEY=<json-encoded value>` per line.
pub fn stringify_to_env(map: &IndexMap<String, Value>) -> String {
    map.iter()
        .map(|(name, value)| format!("{}={}", name, serde_json::to_string(value).unwrap()))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Parse a dotenv file. Values that parse as JSON (numbers, booleans,
/// quoted strings) are decoded; everything else stays a raw string.
pub fn parse_env(input: &str) -> IndexMap<String, Value> {
    let mut map = IndexMap::new();

    for row in input.split('\n') {
        let Some(idx) = row.find('=') else { continue };

        let key = row[..idx].trim();
        if key.is_empty() {
            continue;
        }

        let raw_value = row[idx + 1..].trim();
        let value = serde_json::from_str::<Value>(raw_value)
            .unwrap_or_else(|_| Value::String(raw_value.to_string()));
        map.insert(key.to_string(), value);
    }

    map
}
