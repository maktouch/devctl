use devctl::dotenv::{parse_env, stringify_to_env};
use indexmap::IndexMap;
use serde_json::{json, Value};

fn map(entries: &[(&str, Value)]) -> IndexMap<String, Value> {
    entries
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

// parseEnv

#[test]
fn parses_simple_key_value_pairs() {
    assert_eq!(
        parse_env("FOO=bar\nBAZ=qux"),
        map(&[("FOO", json!("bar")), ("BAZ", json!("qux"))])
    );
}

#[test]
fn json_decodes_quoted_and_numeric_values() {
    let parsed = parse_env("NAME=\"hello world\"\nPORT=3000\nFLAG=true");
    assert_eq!(parsed["NAME"], json!("hello world"));
    assert_eq!(parsed["PORT"], json!(3000));
    assert_eq!(parsed["FLAG"], json!(true));
}

#[test]
fn keeps_everything_after_the_first_equals_in_the_value() {
    assert_eq!(
        parse_env("DATABASE_URL=mysql://user:pass@host:3306/db?a=1&b=2"),
        map(&[(
            "DATABASE_URL",
            json!("mysql://user:pass@host:3306/db?a=1&b=2")
        )])
    );
}

#[test]
fn skips_blank_lines_comments_without_equals_and_rows_with_empty_keys() {
    assert_eq!(
        parse_env("\n# comment\n=nokey\nGOOD=1\n"),
        map(&[("GOOD", json!(1))])
    );
}

#[test]
fn trims_whitespace_and_carriage_returns_around_keys_and_values() {
    assert_eq!(
        parse_env("  KEY  =  value \r\nOTHER=2\r"),
        map(&[("KEY", json!("value")), ("OTHER", json!(2))])
    );
}

#[test]
fn last_occurrence_of_a_duplicated_key_wins() {
    assert_eq!(parse_env("A=1\nA=2"), map(&[("A", json!(2))]));
}

// stringifyToEnv

#[test]
fn writes_one_json_encoded_value_per_line() {
    let input = map(&[("FOO", json!("bar")), ("PORT", json!(3000))]);
    assert_eq!(stringify_to_env(&input), "FOO=\"bar\"\nPORT=3000");
}

#[test]
fn round_trips_through_parse_env() {
    let original = map(&[
        ("STR", json!("hello world")),
        ("NUM", json!(42)),
        ("BOOL", json!(false)),
        ("URL", json!("https://x.dev/a?b=c")),
    ]);
    assert_eq!(parse_env(&stringify_to_env(&original)), original);
}

#[test]
fn empty_object_produces_an_empty_string() {
    assert_eq!(stringify_to_env(&IndexMap::new()), "");
}
