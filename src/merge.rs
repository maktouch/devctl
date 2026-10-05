use serde_yaml::Value;

/// Deep merge mirroring the `deepmerge` npm package defaults:
/// mappings merge recursively, sequences are concatenated, anything else
/// is replaced by the source value.
pub fn deep_merge(target: &Value, source: &Value) -> Value {
    match (target, source) {
        (Value::Mapping(t), Value::Mapping(s)) => {
            let mut out = t.clone();
            for (key, source_value) in s {
                let merged = match out.get(key) {
                    Some(target_value) => deep_merge(target_value, source_value),
                    None => source_value.clone(),
                };
                out.insert(key.clone(), merged);
            }
            Value::Mapping(out)
        }
        (Value::Sequence(t), Value::Sequence(s)) => {
            let mut out = t.clone();
            out.extend(s.iter().cloned());
            Value::Sequence(out)
        }
        _ => source.clone(),
    }
}
